import { createWriteStream, existsSync, lstatSync, readdirSync } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { mkdir } from 'node:fs/promises';
import archiver, { type Archiver } from 'archiver';

import { CliError } from './errors.js';

export type ZipResult = {
  path: string;
  size: number;
};

export function validateBundleDirectory(directory: string): void {
  if (!existsSync(directory)) {
    throw new CliError(`Bundle directory does not exist: ${directory}`);
  }

  if (!lstatSync(directory).isDirectory()) {
    throw new CliError(`Not a directory: ${directory}`);
  }

  const indexPath = join(directory, 'index.html');
  if (!existsSync(indexPath)) {
    throw new CliError(
      `Missing index.html in ${directory}. Expected a Capacitor web build output.`,
    );
  }
}

function appendDirectory(archive: Archiver, sourceDirectory: string, relativePath: string): void {
  const currentPath = join(sourceDirectory, relativePath);
  const entries = readdirSync(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    const nextRelativePath = relativePath ? join(relativePath, entry.name) : entry.name;
    const absolutePath = join(sourceDirectory, nextRelativePath);
    const archiveName = nextRelativePath.split('\\').join(posix.sep);

    if (entry.isSymbolicLink()) {
      throw new CliError(
        [
          `Unsupported symlink in bundle output: ${archiveName}`,
          'Remove symlinks from the web build output before uploading.',
        ].join('\n'),
      );
    }
    if (entry.isDirectory()) {
      appendDirectory(archive, sourceDirectory, nextRelativePath);
      continue;
    }
    if (entry.isFile()) {
      archive.file(absolutePath, { name: archiveName });
    }
  }
}

export async function createZip(
  sourceDirectory: string,
  destinationZipPath: string,
): Promise<ZipResult> {
  validateBundleDirectory(sourceDirectory);

  await mkdir(dirname(destinationZipPath), { recursive: true });

  return new Promise<ZipResult>((resolve, reject) => {
    const output = createWriteStream(destinationZipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', async () => {
      try {
        const fileStats = await stat(destinationZipPath);
        resolve({
          path: destinationZipPath,
          size: fileStats.size,
        });
      } catch (error) {
        reject(error);
      }
    });

    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    appendDirectory(archive, sourceDirectory, '');
    archive.finalize().catch(reject);
  });
}

export async function removeFileIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      (error as NodeJS.ErrnoException).code !== 'ENOENT'
    ) {
      throw error;
    }
  }
}
