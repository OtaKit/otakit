import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { hermesBytecodeVersion } from '@otakit/rn-protocol';
import { verifyRNArchive } from './artifacts.js';
import type { RNExportReceipt } from './export-receipt.js';
import type { NativeBuildRecord } from './build-record.js';

const expoDescribe = process.env.RUN_EXPO_EXPORT_TESTS === '1' ? describe : describe.skip;
expoDescribe('installed SDK 57 Expo embed adapter', () => {
  it('exports native bytecode, public config and DOM assets with private maps; rejects Router asset collisions', async () => {
    const project = fileURLToPath(new URL('../../../../../examples/expo-app/', import.meta.url));
    const require = createRequire(join(project, 'package.json'));
    const rnRequire = createRequire(require.resolve('react-native/package.json'));
    const directory = await mkdtemp(join(tmpdir(), 'otakit-expo-export-'));
    try {
      const inputs = join(directory, 'inputs.json');
      await writeFile(
        inputs,
        JSON.stringify({
          appId: 'local-expo-fixture',
          platform: 'android',
          nativeApplicationId: 'com.otakit.expofixture',
          variant: 'Release',
          hermesCompiler: join(
            dirname(rnRequire.resolve('hermes-compiler/package.json')),
            'hermesc/osx-bin/hermesc',
          ),
          hermesBytecodeVersion: 98,
          nativeFiles: [
            'android/build.gradle',
            'android/app/build.gradle',
            'android/app/src/main/java/com/otakit/expofixture/MainApplication.kt',
            'android/app/src/main/java/com/otakit/expofixture/MainActivity.kt',
          ],
          nativeConfiguration: {
            fixture: true,
            engine: 'hermes',
            newArchitecture: true,
            otakitResourceDirectory: 'OtaKitFixture',
          },
        }),
      );
      const cli = fileURLToPath(new URL('../../../dist/index.js', import.meta.url));
      const run = (entry: string, output: string) =>
        promisify(execFile)(
          process.execPath,
          [
            cli,
            'rn',
            'export-embedded',
            '--project',
            project,
            '--native-inputs',
            inputs,
            '--entry',
            entry,
            '--version',
            'embedded',
            '--output',
            output,
          ],
          { timeout: 180000, maxBuffer: 16 * 1024 * 1024 },
        );
      const output = join(directory, 'accepted');
      await run('export-entry.tsx', output);
      const variants = await readdir(output);
      expect(variants).toHaveLength(1);
      const exported = join(output, variants[0]);
      const receipt: RNExportReceipt = JSON.parse(
        await readFile(join(exported, 'export.json'), 'utf8'),
      );
      expect(hermesBytecodeVersion(await readFile(join(exported, 'payload/index.bundle')))).toBe(
        98,
      );
      expect(
        receipt.files.some(
          (file) => file.path.startsWith('www.bundle/') && file.path.endsWith('.html'),
        ),
      ).toBe(true);
      expect(
        receipt.files.some(
          (file) => file.path.startsWith('www.bundle/') && file.path.endsWith('.js'),
        ),
      ).toBe(true);
      expect(receipt.files.some((file) => file.path.endsWith('.map'))).toBe(false);
      for (const file of receipt.files.filter((file) => file.path.endsWith('.js')))
        expect(await readFile(join(exported, 'payload', file.path), 'utf8')).not.toContain(
          'sourceMappingURL=',
        );
      expect(
        JSON.parse(await readFile(join(exported, 'payload/expo-config.json'), 'utf8')).extra
          .fixtureVersion,
      ).toBe('embedded');
      expect(
        JSON.parse(await readFile(join(exported, 'payload/otakit-bundle.json'), 'utf8')).expo,
      ).toEqual({ configFile: 'expo-config.json', domRoot: 'www.bundle' });
      const build: NativeBuildRecord = JSON.parse(
        await readFile(join(exported, 'private/native-build.json'), 'utf8'),
      );
      expect(
        build.identity.resolvedNativeSources?.some(
          (source) => source.path === 'android' && source.fileCount > 0,
        ),
      ).toBe(true);
      expect(
        build.identity.resolvedNativeSources?.some(
          (source) => source.path.includes('expo-modules-core') && source.fileCount > 0,
        ),
      ).toBe(true);
      expect(
        (await readdir(join(exported, 'private/expo-generated'))).some((file) =>
          file.endsWith('.map'),
        ),
      ).toBe(true);
      await verifyRNArchive(await readFile(join(exported, 'artifact.zip')), receipt.files);
      const rejected = join(directory, 'router');
      await expect(run('expo-router/entry', rejected)).rejects.toThrow('collides:');
      await expect(readdir(rejected)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 360000);
});
