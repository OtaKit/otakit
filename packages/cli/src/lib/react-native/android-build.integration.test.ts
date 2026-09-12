import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { hashFile } from '../hash.js';
import type { CompletedNativeBuild } from './completed-build.js';

const nativeDescribe = process.env.RUN_RN_GRADLE_TESTS === '1' ? describe : describe.skip;
nativeDescribe('Android generated assets and completed APK task ordering', () => {
  it('preserves Debug assets and requires an explicit Hermes Release opt-in', async () => {
    if (!process.env.RN_GRADLE_NATIVE_INPUTS)
      throw new Error('Set RN_GRADLE_NATIVE_INPUTS to Android inputs with recorded host settings');
    const project = fileURLToPath(
      new URL('../../../../../examples/react-native-app/', import.meta.url),
    );
    const run = (...args: string[]) =>
      promisify(execFile)(join(project, 'android/gradlew'), args, {
        cwd: join(project, 'android'),
        timeout: 120_000,
        maxBuffer: 8 * 1024 * 1024,
      });
    const selected = `-PotakitNativeInputs=${resolve(process.env.RN_GRADLE_NATIVE_INPUTS)}`;
    const ordinary = await run(':app:assembleRelease', '--dry-run');
    expect(ordinary.stdout).not.toContain('OtaKit');
    const debug = await run(':app:mergeDebugAssets', selected);
    expect(debug.stdout).not.toContain(':app:prepareOtaKitRelease');
    expect(
      await readFile(
        join(
          project,
          'android/app/build/intermediates/assets/debug/mergeDebugAssets/OtaKitFixture/payload/index.bundle',
        ),
      ),
    ).toEqual(
      await readFile(
        join(project, 'android/app/src/main/assets/OtaKitFixture/payload/index.bundle'),
      ),
    );
    await expect(
      run(':app:assembleRelease', selected, '-PhermesEnabled=false', '--dry-run'),
    ).rejects.toThrow('non-debuggable Hermes variant');
  }, 180_000);

  it('retains separate builds and does not seal an old APK after packaging failure', async () => {
    if (!process.env.RN_GRADLE_NATIVE_INPUTS)
      throw new Error('Set RN_GRADLE_NATIVE_INPUTS to Android inputs with recorded host settings');
    const project = fileURLToPath(
      new URL('../../../../../examples/react-native-app/', import.meta.url),
    );
    const scratch = await mkdtemp(join(tmpdir(), 'otakit-gradle-test-'));
    const runs = join(project, 'android/app/build/otakit/release');
    const apk = join(project, 'android/app/build/outputs/apk/release/app-release.apk');
    const gradle = (...args: string[]) =>
      promisify(execFile)(
        join(project, 'android/gradlew'),
        [
          ':app:assembleRelease',
          '-PreactNativeArchitectures=arm64-v8a',
          `-PotakitNativeInputs=${resolve(process.env.RN_GRADLE_NATIVE_INPUTS!)}`,
          ...args,
        ],
        { cwd: join(project, 'android'), timeout: 240_000, maxBuffer: 8 * 1024 * 1024 },
      );
    const readCompleted = async (stdout: string) => {
      const directory = /^OtaKit completed build: (.+)$/m.exec(stdout)?.[1];
      expect(directory).toBeTruthy();
      const receipt = JSON.parse(
        await readFile(join(directory!, 'completed-build.json'), 'utf8'),
      ) as CompletedNativeBuild;
      expect(await hashFile(join(directory!, 'application.apk'))).toBe(receipt.binary.sha256);
      expect(await hashFile(apk)).toBe(receipt.binary.sha256);
      expect(receipt.nativeBuild.identity.nativeConfiguration.androidBuild).toMatchObject({
        namespace: 'com.helloworld',
        minSdk: 24,
        compileSdk: 36,
        architectures: 'arm64-v8a',
        runtimeArtifacts: expect.arrayContaining([
          expect.objectContaining({ id: expect.stringContaining('hermes-android') }),
        ]),
      });
      expect(receipt.nativeBuild.identity.nativeFiles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: expect.stringContaining('scripts/android.gradle') }),
          expect.objectContaining({ path: expect.stringContaining('android.jar') }),
          expect.objectContaining({ path: expect.stringContaining('hermes-android') }),
        ]),
      );
      expect(stdout).not.toContain(':app:createBundleReleaseJsAndAssets');
      return { directory: directory!, receipt };
    };
    try {
      const first = await readCompleted((await gradle('-PotakitEmbeddedVersion=embedded')).stdout);
      const firstBytes = await readFile(join(first.directory, 'completed-build.json'));
      const second = await readCompleted(
        (await gradle('-PotakitEmbeddedVersion=embedded-next')).stdout,
      );
      expect(second.directory).not.toBe(first.directory);
      expect(second.receipt.nativeBuild.runtimeVersion).toBe(
        first.receipt.nativeBuild.runtimeVersion,
      );
      expect(second.receipt.baseline.contentHash).not.toBe(first.receipt.baseline.contentHash);
      expect(await readFile(join(first.directory, 'completed-build.json'))).toEqual(firstBytes);
      expect(await hashFile(join(first.directory, 'application.apk'))).toBe(
        first.receipt.binary.sha256,
      );

      // The same record must remain usable after the Gradle process exits.
      const cli = fileURLToPath(new URL('../../../dist/index.js', import.meta.url));
      const otaOutput = join(scratch, 'ota');
      await promisify(execFile)(
        process.execPath,
        [
          cli,
          'rn',
          'export',
          '--project',
          project,
          '--native-inputs',
          join(second.directory, 'native-inputs.json'),
          '--native-build',
          join(second.directory, 'completed-build.json'),
          '--baseline-export',
          join(second.directory, 'export', `android-${second.receipt.nativeBuild.runtimeVersion}`),
          '--version',
          'ota-from-gradle',
          '--output',
          otaOutput,
        ],
        {
          timeout: 120_000,
          maxBuffer: 8 * 1024 * 1024,
        },
      );
      const ota = join(otaOutput, `android-${second.receipt.nativeBuild.runtimeVersion}`);
      expect(await hashFile(join(ota, 'private/baseline.zip'))).toBe(
        second.receipt.baseline.sha256,
      );

      const injection = join(scratch, 'fail-packaging.gradle');
      await writeFile(
        injection,
        `gradle.projectsEvaluated {
    def application = gradle.rootProject.findProject(':app')
    if (application != null) {
        application.tasks.named('packageRelease').configure {
            doFirst { throw new GradleException('OTAKIT_TEST_PACKAGING_FAILURE') }
        }
    }
}
`,
      );
      const before = new Set(await readdir(runs));
      await expect(
        gradle('-PotakitEmbeddedVersion=failed-build', '--init-script', injection),
      ).rejects.toThrow('OTAKIT_TEST_PACKAGING_FAILURE');
      const failed = (await readdir(runs)).filter((name) => !before.has(name));
      expect(failed).toHaveLength(1);
      await expect(readFile(join(runs, failed[0], 'completed-build.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(readFile(join(runs, failed[0], 'application.apk'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      // AGP may remove its previous APK output before the failing task action runs.
      // The immutable archives must survive regardless of that platform cleanup behavior.
      expect(await hashFile(join(second.directory, 'application.apk'))).toBe(
        second.receipt.binary.sha256,
      );
      expect(await readFile(join(first.directory, 'completed-build.json'))).toEqual(firstBytes);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }, 720_000);
});
