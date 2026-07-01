import { Platform } from '@prisma/client';

const CHANNEL_NAME_REGEX = /^[A-Za-z0-9._-]{1,64}$/;
const APP_SLUG_REGEX = /^[A-Za-z0-9._-]{3,120}$/;
const RUNTIME_VERSION_REGEX = /^[A-Za-z0-9._-]{1,64}$/;
const RESERVED_CHANNEL_NAMES = new Set(['base', 'default']);

export function parsePlatform(value: unknown): Platform | null {
  if (value === 'ios' || value === 'android') {
    return value;
  }
  return null;
}

export function parsePositiveInteger(
  value: unknown,
  { optional = false }: { optional?: boolean } = {},
): number | null | undefined {
  if (value === undefined || value === null) {
    return optional ? undefined : null;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

export function parseNonNegativeInteger(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

export function isValidChannelName(channel: string): boolean {
  return CHANNEL_NAME_REGEX.test(channel) && !RESERVED_CHANNEL_NAMES.has(channel.toLowerCase());
}

export function normalizeOptionalChannel(channel: unknown): string | null {
  if (typeof channel !== 'string') {
    return null;
  }

  const trimmed = channel.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed;
}

export function isValidRuntimeVersion(runtimeVersion: string): boolean {
  return RUNTIME_VERSION_REGEX.test(runtimeVersion);
}

export function normalizeOptionalRuntimeVersion(runtimeVersion: unknown): string | null {
  if (typeof runtimeVersion !== 'string') {
    return null;
  }

  const trimmed = runtimeVersion.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed;
}

export function isValidAppSlug(slug: string): boolean {
  return APP_SLUG_REGEX.test(slug);
}

const MAX_VERSION_LENGTH = 64;

export function isValidVersion(version: string): boolean {
  return version.length > 0 && version.length <= MAX_VERSION_LENGTH;
}

const MAX_METADATA_DEPTH = 5;
const MAX_METADATA_SIZE = 8192;

export function isValidMetadata(metadata: unknown): boolean {
  if (metadata === null || metadata === undefined) {
    return true;
  }
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }
  const json = JSON.stringify(metadata);
  if (json.length > MAX_METADATA_SIZE) {
    return false;
  }
  return checkDepth(metadata, 0, MAX_METADATA_DEPTH);
}

function checkDepth(obj: unknown, current: number, max: number): boolean {
  if (current > max) {
    return false;
  }
  if (typeof obj !== 'object' || obj === null) {
    return true;
  }
  for (const value of Object.values(obj)) {
    if (!checkDepth(value, current + 1, max)) {
      return false;
    }
  }
  return true;
}

const MAX_NATIVE_PACKAGES = 200;
const MAX_NATIVE_PACKAGES_SIZE = 32768;

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

/**
 * Validate the native package set the CLI attaches at upload time for the
 * compatibility guardrail. Shape per entry:
 * { name, version, requestedVersion?, iosChecksum?, androidChecksum? }
 */
export function isValidNativePackages(nativePackages: unknown): boolean {
  if (nativePackages === null || nativePackages === undefined) {
    return true;
  }
  if (!Array.isArray(nativePackages)) {
    return false;
  }
  if (nativePackages.length > MAX_NATIVE_PACKAGES) {
    return false;
  }
  if (JSON.stringify(nativePackages).length > MAX_NATIVE_PACKAGES_SIZE) {
    return false;
  }
  return nativePackages.every(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      !Array.isArray(entry) &&
      typeof (entry as Record<string, unknown>).name === 'string' &&
      typeof (entry as Record<string, unknown>).version === 'string' &&
      isOptionalString((entry as Record<string, unknown>).requestedVersion) &&
      isOptionalString((entry as Record<string, unknown>).iosChecksum) &&
      isOptionalString((entry as Record<string, unknown>).androidChecksum),
  );
}
