import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

const ALGORITHM = 'aes-256-gcm';
const NONCE_LENGTH = 12;
const KEY_LENGTH = 32;

export const ENCRYPTION_ALG = 'AES-256-GCM';

export interface BundleEncryptionParams {
  alg: string;
  kid: string;
  wrapNonce: string;
  wrappedDek: string;
  nonce: string;
}

/**
 * Derive the key ID from a bundle encryption key: first 16 hex chars of
 * sha256(key bytes). Must match generate-encryption-key output.
 */
export function deriveKid(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export function generateEncryptionKey(): { kid: string; key: Buffer } {
  const key = randomBytes(KEY_LENGTH);
  return { kid: deriveKid(key), key };
}

export function parseEncryptionKey(base64: string): Buffer {
  const key = Buffer.from(base64.trim(), 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `Invalid encryption key: expected ${KEY_LENGTH} bytes (base64), got ${key.length} bytes.`,
    );
  }
  return key;
}

/**
 * Wrap a per-bundle DEK under the app KEK with AES-256-GCM.
 * Returns base64 wrapNonce and wrappedDek (ciphertext with tag appended).
 */
export function wrapDek(kek: Buffer, dek: Buffer): { wrapNonce: string; wrappedDek: string } {
  const wrapNonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv(ALGORITHM, kek, wrapNonce);
  const wrapped = Buffer.concat([cipher.update(dek), cipher.final(), cipher.getAuthTag()]);
  return {
    wrapNonce: wrapNonce.toString('base64'),
    wrappedDek: wrapped.toString('base64'),
  };
}

/**
 * Encrypt a file with AES-256-GCM under a fresh random DEK, streaming
 * plaintext through the cipher and appending the GCM tag to the output.
 */
export async function encryptFile(
  kek: Buffer,
  inputPath: string,
  outputPath: string,
): Promise<BundleEncryptionParams> {
  const dek = randomBytes(KEY_LENGTH);
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv(ALGORITHM, dek, nonce);

  const appendTag = new Transform({
    transform(chunk, _encoding, callback) {
      callback(null, chunk);
    },
    flush(callback) {
      // cipher.final() has run by the time flush is reached in the pipeline
      callback(null, cipher.getAuthTag());
    },
  });

  await pipeline(createReadStream(inputPath), cipher, appendTag, createWriteStream(outputPath));

  const { wrapNonce, wrappedDek } = wrapDek(kek, dek);
  return {
    alg: ENCRYPTION_ALG,
    kid: deriveKid(kek),
    wrapNonce,
    wrappedDek,
    nonce: nonce.toString('base64'),
  };
}
