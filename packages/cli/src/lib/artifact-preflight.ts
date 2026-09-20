import { lstatSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';

import { CliError } from './errors.js';
import { validateBundleDirectory } from './zip.js';

const MIB = 1024 * 1024;
const MAX_UNPACKED_BYTES = 500_000_000;
const INSTALLER = /\.(exe|msi|dmg|pkg|apk|ipa|appx|msix|deb|rpm)$/i;
type Artifact = { path: string; bytes: number };

export type ArtifactInspection = {
  fileCount: number;
  totalBytes: number;
  largestFiles: Artifact[];
  nativeArtifacts: Artifact[];
  warnings: string[];
};

/** Inspect metadata only; never remove or silently exclude application assets. */
export function inspectArtifacts(
  directory: string,
  strategy: 'zip' | 'deltas' = 'zip',
): ArtifactInspection {
  validateBundleDirectory(directory);
  const files: Artifact[] = [];
  const maximumFiles = strategy === 'deltas' ? 5000 : 10_000;
  let totalBytes = 0;
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(directory, relative), { withFileTypes: true })) {
      const path = relative ? posix.join(relative, entry.name) : entry.name;
      if (entry.isSymbolicLink()) {
        throw new CliError(`Unsupported symlink in bundle output: ${JSON.stringify(path)}`);
      }
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.isFile()) {
        throw new CliError(`Unsupported non-file artifact: ${JSON.stringify(path)}`);
      }
      const bytes = lstatSync(join(directory, path)).size;
      totalBytes += bytes;
      files.push({ path, bytes });
      if (files.length > maximumFiles) {
        throw new CliError(`Bundle exceeds the ${strategy} limit of ${maximumFiles} files.`);
      }
      if (totalBytes > MAX_UNPACKED_BYTES) {
        throw new CliError(
          'Bundle exceeds the native extraction limit of 500,000,000 bytes. Reduce its assets before uploading.',
        );
      }
    }
  };
  walk('');
  const largestFiles = [...files]
    .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path))
    .slice(0, 5);
  const nativeArtifacts = files.filter(
    (file) =>
      INSTALLER.test(file.path) ||
      file.path.split('/').some((part) => part.toLowerCase().endsWith('.app')),
  );
  const warnings: string[] = [];
  if (nativeArtifacts.length > 0) {
    const examples = nativeArtifacts
      .slice(0, 5)
      .map((file) => `${JSON.stringify(file.path)} (${(file.bytes / MIB).toFixed(1)} MiB)`)
      .join(', ');
    warnings.push(
      `Bundle contains ${nativeArtifacts.length} native installer/artifact file(s): ${examples}. Confirm these belong in the mobile web bundle; otherwise publish them separately.`,
    );
  }
  if (totalBytes >= 50 * MIB || largestFiles.some((file) => file.bytes >= 10 * MIB)) {
    const examples = largestFiles
      .map((file) => `${JSON.stringify(file.path)} (${(file.bytes / MIB).toFixed(1)} MiB)`)
      .join(', ');
    warnings.push(
      `Large bundle: ${(totalBytes / MIB).toFixed(1)} MiB across ${files.length} files. Large downloads increase timeout, storage, and memory pressure. Largest files: ${examples}.`,
    );
  }
  return { fileCount: files.length, totalBytes, largestFiles, nativeArtifacts, warnings };
}

export function preflightArtifacts(
  directory: string,
  options: {
    strategy?: 'zip' | 'deltas';
    strict?: boolean;
    onWarning?: (message: string) => void;
  } = {},
): ArtifactInspection {
  const inspection = inspectArtifacts(directory, options.strategy);
  if (options.strict && inspection.warnings.length > 0) {
    throw new CliError(`Artifact preflight failed:\n${inspection.warnings.join('\n')}`);
  }
  for (const warning of inspection.warnings) (options.onWarning ?? console.warn)(warning);
  return inspection;
}

export function validateEncryptedArchiveSize(zipBytes: number): void {
  if (zipBytes + 16 > 128 * MIB) {
    throw new CliError(
      'Encrypted bundle exceeds the native 128 MiB limit (including its authentication tag). Reduce the bundle before uploading.',
    );
  }
}
