import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  assertDescriptor,
  hermesBytecodeVersion,
  type EmbeddedReceipt,
  type RNDescriptor,
} from '@otakit/rn-protocol';
import { hashFile } from '../hash.js';
import {
  archiveRNDirectory,
  copyRNMapping,
  verifyRNDirectory,
  type SourceMapping,
} from './artifacts.js';
import {
  assertSameNativeBuild,
  captureNativeBuild,
  type NativeBuildInputs,
  type NativeBuildRecord,
} from './build-record.js';
import { writeReceipt } from './receipts.js';
import {
  assertOutputOutside,
  completedBuildHash,
  verifyCompletedBaseline,
  type CompletedNativeBuild,
} from './completed-build.js';
import { embeddedBuildId, type RNExportReceipt } from './export-receipt.js';
import { exportExpoGraph } from './expo-export.js';

type MetroAsset = { files: string[]; scales: number[]; [key: string]: unknown };

/** Export uses the installed Metro graph and destination mapper before any asset copies. */
export type RNExportOptions = {
  project: string;
  entry: string;
  version: string;
  output: string;
  nativeInputs: NativeBuildInputs;
} & (
  | { purpose: 'embedded'; nativeBuild: NativeBuildRecord }
  | { purpose: 'ota'; completedBuild: CompletedNativeBuild; baselineExport: string }
);

export async function exportRN(options: RNExportOptions): Promise<RNExportReceipt> {
  if (options.purpose !== 'embedded' && options.purpose !== 'ota')
    throw new Error('Select embedded or OTA export explicitly');
  if (options.purpose === 'ota') await assertOutputOutside(options.baselineExport, options.output);
  // Validate the completed binary's archived baseline before Metro creates any output.
  const baseline =
    options.purpose === 'ota'
      ? await verifyCompletedBaseline(options.completedBuild, options.baselineExport)
      : null;
  const selected =
    options.purpose === 'embedded' ? options.nativeBuild : options.completedBuild.nativeBuild;
  const project = resolve(options.project);
  const actual = await captureNativeBuild(project, options.nativeInputs);
  assertSameNativeBuild(selected, actual);
  const require = createRequire(join(project, 'package.json'));
  const rnRequire = createRequire(require.resolve('react-native/package.json'));
  const cliManifest = rnRequire.resolve('@react-native/community-cli-plugin/package.json');
  const cliRequire = createRequire(cliManifest);
  const cliPackage = dirname(cliManifest);
  const readDefault = (file: string) => {
    const module = require(join(cliPackage, 'dist/commands/bundle', file));
    return module.default ?? module;
  };
  const mapper = readDefault(
    actual.identity.platform === 'android'
      ? 'getAssetDestPathAndroid.js'
      : 'getAssetDestPathIOS.js',
  );
  const filterScales = readDefault('filterPlatformAssetScales.js');
  const metro = cliRequire('metro');
  const metroConfig = cliRequire('metro-config');
  const config = await metroConfig.loadConfig({ cwd: project });
  const projectPackage = require('./package.json');
  const expo = Boolean(projectPackage.dependencies?.expo || projectPackage.devDependencies?.expo);
  // A custom serializer can hide/overwrite output mappings. Its adapter must be reviewed explicitly.
  const bootstrap = require.resolve('@otakit/react-native-updater/bootstrap');
  if (!config.serializer?.getModulesRunBeforeMainModule?.(options.entry)?.includes(bootstrap))
    throw new Error('Install withOtaKitMetro before exporting embedded or OTA artifacts');
  if (config.serializer?.customSerializer && !expo)
    throw new Error('Custom Metro serializer needs a validated OtaKit export adapter');
  await mkdir(dirname(resolve(options.output)), { recursive: true });
  const temporary = await mkdtemp(join(dirname(resolve(options.output)), '.otakit-export-'));
  try {
    const payload = join(temporary, 'payload');
    const privateFiles = join(temporary, 'private');
    await mkdir(payload);
    await mkdir(privateFiles);
    const source = join(privateFiles, 'index.js');
    const map = join(privateFiles, 'metro.map');
    let expoDescriptor: RNDescriptor['expo'];
    let mappings: SourceMapping[] = [];
    if (expo) {
      const result = await exportExpoGraph({
        project,
        entry: options.entry,
        platform: actual.identity.platform,
        privateFiles,
        source,
        map,
        filterScales,
      });
      mappings = result.mappings;
      expoDescriptor = result.expo;
    } else {
      const result = await metro.runBuild(config, {
        entry: options.entry,
        platform: actual.identity.platform,
        dev: false,
        minify: false,
        assets: true,
        sourceMap: true,
        sourceMapOut: map,
        bundleOut: source,
        unstable_transformProfile: 'hermes-stable',
      });
      if (!Array.isArray(result.assets)) throw new Error('Metro did not expose its asset mapping');
      for (const asset of result.assets as MetroAsset[]) {
        const scales = new Set(filterScales(actual.identity.platform, asset.scales));
        asset.scales.forEach((scale, index) => {
          if (scales.has(scale))
            mappings.push({ source: asset.files[index], destination: mapper(asset, scale) });
        });
      }
    }
    await copyRNMapping(mappings, payload);
    const compiler = resolve(project, actual.identity.hermesCompiler.path);
    const bundle = join(payload, 'index.bundle');
    let bytecode = false;
    try {
      hermesBytecodeVersion(await readFile(source));
      bytecode = true;
    } catch {
      /* JavaScript requires compilation. */
    }
    if (bytecode)
      throw new Error('Unexpected precompiled Metro output; compiler ownership must be explicit');
    await promisify(execFile)(
      compiler,
      ['-O', '-emit-binary', '-output-source-map', '-out', bundle, source],
      { cwd: project, timeout: 120_000 },
    );
    const rnRoot = dirname(require.resolve('react-native/package.json'));
    await promisify(execFile)(
      process.execPath,
      [
        join(rnRoot, 'scripts/compose-source-maps.js'),
        map,
        `${bundle}.map`,
        '-o',
        join(privateFiles, 'index.map'),
      ],
      { cwd: project, timeout: 60_000 },
    );
    await rm(`${bundle}.map`);
    const descriptor: RNDescriptor = {
      format: 'otakit-rn',
      formatVersion: 1,
      framework: 'react-native',
      platform: actual.identity.platform,
      runtimeVersion: actual.runtimeVersion,
      version: options.version,
      entryPoint: 'index.bundle',
      engine: 'hermes',
      bundleFormat: 'hermes-bytecode',
      reactNativeVersion: actual.identity.reactNativeVersion,
      ...(expoDescriptor ? { expo: expoDescriptor } : {}),
    };
    assertDescriptor(descriptor);
    await writeFile(join(payload, 'otakit-bundle.json'), JSON.stringify(descriptor) + '\n');
    const verified = await verifyRNDirectory(
      payload,
      descriptor,
      actual.identity.hermesCompiler.bytecodeVersion,
    );
    // Native inputs must still agree after Metro/compiler execution.
    assertSameNativeBuild(actual, await captureNativeBuild(project, options.nativeInputs));
    const zip = join(temporary, 'artifact.zip');
    await archiveRNDirectory(payload, zip, verified.files);
    const embeddedReceipt: EmbeddedReceipt = {
      appId: actual.identity.appId,
      framework: 'react-native',
      platform: descriptor.platform,
      runtimeVersion: descriptor.runtimeVersion,
      version: descriptor.version,
      embeddedContentHash: verified.contentHash,
    };
    if (options.purpose === 'embedded')
      await writeReceipt(join(temporary, 'otakit-embedded.json'), embeddedReceipt);
    else {
      await writeReceipt(join(privateFiles, 'completed-build.json'), options.completedBuild);
      await writeReceipt(join(privateFiles, 'baseline-export.json'), baseline!.receipt);
      await writeFile(join(privateFiles, 'baseline.zip'), baseline!.archive, {
        flag: 'wx',
        mode: 0o600,
      });
    }
    await writeReceipt(join(privateFiles, 'native-build.json'), actual);
    await writeReceipt(join(privateFiles, 'native-inputs.json'), options.nativeInputs);
    const receipt: RNExportReceipt = {
      format: 'otakit-rn-export',
      version: 1,
      appId: actual.identity.appId,
      platform: descriptor.platform,
      runtimeVersion: actual.runtimeVersion,
      displayVersion: options.version,
      contentHash: verified.contentHash,
      sha256: await hashFile(zip),
      files: verified.files,
      ...(options.purpose === 'embedded'
        ? {
            purpose: 'embedded' as const,
            embeddedReceipt,
            nativeBuildId: embeddedBuildId(embeddedReceipt),
          }
        : {
            purpose: 'ota' as const,
            baseline: {
              embeddedReceipt: baseline!.receipt.embeddedReceipt,
              archive: 'private/baseline.zip' as const,
              exportReceipt: 'private/baseline-export.json' as const,
              completedBuild: 'private/completed-build.json' as const,
              completedBuildHash: completedBuildHash(options.completedBuild),
            },
          }),
      sourceMap: 'private/index.map',
      archive: 'artifact.zip',
      payload: 'payload',
      mappingHash: createHash('sha256').update(JSON.stringify(mappings)).digest('hex'),
    };
    await writeReceipt(join(temporary, 'export.json'), receipt);
    // Never overwrite an earlier receipt/artifact that might have been sent.
    await mkdir(options.output, { recursive: true });
    await rename(
      temporary,
      join(options.output, `${descriptor.platform}-${actual.runtimeVersion}`),
    );
    return receipt;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
