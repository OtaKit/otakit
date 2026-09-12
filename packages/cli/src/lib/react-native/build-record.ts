import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { prepareExpoEnvironment } from './expo-environment.js';
import { join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { canonicalJSON, type RNPlatform } from '@otakit/rn-protocol';
import { hashFile } from '../hash.js';
import { hashResolvedNativeSource, RN_FINGERPRINT_IGNORES } from './native-sources.js';
import { hostConfigurationHash, parseHostConfiguration } from './host-configuration.js';

export interface NativeBuildInputs {
  appId: string;
  platform: RNPlatform;
  nativeApplicationId: string;
  variant: string;
  hermesCompiler: string;
  hermesBytecodeVersion: number;
  // Produced by the native build hook after dependency resolution and config generation.
  nativeFiles: string[];
  nativeConfiguration: Record<string, unknown>;
}
export interface NativeBuildRecord {
  format: 'otakit-rn-native-build';
  version: 1;
  runtimeVersion: string;
  identity: {
    appId: string;
    platform: RNPlatform;
    nativeApplicationId: string;
    variant: string;
    reactNativeVersion: string;
    protocolVersion: 1;
    fingerprintTool: '@expo/fingerprint@0.20.6';
    fingerprintHash: string;
    fingerprintSources: unknown[];
    resolvedNativeSources?: Array<{ path: string; fileCount: number; sha256: string }>;
    autolinking: unknown;
    hermesCompiler: { path: string; sha256: string; bytecodeVersion: number };
    nativeFiles: Array<{ path: string; sha256: string }>;
    nativeConfiguration: Record<string, unknown>;
    hostConfigurationHash?: string;
  };
}

export async function captureNativeBuild(
  project: string,
  input: NativeBuildInputs,
): Promise<NativeBuildRecord> {
  const projectRoot = await realpath(project);
  const expoEnvironmentFiles = prepareExpoEnvironment(projectRoot).map((file) =>
    relative(projectRoot, file),
  );
  const require = createRequire(join(projectRoot, 'package.json'));
  const rnPackage = require.resolve('react-native/package.json');
  const rnRequire = createRequire(rnPackage);
  const rn = JSON.parse(await readFile(rnPackage, 'utf8'));
  if (!['0.86.3', '0.87.0'].includes(rn.version))
    throw new Error(`RN ${rn.version} has not been accepted for this exporter`);
  if (
    !input.appId ||
    !input.nativeApplicationId ||
    !input.variant ||
    !['ios', 'android'].includes(input.platform) ||
    !Array.isArray(input.nativeFiles) ||
    input.nativeFiles.length === 0 ||
    !Number.isInteger(input.hermesBytecodeVersion)
  )
    throw new Error('Missing resolved native build inputs');
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      '--no-global-search-paths',
      require.resolve('@react-native-community/cli/build/bin.js'),
      'config',
    ],
    {
      cwd: projectRoot,
      env: { ...process.env, NODE_PATH: '' },
      maxBuffer: 16 * 1024 * 1024,
      timeout: 60_000,
    },
  );
  const autolinking = JSON.parse(stdout);
  if (!autolinking.project?.[input.platform]?.sourceDir || !autolinking.dependencies)
    throw new Error('Native autolinking did not resolve the target project');
  for (const entry of Object.values(autolinking.dependencies) as Array<{
    platforms?: Record<string, { sourceDir?: string; podspecPath?: string } | null>;
  }>) {
    const target = entry.platforms?.[input.platform];
    if (target) {
      const source = input.platform === 'ios' ? target.podspecPath : target.sourceDir;
      if (!source) throw new Error('Native dependency source disappeared from autolinking');
      await stat(source);
    }
  }
  // RN autolinking finds the bridge package, but its transitive native source package lives
  // outside that directory. Hash the source actually compiled by Gradle/CocoaPods as well.
  const pluginRequire = createRequire(require.resolve('@otakit/react-native-updater'));
  const coreRoot = join(pluginRequire.resolve('@otakit/updater-core/package.json'), '..');
  const coreFiles: string[] = [];
  async function collectCore(path: string): Promise<void> {
    const info = await lstat(path);
    if (info.isSymbolicLink())
      throw new Error(`Unexpected symlink in installed native core: ${path}`);
    if (info.isDirectory()) {
      for (const name of await readdir(path)) await collectCore(join(path, name));
    } else if (info.isFile()) coreFiles.push(relative(projectRoot, path));
    else throw new Error(`Invalid installed native core input: ${path}`);
  }
  await collectCore(
    await realpath(join(coreRoot, input.platform === 'ios' ? 'ios/Sources' : 'android/src/main')),
  );
  if (!coreFiles.length) throw new Error('Installed OtaKit native core has no source files');
  await collectCore(await realpath(join(coreRoot, 'package.json')));
  if (input.platform === 'ios')
    await collectCore(await realpath(join(coreRoot, 'OtaKitUpdaterCore.podspec')));
  // Package-manager launchers can inject NODE_PATH with unrelated workspace packages.
  // Collect in a separate Node process so a bare app cannot accidentally acquire Expo
  // sourcers from that global path. Do not mutate the CLI process's module resolution.
  const fingerprintModule = createRequire(import.meta.url).resolve('@expo/fingerprint');
  const { stdout: fingerprintJSON } = await promisify(execFile)(
    process.execPath,
    [
      '--no-global-search-paths',
      '-e',
      'require(process.argv[1]).createFingerprintAsync(process.argv[2], JSON.parse(process.argv[3])).then(value => process.stdout.write(JSON.stringify(value))).catch(error => { console.error(error); process.exitCode = 1; });',
      fingerprintModule,
      projectRoot,
      JSON.stringify({ platforms: [input.platform], ignorePaths: RN_FINGERPRINT_IGNORES }),
    ],
    {
      cwd: projectRoot,
      env: { ...process.env, NODE_PATH: '' },
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
    },
  );
  const fingerprint = JSON.parse(fingerprintJSON) as {
    hash: string;
    sources: Array<{ hash?: string; type?: string; filePath?: string; reasons?: string[] }>;
  };
  if (!fingerprint.hash || !Array.isArray(fingerprint.sources) || !fingerprint.sources.length)
    throw new Error('Fingerprint has incomplete resolved native source evidence');
  const resolvedNativeSources = [];
  for (const source of fingerprint.sources.filter((item) => !item.hash)) {
    const knownReasons = [
      'bareNativeDir',
      'expoAutolinkingAndroid',
      'expoAutolinkingIos',
      'rncoreAutolinkingAndroid',
      'rncoreAutolinkingIos',
    ];
    if (
      source.type !== 'dir' ||
      !source.filePath ||
      !source.reasons?.length ||
      !source.reasons.every((reason) => knownReasons.includes(reason))
    )
      throw new Error('Fingerprint has incomplete resolved native source evidence');
    resolvedNativeSources.push(
      await hashResolvedNativeSource(
        projectRoot,
        resolve(projectRoot, source.filePath),
        String(input.nativeConfiguration.otakitResourceDirectory ?? 'OtaKit'),
      ),
    );
  }
  const nativeFiles = await Promise.all(
    [...new Set([...input.nativeFiles, ...coreFiles, ...expoEnvironmentFiles])]
      .sort()
      .map(async (path) => {
        const absolute = await realpath(resolve(projectRoot, path));
        if (!(await stat(absolute)).isFile())
          throw new Error(`Native input is not a file: ${path}`);
        if (/otakit-(embedded|native-build)\.json$/.test(path))
          throw new Error('Generated receipts cannot enter their own runtime hash');
        return {
          path: relative(projectRoot, absolute).split(sep).join('/'),
          sha256: await hashFile(absolute),
        };
      }),
  );
  const compiler = await realpath(resolve(projectRoot, input.hermesCompiler));
  const hostFile = input.nativeConfiguration.otakitHostConfigurationFile;
  let hostHash: string | undefined;
  if (hostFile !== undefined) {
    if (typeof hostFile !== 'string' || !input.nativeFiles.includes(hostFile))
      throw new Error('otakitHostConfigurationFile must name an explicit nativeFiles input');
    const bytes = await readFile(resolve(projectRoot, hostFile));
    hostHash = hostConfigurationHash(parseHostConfiguration(bytes));
    const path = relative(projectRoot, await realpath(resolve(projectRoot, hostFile)))
      .split(sep)
      .join('/');
    if (
      nativeFiles.find((file) => file.path === path)?.sha256 !==
      createHash('sha256').update(bytes).digest('hex')
    )
      throw new Error('Host configuration changed while capturing native inputs');
  }
  const compilerRelative = relative(projectRoot, compiler);
  const compilerRoots = [await realpath(join(require.resolve('react-native/package.json'), '..'))];
  if (input.platform === 'ios') {
    const podsRoot = join(projectRoot, 'ios/Pods/hermes-engine');
    try {
      const podLock = await readFile(join(projectRoot, 'ios/Podfile.lock'), 'utf8');
      if (
        !podLock.includes('hermes-engine (') ||
        !nativeFiles.some((file) => file.path === 'ios/Podfile.lock')
      )
        throw new Error(
          'The resolved Hermes Podfile.lock must be included in native build evidence',
        );
      compilerRoots.push(await realpath(podsRoot));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  try {
    compilerRoots.push(
      await realpath(join(rnRequire.resolve('hermes-compiler/package.json'), '..')),
    );
  } catch {
    /* Older RN distributions embed hermesc. */
  }
  if (!compilerRoots.some((root) => compiler.startsWith(root + sep)))
    throw new Error('Use the Hermes compiler installed with this project’s native RN distribution');
  const identity: NativeBuildRecord['identity'] = {
    appId: input.appId,
    platform: input.platform,
    nativeApplicationId: input.nativeApplicationId,
    variant: input.variant,
    reactNativeVersion: rn.version,
    protocolVersion: 1,
    fingerprintTool: '@expo/fingerprint@0.20.6',
    fingerprintHash: fingerprint.hash,
    fingerprintSources: fingerprint.sources,
    ...(resolvedNativeSources.length ? { resolvedNativeSources } : {}),
    autolinking,
    hermesCompiler: {
      path: compilerRelative.split(sep).join('/'),
      sha256: await hashFile(compiler),
      bytecodeVersion: input.hermesBytecodeVersion,
    },
    nativeFiles,
    nativeConfiguration: input.nativeConfiguration,
    ...(hostHash ? { hostConfigurationHash: hostHash } : {}),
  };
  // Normalize absolute project paths in collected evidence; CI checkout locations are not native identity.
  const portable = JSON.parse(
    JSON.stringify(identity).split(projectRoot).join('<project>'),
  ) as NativeBuildRecord['identity'];
  return {
    format: 'otakit-rn-native-build',
    version: 1,
    identity: portable,
    runtimeVersion: createHash('sha256').update(canonicalJSON(portable)).digest('base64url'),
  };
}

export function assertSameNativeBuild(
  expected: NativeBuildRecord,
  actual: NativeBuildRecord,
): void {
  if (
    expected.format !== 'otakit-rn-native-build' ||
    expected.version !== 1 ||
    createHash('sha256').update(canonicalJSON(expected.identity)).digest('base64url') !==
      expected.runtimeVersion ||
    expected.runtimeVersion !== actual.runtimeVersion
  )
    throw new Error(
      'Native inputs differ from the selected completed build. Build a new binary or export in its matching native environment.',
    );
}
