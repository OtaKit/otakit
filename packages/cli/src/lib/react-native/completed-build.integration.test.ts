import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hashBuffer } from '../hash.js';
import { completedBuildHash, type CompletedNativeBuild } from './completed-build.js';
import type { RNExportReceipt } from './export-receipt.js';
import { verifyRNArchive } from './artifacts.js';

const nativeDescribe = process.env.RUN_RN_BUILD_TESTS === '1' ? describe : describe.skip;
nativeDescribe('completed native package and OTA baseline provenance', () => {
  it('seals the actual binary, exports an OTA and preserves its original baseline bytes', async () => {
    if (!process.env.RN_BASELINE_EXPORT || !process.env.RN_NATIVE_BINARY)
      throw new Error('Set RN_BASELINE_EXPORT and RN_NATIVE_BINARY to the matching built fixture');
    const project = fileURLToPath(
      new URL('../../../../../examples/react-native-app/', import.meta.url),
    );
    const baselineExport = resolve(process.env.RN_BASELINE_EXPORT);
    const output = process.env.RN_BUILD_TEST_OUTPUT
      ? resolve(process.env.RN_BUILD_TEST_OUTPUT)
      : await mkdtemp(join(tmpdir(), 'otakit-completed-build-test-'));
    try {
      // Keep all native input capture outside Vitest: its module resolver can change
      // both compiler discovery and the source inventory seen by fingerprinting.
      const cli = fileURLToPath(new URL('../../../dist/index.js', import.meta.url));
      const scope = [
        '--project',
        project,
        '--native-inputs',
        join(baselineExport, 'private/native-inputs.json'),
      ];
      await promisify(execFile)(
        process.execPath,
        [
          cli,
          'rn',
          'seal-build',
          ...scope,
          '--embedded-export',
          baselineExport,
          '--binary',
          resolve(process.env.RN_NATIVE_BINARY),
          '--receipt',
          join(output, 'completed-build.json'),
          ...(process.env.RN_AAPT2 ? ['--aapt2', process.env.RN_AAPT2] : []),
        ],
        { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
      );
      const completed = JSON.parse(
        await readFile(join(output, 'completed-build.json'), 'utf8'),
      ) as CompletedNativeBuild;
      await promisify(execFile)(
        process.execPath,
        [
          cli,
          'rn',
          'export',
          ...scope,
          '--native-build',
          join(output, 'completed-build.json'),
          '--baseline-export',
          baselineExport,
          '--version',
          'ota-after-native-build',
          '--output',
          join(output, 'ota'),
        ],
        { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
      );
      const directory = join(
        output,
        'ota',
        `${completed.baseline.platform}-${completed.nativeBuild.runtimeVersion}`,
      );
      const ota = JSON.parse(
        await readFile(join(directory, 'export.json'), 'utf8'),
      ) as RNExportReceipt;
      expect(ota.purpose).toBe('ota');
      if (ota.purpose !== 'ota') throw new Error('Expected OTA export');
      expect(ota.contentHash).not.toBe(completed.baseline.contentHash);
      expect(ota.baseline.embeddedReceipt).toEqual(completed.baseline.embeddedReceipt);
      expect(ota.baseline.embeddedReceipt.version).toBe('embedded');
      expect(ota.baseline.completedBuildHash).toBe(completedBuildHash(completed));
      expect(hashBuffer(await readFile(join(directory, ota.baseline.archive)))).toBe(
        completed.baseline.sha256,
      );
      expect(
        JSON.parse(await readFile(join(directory, ota.baseline.exportReceipt), 'utf8')),
      ).toEqual(completed.baseline);
      await verifyRNArchive(await readFile(join(directory, 'artifact.zip')), ota.files);
      await expect(access(join(directory, 'otakit-embedded.json'))).rejects.toThrow();
      expect(
        ota.files.some((file) => file.path.startsWith('private/') || file.path.endsWith('.map')),
      ).toBe(false);
    } finally {
      if (!process.env.RN_BUILD_TEST_OUTPUT) await rm(output, { recursive: true, force: true });
    }
  }, 240_000);
});
