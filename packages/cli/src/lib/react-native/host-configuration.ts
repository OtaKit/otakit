import { createPublicKey } from 'node:crypto';
import { canonicalJSON } from '@otakit/rn-protocol';
import { hashBuffer } from '../hash.js';

export const generatedHostFields = [
  'embeddedReceipt',
  'nativeBuildId',
  'reactNativeVersion',
  'hermesBytecodeVersion',
] as const;

export function hostConfigurationHash(value: unknown): string {
  return hashBuffer(Buffer.from(canonicalJSON(value)));
}

/** These settings are input to a native build; export-specific fields are generated later. */
export function parseHostConfiguration(bytes: Buffer): Record<string, unknown> {
  if (bytes.length > 1024 * 1024) throw new Error('Host configuration exceeds 1 MiB');
  const config = JSON.parse(bytes.toString('utf8'));
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new Error('Expected a host configuration object');
  const fields = ['cdnURL', 'ingestURL', 'channel', 'publicKeys', 'bundleKeys', 'allowLocalhost'];
  if (Object.keys(config).some((key) => !fields.includes(key)))
    throw new Error('Unknown or generated field in host configuration');
  if (config.allowLocalhost !== undefined && typeof config.allowLocalhost !== 'boolean')
    throw new Error('allowLocalhost must be a boolean');
  for (const field of ['cdnURL', 'ingestURL']) {
    if (field === 'ingestURL' && config[field] == null) continue;
    if (typeof config[field] !== 'string') throw new Error(`Missing host ${field}`);
    const url = new URL(config[field]);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !(
        url.protocol === 'https:' ||
        (config.allowLocalhost === true &&
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      )
    )
      throw new Error(`Invalid host ${field}`);
  }
  if (config.channel != null && (typeof config.channel !== 'string' || !config.channel.trim()))
    throw new Error('Host channel must be a nonempty string or null');
  for (const field of ['publicKeys', 'bundleKeys']) {
    const keys = config[field];
    if (
      !keys ||
      typeof keys !== 'object' ||
      Array.isArray(keys) ||
      (field === 'publicKeys' && !Object.keys(keys).length)
    )
      throw new Error(
        `Expected host ${field} object${field === 'publicKeys' ? ' with a trusted key' : ''}`,
      );
    for (const [id, value] of Object.entries(keys)) {
      if (
        !id ||
        typeof value !== 'string' ||
        !value ||
        Buffer.from(value, 'base64').toString('base64') !== value
      )
        throw new Error(`Invalid base64 key in host ${field}`);
      const key = Buffer.from(value, 'base64');
      if (field === 'bundleKeys') {
        if (key.length !== 32) throw new Error('Bundle keys must contain 32 bytes');
      } else {
        const publicKey = createPublicKey({ key, type: 'spki', format: 'der' });
        if (
          publicKey.asymmetricKeyType !== 'ec' ||
          publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
          !publicKey.export({ type: 'spki', format: 'der' }).equals(key)
        )
          throw new Error('Public keys must be P-256 SPKI DER');
      }
    }
  }
  return config;
}
