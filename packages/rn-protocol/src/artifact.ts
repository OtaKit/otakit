import { createHash } from 'node:crypto';
import type { DeltaFileEntry } from './inventory.js';

export type RNPlatform = 'ios' | 'android';
export interface EmbeddedReceipt {
  appId: string;
  framework: 'react-native';
  platform: RNPlatform;
  runtimeVersion: string;
  version: string;
  embeddedContentHash: string;
}
export interface RNDescriptor {
  format: 'otakit-rn';
  formatVersion: 1;
  framework: 'react-native';
  platform: RNPlatform;
  runtimeVersion: string;
  version: string;
  entryPoint: 'index.bundle';
  engine: 'hermes';
  bundleFormat: 'hermes-bytecode';
  reactNativeVersion: string;
  expo?: { configFile: 'expo-config.json'; domRoot?: 'www.bundle' };
}

export function hashInventory(files: DeltaFileEntry[]): string {
  return createHash('sha256')
    .update(
      files
        .slice()
        .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))
        .map((file) => `${file.path}:${file.sha256}`)
        .join('\n'),
    )
    .digest('hex');
}

export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (typeof value === 'object' && value)
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJSON(item)}`)
      .join(',')}}`;
  throw new Error('Canonical records may contain only JSON values');
}

export function assertRuntime(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(value) ||
    Buffer.from(value, 'base64url').toString('base64url') !== value
  )
    throw new Error('Expected a canonical RN native runtime digest');
}

export function assertDescriptor(raw: unknown): asserts raw is RNDescriptor {
  const descriptor = raw as RNDescriptor | null;
  if (
    !descriptor ||
    descriptor.format !== 'otakit-rn' ||
    descriptor.formatVersion !== 1 ||
    descriptor.framework !== 'react-native' ||
    !['ios', 'android'].includes(descriptor.platform) ||
    descriptor.entryPoint !== 'index.bundle' ||
    descriptor.engine !== 'hermes' ||
    descriptor.bundleFormat !== 'hermes-bytecode' ||
    typeof descriptor.version !== 'string' ||
    !descriptor.version ||
    descriptor.version.length > 64 ||
    /[\u0000-\u001f\u007f]/.test(descriptor.version) ||
    typeof descriptor.reactNativeVersion !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(descriptor.reactNativeVersion) ||
    (descriptor.expo !== undefined &&
      (!descriptor.expo ||
        descriptor.expo.configFile !== 'expo-config.json' ||
        (descriptor.expo.domRoot !== undefined && descriptor.expo.domRoot !== 'www.bundle')))
  )
    throw new Error('Invalid RN artifact descriptor');
  assertRuntime(descriptor.runtimeVersion);
}

export function hermesBytecodeVersion(bytes: Buffer): number {
  if (bytes.length < 12 || bytes.subarray(0, 8).toString('hex') !== 'c61fbc03c103191f')
    throw new Error('Expected Hermes bytecode from the native build compiler');
  return bytes.readUInt32LE(8);
}
