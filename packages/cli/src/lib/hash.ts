import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/**
 * Calculate SHA-256 hash of a file
 */
export async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Calculate SHA-256 (hex) and MD5 (base64) of a file in one read.
 * The MD5 is pinned into presigned PUTs as Content-MD5 so storage rejects
 * an upload whose bytes don't match what was hashed.
 */
export async function hashFileWithMd5(filePath: string): Promise<{ sha256: string; md5: string }> {
  return new Promise((resolve, reject) => {
    const sha256 = createHash('sha256');
    const md5 = createHash('md5');
    const stream = createReadStream(filePath);

    stream.on('data', (data) => {
      sha256.update(data);
      md5.update(data);
    });
    stream.on('end', () => resolve({ sha256: sha256.digest('hex'), md5: md5.digest('base64') }));
    stream.on('error', reject);
  });
}

/**
 * Calculate SHA-256 hash of a buffer
 */
export function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
