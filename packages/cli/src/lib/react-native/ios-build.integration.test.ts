import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { CompletedNativeBuild } from './completed-build.js';

const nativeDescribe = process.env.RUN_RN_XCODE_TESTS === '1' ? describe : describe.skip;
nativeDescribe('Xcode staging and post-build sealing', () => {
  it('archives separate builds, exports OTA, and never seals a failed or skipped invocation', async () => {
    if (
      !process.env.RN_XCODE_NATIVE_INPUTS ||
      !process.env.RN_XCODE_DERIVED_DATA ||
      !process.env.RN_XCODE_DESTINATION
    )
      throw new Error('Set RN_XCODE_NATIVE_INPUTS, RN_XCODE_DERIVED_DATA and RN_XCODE_DESTINATION');
    const project = fileURLToPath(
      new URL('../../../../../examples/react-native-app/', import.meta.url),
    );
    const cli = fileURLToPath(new URL('../../../dist/index.js', import.meta.url));
    const scratch = await mkdtemp(join(tmpdir(), 'otakit-xcode-test-'));
    const run = promisify(execFile);
    const build = (name: string, env = process.env) =>
      run(
        process.execPath,
        [
          cli,
          'rn',
          'build-ios',
          '--project',
          project,
          '--workspace',
          'ios/HelloWorld.xcworkspace',
          '--scheme',
          'HelloWorld',
          '--sdk',
          'iphonesimulator',
          '--destination',
          process.env.RN_XCODE_DESTINATION!,
          '--derived-data',
          resolve(process.env.RN_XCODE_DERIVED_DATA!),
          '--native-inputs',
          resolve(process.env.RN_XCODE_NATIVE_INPUTS!),
          '--version',
          name,
          '--output',
          join(scratch, name),
          '--no-code-signing',
        ],
        { env, timeout: 600_000, maxBuffer: 8 * 1024 * 1024 },
      );
    const completed = async (name: string) =>
      JSON.parse(
        await readFile(join(scratch, name, 'completed-build.json'), 'utf8'),
      ) as CompletedNativeBuild;
    await build('first');
    const first = await completed('first');
    const original = await readFile(join(scratch, 'first/completed-build.json'));
    expect(first.nativeBuild.identity.nativeConfiguration.iosBuild).toMatchObject({
      TARGET_NAME: 'HelloWorld',
      CONFIGURATION: 'Release',
      PLATFORM_NAME: 'iphonesimulator',
    });
    expect(first.nativeBuild.identity.nativeFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: expect.stringContaining('scripts/xcode.sh') }),
        expect.objectContaining({ path: expect.stringContaining('Pods/Target Support Files/') }),
      ]),
    );
    await build('second');
    const second = await completed('second');
    expect(second.nativeBuild.runtimeVersion).toBe(first.nativeBuild.runtimeVersion);
    expect(second.baseline.contentHash).not.toBe(first.baseline.contentHash);
    expect(await readFile(join(scratch, 'first/completed-build.json'))).toEqual(original);
    await expect(build('first')).rejects.toThrow('EEXIST');
    const embeddedExport = join(
      scratch,
      'second/export',
      `ios-${second.nativeBuild.runtimeVersion}`,
    );
    await run(
      process.execPath,
      [
        cli,
        'rn',
        'export',
        '--project',
        project,
        '--native-inputs',
        join(scratch, 'second/native-inputs.json'),
        '--native-build',
        join(scratch, 'second/completed-build.json'),
        '--baseline-export',
        embeddedExport,
        '--version',
        'ota',
        '--output',
        join(scratch, 'ota'),
      ],
      { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
    );
    expect(
      await readFile(
        join(scratch, 'ota', `ios-${second.nativeBuild.runtimeVersion}`, 'private/baseline.zip'),
      ),
    ).toEqual(await readFile(join(embeddedExport, 'artifact.zip')));

    // Run the real phase, then simulate a failure after it. An old or even freshly
    // staged .app is insufficient: the parent Xcode process must succeed as well.
    const bin = join(scratch, 'bin');
    await mkdir(bin);
    await writeFile(
      join(bin, 'xcodebuild'),
      `#!/bin/sh
case " $* " in
  *' -showBuildSettings '*) exec /usr/bin/xcodebuild "$@" ;;
esac
if [ "$OTAKIT_TEST_SKIP_BUILD" = 1 ]; then exit 0; fi
/usr/bin/xcodebuild "$@" || exit $?
exit 47
`,
      { mode: 0o700 },
    );
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, OTAKIT_TEST_SKIP_BUILD: '0' };
    await expect(build('failed', env)).rejects.toThrow('Xcode build failed (47)');
    expect(
      JSON.parse(await readFile(join(scratch, 'failed/phase.json'), 'utf8')).runId,
    ).toBeTruthy();
    await expect(readFile(join(scratch, 'failed/completed-build.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(join(scratch, 'failed/HelloWorld.app/Info.plist'))).rejects.toMatchObject(
      { code: 'ENOENT' },
    );
    await expect(build('skipped', { ...env, OTAKIT_TEST_SKIP_BUILD: '1' })).rejects.toThrow(
      'phase did not run',
    );
    await expect(readFile(join(scratch, 'skipped/completed-build.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(join(scratch, 'first/completed-build.json'))).toEqual(original);
    await run(
      '/usr/bin/xcodebuild',
      [
        '-workspace',
        join(project, 'ios/HelloWorld.xcworkspace'),
        '-scheme',
        'HelloWorld',
        '-configuration',
        'Release',
        '-sdk',
        'iphonesimulator',
        '-destination',
        process.env.RN_XCODE_DESTINATION!,
        '-derivedDataPath',
        resolve(process.env.RN_XCODE_DERIVED_DATA!),
        'CODE_SIGNING_ALLOWED=NO',
        'SKIP_BUNDLING=1',
        'build',
      ],
      { timeout: 600_000, maxBuffer: 16 * 1024 * 1024 },
    );
    expect(
      await readFile(
        join(
          resolve(process.env.RN_XCODE_DERIVED_DATA!),
          'Build/Products/Release-iphonesimulator/HelloWorld.app/OtaKitFixture/configuration.json',
        ),
      ),
    ).toEqual(await readFile(join(project, 'ios/HelloWorld/OtaKitFixture/configuration.json')));
    console.log(`Xcode acceptance archives: ${scratch}`);
  }, 1_800_000);
});
