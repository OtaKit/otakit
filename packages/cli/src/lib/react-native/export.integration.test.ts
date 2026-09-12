import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hermesBytecodeVersion } from '@otakit/rn-protocol';
import type { NativeBuildRecord } from './build-record.js';
import type { EmbeddedExportReceipt } from './export-receipt.js';
import { verifyRNArchive } from './artifacts.js';

const nativeDescribe = process.env.RUN_RN_EXPORT_TESTS === '1' ? describe : describe.skip;
nativeDescribe('installed RN 0.86.3 Metro and Hermes exporter', () => {
  it('exports actual bytecode with a private composed map and a verified archive', async () => {
    const project = fileURLToPath(
      new URL('../../../../../examples/react-native-app/', import.meta.url),
    );
    const output = process.env.RN_EXPORT_OUTPUT
      ? resolve(process.env.RN_EXPORT_OUTPUT)
      : await mkdtemp(join(tmpdir(), 'otakit-rn-export-test-'));
    const platform = process.env.RN_EXPORT_PLATFORM === 'android' ? 'android' : 'ios';
    const rnRequire = createRequire(
      createRequire(join(project, 'package.json')).resolve('react-native/package.json'),
    );
    const nativeInputs = {
      appId: 'local-rn-fixture',
      platform: platform as 'ios' | 'android',
      nativeApplicationId: 'com.otakit.rnfixture',
      variant: process.env.RN_EXPORT_VARIANT ?? 'Release',
      hermesCompiler:
        platform === 'ios'
          ? 'ios/Pods/hermes-engine/destroot/bin/hermesc'
          : join(
              dirname(rnRequire.resolve('hermes-compiler/package.json')),
              'hermesc/osx-bin/hermesc',
            ),
      hermesBytecodeVersion: 98,
      nativeFiles:
        platform === 'ios'
          ? ['ios/Podfile.lock', 'ios/Podfile', 'ios/HelloWorld/AppDelegate.swift']
          : [
              'android/build.gradle',
              'android/app/build.gradle',
              'android/app/src/main/java/com/helloworld/MainApplication.kt',
              'android/app/src/main/java/com/helloworld/MainActivity.kt',
            ],
      nativeConfiguration: {
        fixture: true,
        engine: 'hermes',
        newArchitecture: true,
        otakitResourceDirectory: 'OtaKitFixture',
      },
    };
    const inputDirectory = await mkdtemp(join(tmpdir(), 'otakit-rn-native-inputs-'));
    try {
      const inputPath = join(inputDirectory, 'inputs.json');
      await writeFile(inputPath, JSON.stringify(nativeInputs));
      const cli = fileURLToPath(new URL('../../../dist/index.js', import.meta.url));
      await promisify(execFile)(
        process.execPath,
        [
          cli,
          'rn',
          'export-embedded',
          '--project',
          project,
          '--native-inputs',
          inputPath,
          '--version',
          'embedded',
          '--output',
          output,
        ],
        {
          timeout: 120_000,
          maxBuffer: 16 * 1024 * 1024,
          // A launcher may expose an unrelated Expo project globally. Bare native
          // fingerprinting must still use only the selected project's dependencies.
          env: { ...process.env, NODE_PATH: join(project, '../expo-app/node_modules') },
        },
      );
      const variants = (await readdir(output)).filter((name) => name.startsWith(`${platform}-`));
      expect(variants).toHaveLength(1);
      const directory = join(output, variants[0]);
      const receipt = JSON.parse(
        await readFile(join(directory, 'export.json'), 'utf8'),
      ) as EmbeddedExportReceipt;
      const build = JSON.parse(
        await readFile(join(directory, 'private/native-build.json'), 'utf8'),
      ) as NativeBuildRecord;
      expect(build.identity.nativeFiles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: expect.stringContaining(
              `packages/updater-core/${platform === 'ios' ? 'ios/Sources/RNManifest.swift' : 'android/src/main/java/com/otakit/core/RNManifest.java'}`,
            ),
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        ]),
      );
      expect(
        build.identity.fingerprintSources.some((source) =>
          (source as { id?: string }).id?.startsWith('expo'),
        ),
      ).toBe(false);
      expect(receipt.purpose).toBe('embedded');
      expect(receipt.runtimeVersion).toBe(build.runtimeVersion);
      expect(hermesBytecodeVersion(await readFile(join(directory, 'payload/index.bundle')))).toBe(
        98,
      );
      await verifyRNArchive(await readFile(join(directory, 'artifact.zip')), receipt.files);
      expect(receipt.files.every((file) => !file.path.endsWith('.map'))).toBe(true);
      expect(JSON.parse(await readFile(join(directory, 'private/index.map'), 'utf8')).version).toBe(
        3,
      );
      console.log(`RN fixture export: ${directory}`);
    } finally {
      await rm(inputDirectory, { recursive: true, force: true });
      if (!process.env.RN_EXPORT_OUTPUT) await rm(output, { recursive: true, force: true });
    }
  }, 180_000);
});
