import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFingerprintAsync } from '@expo/fingerprint';
import { hashResolvedNativeSource, RN_FINGERPRINT_IGNORES } from './native-sources.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const project = await mkdtemp(join(tmpdir(), 'otakit-native-source-'));
  directories.push(project);
  const native = join(project, 'android');
  await mkdir(join(native, 'app/src/main/assets/OtaKitFixture'), { recursive: true });
  await writeFile(join(native, 'build.gradle'), 'plugins {}');
  await writeFile(join(native, 'app/src/main/Application.kt'), 'original native host');
  return { project, native };
}
describe('resolved native source evidence', () => {
  it('keeps the upstream Android fingerprint stable across Kotlin session cleanup without ignoring native edits', async () => {
    const { project, native } = await fixture();
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({ name: 'native-fixture', version: '1.0.0' }),
    );
    await writeFile(join(native, 'app/build.gradle'), 'plugins {}');
    await writeFile(
      join(native, 'app/src/main/AndroidManifest.xml'),
      '<manifest package="test.native" />',
    );
    const fingerprint = async (ignorePaths: string[]) => {
      const value = await createFingerprintAsync(project, {
        platforms: ['android'],
        ignorePaths,
        silent: true,
      });
      const source = value.sources.find(
        (item) => 'filePath' in item && item.filePath === 'android',
      );
      expect(source?.hash).toBeTruthy();
      return source!.hash;
    };
    const original = await fingerprint(RN_FINGERPRINT_IGNORES);
    const session = join(native, '.kotlin/sessions');
    await mkdir(session, { recursive: true });
    await writeFile(join(session, 'kotlin-compiler-123.salive'), '');
    expect(await fingerprint([])).not.toBe(original); // Reproduces the upstream failure.
    expect(await fingerprint(RN_FINGERPRINT_IGNORES)).toBe(original);
    await rm(session, { recursive: true });
    expect(await fingerprint(RN_FINGERPRINT_IGNORES)).toBe(original);
    await writeFile(join(native, 'app/src/main/Application.kt'), 'changed native implementation');
    expect(await fingerprint(RN_FINGERPRINT_IGNORES)).not.toBe(original);
  }, 15_000);

  it('includes generated native projects and source edits but excludes package build outputs and its own receipts', async () => {
    const { project, native } = await fixture();
    const original = await hashResolvedNativeSource(project, native, 'OtaKitFixture');
    expect(original.fileCount).toBe(2);
    await mkdir(join(native, 'app/build'), { recursive: true });
    await writeFile(join(native, 'app/build/app.apk'), 'build output');
    await writeFile(
      join(native, 'app/src/main/assets/OtaKitFixture/otakit-embedded.json'),
      'generated receipt',
    );
    expect(await hashResolvedNativeSource(project, native, 'OtaKitFixture')).toEqual(original);
    await writeFile(join(native, 'app/src/main/Application.kt'), 'changed native host');
    expect((await hashResolvedNativeSource(project, native, 'OtaKitFixture')).sha256).not.toBe(
      original.sha256,
    );
  });
  it('rejects unresolved native symlinks instead of silently losing their source evidence', async () => {
    const { project, native } = await fixture();
    await symlink(join(native, 'build.gradle'), join(native, 'linked.gradle'));
    await expect(hashResolvedNativeSource(project, native, 'OtaKitFixture')).rejects.toThrow(
      'Unresolved symlink',
    );
  });
  it('only excludes generated resources from the application, retaining dependency directories with the same name', async () => {
    const { project } = await fixture();
    const dependency = join(project, 'dependency');
    await mkdir(join(dependency, 'OtaKitFixture'), { recursive: true });
    await writeFile(join(dependency, 'OtaKitFixture/Native.kt'), 'dependency implementation');
    expect((await hashResolvedNativeSource(project, dependency, 'OtaKitFixture')).fileCount).toBe(
      1,
    );
    await expect(hashResolvedNativeSource(project, dependency, '../')).rejects.toThrow(
      'single generated',
    );
  });
});
