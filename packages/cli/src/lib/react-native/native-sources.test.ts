import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashResolvedNativeSource } from './native-sources.js';

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
