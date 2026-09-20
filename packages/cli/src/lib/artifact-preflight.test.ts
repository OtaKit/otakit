import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiClient } from './api.js';
import {
  inspectArtifacts,
  preflightArtifacts,
  validateEncryptedArchiveSize,
} from './artifact-preflight.js';
import { runUploadWorkflow } from './upload-workflow.js';
import { validateBundleDirectory } from './zip.js';

describe('upload artifact preflight', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'otakit-artifacts-'));
    writeFileSync(join(directory, 'index.html'), '<html>app</html>');
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('leaves a normal web build unchanged and quiet', () => {
    mkdirSync(join(directory, 'assets'));
    writeFileSync(join(directory, 'assets', 'main.js'), 'console.log(1)');
    const warning = vi.fn();
    const result = preflightArtifacts(directory, { onWarning: warning });
    expect(result.fileCount).toBe(2);
    expect(result.totalBytes).toBe(30);
    expect(warning).not.toHaveBeenCalled();
    expect(readFileSync(join(directory, 'index.html'), 'utf8')).toBe('<html>app</html>');
  });

  it('identifies an installer dominating the bundle without deleting it', () => {
    const installer = join(directory, 'DesktopSetup.EXE');
    writeFileSync(installer, '');
    truncateSync(installer, 80 * 1024 * 1024);
    const warning = vi.fn();
    const result = preflightArtifacts(directory, { onWarning: warning });
    expect(result.largestFiles[0]).toEqual({ path: 'DesktopSetup.EXE', bytes: 80 * 1024 * 1024 });
    expect(result.nativeArtifacts).toHaveLength(1);
    expect(result.warnings).toHaveLength(2);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('DesktopSetup.EXE'));
    expect(inspectArtifacts(directory).totalBytes).toBe(result.totalBytes);
  });

  it.each(['zip', 'deltas'] as const)(
    'strict %s preflight fails before any upload request',
    async (strategy) => {
      writeFileSync(join(directory, 'setup.exe'), 'installer');
      const initiateUpload = vi.fn();
      const api = { initiateUpload } as unknown as ApiClient;
      await expect(
        runUploadWorkflow({
          api,
          sourcePath: directory,
          version: '1.0',
          strategy,
          strictArtifacts: true,
          manageProcessSignals: false,
        }),
      ).rejects.toThrow('Artifact preflight failed');
      expect(initiateUpload).not.toHaveBeenCalled();
      expect(readFileSync(join(directory, 'setup.exe'), 'utf8')).toBe('installer');
    },
  );

  it('rejects directory and symlink index pages', () => {
    const index = join(directory, 'index.html');
    rmSync(index);
    mkdirSync(index);
    expect(() => validateBundleDirectory(directory)).toThrow('regular file');
    rmSync(index, { recursive: true });
    writeFileSync(join(directory, 'real.html'), '<html/>');
    symlinkSync('real.html', index);
    expect(() => validateBundleDirectory(directory)).toThrow('regular file');
  });

  it('rejects nested symlinks before packaging', () => {
    mkdirSync(join(directory, 'assets'));
    symlinkSync('../index.html', join(directory, 'assets', 'page.html'));
    expect(() => inspectArtifacts(directory)).toThrow('Unsupported symlink');
  });

  it('rejects a sparse object exceeding the native unpacked-byte limit', () => {
    const large = join(directory, 'large.bin');
    writeFileSync(large, '');
    truncateSync(large, 500_000_001);
    expect(() => inspectArtifacts(directory)).toThrow('500,000,000 bytes');
  });

  it('enforces the delta server file cap separately from ZIP capacity', () => {
    for (let index = 0; index < 5000; index++) writeFileSync(join(directory, `${index}.js`), '');
    expect(() => inspectArtifacts(directory, 'deltas')).toThrow('5000 files');
    expect(inspectArtifacts(directory, 'zip').fileCount).toBe(5001);
  });

  it('includes the authentication tag in the encrypted-object limit', () => {
    const maximum = 128 * 1024 * 1024;
    expect(() => validateEncryptedArchiveSize(maximum - 16)).not.toThrow();
    expect(() => validateEncryptedArchiveSize(maximum - 15)).toThrow('128 MiB');
  });
});
