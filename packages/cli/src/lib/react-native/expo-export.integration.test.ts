import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
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
  it('uses Expo’s own CLI dependency when the app does not install @expo/cli directly', async () => {
    const project = fileURLToPath(new URL('../../../../../examples/expo-app/', import.meta.url));
    const require = createRequire(join(project, 'package.json'));
    const isolated = await mkdtemp(join(tmpdir(), 'otakit-expo-owner-'));
    try {
      await mkdir(join(isolated, 'node_modules'));
      await writeFile(
        join(isolated, 'package.json'),
        JSON.stringify({ dependencies: { expo: '57.0.17' } }),
      );
      await symlink(
        dirname(require.resolve('expo/package.json')),
        join(isolated, 'node_modules/expo'),
      );
      await writeFile(
        join(isolated, '.env.production'),
        'EXPO_PUBLIC_OTAKIT_EXPORT_FIXTURE=isolated-production\n',
      );
      const environment = { ...process.env, NODE_PATH: '' };
      delete environment.NODE_ENV;
      delete environment.BABEL_ENV;
      delete environment.EXPO_PUBLIC_OTAKIT_EXPORT_FIXTURE;
      delete environment.EXPO_NO_DOTENV;
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          '--no-global-search-paths',
          '--input-type=module',
          '-e',
          `
        import assert from 'node:assert/strict';
        import {createRequire} from 'node:module';
        const require = createRequire(process.argv[2] + '/package.json');
        assert.throws(() => require.resolve('@expo/cli/package.json'));
        const {prepareExpoEnvironment} = await import(process.argv[1]);
        const files = prepareExpoEnvironment(process.argv[2]);
        assert.equal(files.length, 1);
        process.stdout.write(JSON.stringify({mode: process.env.NODE_ENV, value: process.env.EXPO_PUBLIC_OTAKIT_EXPORT_FIXTURE}));
      `,
          new URL('../../../dist/lib/react-native/expo-environment.js', import.meta.url).href,
          isolated,
        ],
        {
          env: environment,
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        },
      );
      expect(JSON.parse(stdout)).toEqual({ mode: 'production', value: 'isolated-production' });
    } finally {
      await rm(isolated, { recursive: true, force: true });
    }
  });
  it.each(['ios', 'android'] as const)(
    'exports %s bytecode, public config, DOM and patched Router assets with private maps',
    async (platform) => {
      const project = fileURLToPath(new URL('../../../../../examples/expo-app/', import.meta.url));
      const require = createRequire(join(project, 'package.json'));
      const rnRequire = createRequire(require.resolve('react-native/package.json'));
      const directory = await mkdtemp(join(tmpdir(), 'otakit-expo-export-'));
      const environmentFile = join(project, '.env.production.local');
      const environmentValue = `otakit-${platform}-${randomUUID()}`;
      const privateValue = `private-${randomUUID()}`;
      let createdEnvironment = false;
      try {
        await writeFile(
          environmentFile,
          `EXPO_PUBLIC_OTAKIT_EXPORT_FIXTURE=${environmentValue}\nOTAKIT_EXPORT_PRIVATE_FIXTURE=${privateValue}\n`,
          { flag: 'wx', mode: 0o600 },
        );
        createdEnvironment = true;
        const inputs = join(directory, 'inputs.json');
        await writeFile(
          inputs,
          JSON.stringify({
            appId: 'local-expo-fixture',
            platform,
            nativeApplicationId: 'com.otakit.expofixture',
            variant: 'Release',
            hermesCompiler: join(
              dirname(rnRequire.resolve('hermes-compiler/package.json')),
              'hermesc/osx-bin/hermesc',
            ),
            hermesBytecodeVersion: 98,
            nativeFiles:
              platform === 'ios'
                ? [
                    'ios/Podfile',
                    ...((await readdir(join(project, 'ios'))).includes('Podfile.lock')
                      ? ['ios/Podfile.lock']
                      : []),
                    'ios/Podfile.properties.json',
                    'ios/OtaKitExpoFixture.xcodeproj/project.pbxproj',
                    'ios/OtaKitExpoFixture/AppDelegate.swift',
                  ]
                : [
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
        const environment = { ...process.env };
        delete environment.NODE_ENV;
        delete environment.BABEL_ENV;
        delete environment.EXPO_PUBLIC_OTAKIT_EXPORT_FIXTURE;
        delete environment.EXPO_NO_DOTENV;
        const run = (entry: string, output: string, extraEnvironment = {}) =>
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
            {
              timeout: 180000,
              maxBuffer: 16 * 1024 * 1024,
              env: { ...environment, ...extraEnvironment },
            },
          );
        const invalid = join(directory, 'non-production');
        await expect(run('export-entry.tsx', invalid, { NODE_ENV: 'test' })).rejects.toThrow(
          'NODE_ENV=production',
        );
        await expect(
          run('export-entry.tsx', invalid, { BABEL_ENV: 'development' }),
        ).rejects.toThrow('BABEL_ENV=production');
        await expect(readdir(invalid)).rejects.toMatchObject({ code: 'ENOENT' });
        const output = join(directory, 'accepted');
        await run('export-entry.tsx', output);
        const variants = await readdir(output);
        expect(variants).toHaveLength(1);
        const exported = join(output, variants[0]);
        const receipt: RNExportReceipt = JSON.parse(
          await readFile(join(exported, 'export.json'), 'utf8'),
        );
        expect(
          JSON.parse(await readFile(join(exported, 'payload/expo-config.json'), 'utf8')).extra
            .exportEnvironment,
        ).toBe(environmentValue);
        expect(
          (await readFile(join(exported, 'private/index.js'), 'utf8')).includes(environmentValue),
          'Native JS must use the same production environment as exported config',
        ).toBe(true);
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
        expect(build.identity.nativeFiles).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: '.env.production.local',
              sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            }),
          ]),
        );
        expect(JSON.stringify(build)).not.toContain(privateValue);
        expect(await readFile(join(exported, 'payload/expo-config.json'), 'utf8')).not.toContain(
          privateValue,
        );
        expect(await readFile(join(exported, 'private/index.js'), 'utf8')).not.toContain(
          privateValue,
        );
        expect(
          build.identity.resolvedNativeSources?.some(
            (source) => source.path === platform && source.fileCount > 0,
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
        const changedValue = `changed-${environmentValue}`;
        await writeFile(
          environmentFile,
          `EXPO_PUBLIC_OTAKIT_EXPORT_FIXTURE=${changedValue}\nOTAKIT_EXPORT_PRIVATE_FIXTURE=${privateValue}\n`,
        );
        const changedOutput = join(directory, 'changed-environment');
        await run('export-entry.tsx', changedOutput);
        const changedExport = join(changedOutput, (await readdir(changedOutput))[0]);
        expect(
          JSON.parse(await readFile(join(changedExport, 'payload/expo-config.json'), 'utf8')).extra
            .exportEnvironment,
        ).toBe(changedValue);
        expect(
          (await readFile(join(changedExport, 'private/index.js'), 'utf8')).includes(changedValue),
          'A second export must not reuse stale Babel environment inlining',
        ).toBe(true);
        const routerOutput = join(directory, 'router');
        await run('expo-router/entry', routerOutput);
        const routerExport = join(routerOutput, (await readdir(routerOutput))[0]);
        const routerReceipt: RNExportReceipt = JSON.parse(
          await readFile(join(routerExport, 'export.json'), 'utf8'),
        );
        await verifyRNArchive(
          await readFile(join(routerExport, 'artifact.zip')),
          routerReceipt.files,
        );
        for (const [icon, size] of [
          ['clear', 16],
          ['close', 24],
        ] as const) {
          const files = routerReceipt.files.filter((file) =>
            new RegExp(`${icon}-?icon(?:@\\dx)?\\.png$`).test(file.path),
          );
          const dimensions = await Promise.all(
            files.map(async (file) => {
              const png = await readFile(join(routerExport, 'payload', file.path));
              const width = png.readUInt32BE(16);
              expect(png.readUInt32BE(20)).toBe(width);
              return width;
            }),
          );
          expect(dimensions.sort((a, b) => a - b)).toEqual(
            (platform === 'ios' ? [1, 2, 3] : [1, 2, 3, 4]).map((scale) => size * scale),
          );
        }
        // Even an environment-file change that leaves evaluated config unchanged must
        // not disappear from native evidence between preparation and package sealing.
        await writeFile(
          environmentFile,
          `EXPO_PUBLIC_OTAKIT_EXPORT_FIXTURE=${environmentValue}\nOTAKIT_EXPORT_PRIVATE_FIXTURE=${privateValue}\n# changed after export\n`,
        );
        const sealReceipt = join(directory, 'must-not-seal.json');
        await expect(
          promisify(execFile)(
            process.execPath,
            [
              cli,
              'rn',
              'seal-build',
              '--project',
              project,
              '--native-inputs',
              inputs,
              '--embedded-export',
              exported,
              '--binary',
              join(directory, platform === 'ios' ? 'Missing.app' : 'missing.apk'),
              '--receipt',
              sealReceipt,
            ],
            { env: environment, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
          ),
        ).rejects.toThrow('Native inputs differ');
        await expect(readFile(sealReceipt)).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        if (createdEnvironment) await rm(environmentFile);
        await rm(directory, { recursive: true, force: true });
      }
    },
    360000,
  );
});
