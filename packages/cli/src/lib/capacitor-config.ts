import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

export const CAPACITOR_CONFIG_FILE_NAMES = [
  'capacitor.config.ts',
  'capacitor.config.js',
  'capacitor.config.mjs',
  'capacitor.config.cjs',
  'capacitor.config.json',
] as const;

type UnknownRecord = Record<string, unknown>;

export interface CapacitorProjectConfig {
  configPath: string;
  appId?: string;
  channel?: string;
  configuredServerUrl?: string;
  outputDir?: string;
}

export function readCapacitorProjectConfig(
  cwd: string = process.cwd(),
): CapacitorProjectConfig | null {
  const configPath = findCapacitorConfigPath(cwd);
  if (!configPath) {
    return null;
  }

  const rawConfig = loadCapacitorConfigFile(configPath);
  return extractProjectConfig(configPath, rawConfig);
}

export function findCapacitorConfigPath(cwd: string = process.cwd()): string | null {
  let currentDir = resolve(cwd);

  while (true) {
    for (const fileName of CAPACITOR_CONFIG_FILE_NAMES) {
      const candidate = resolve(currentDir, fileName);
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

function loadCapacitorConfigFile(configPath: string): unknown {
  const extension = extname(configPath).toLowerCase();
  const source = readFileSync(configPath, 'utf-8');

  if (extension === '.json') {
    try {
      return JSON.parse(source) as unknown;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown parse error';
      throw new Error(`${configPath} is not valid JSON: ${reason}`);
    }
  }

  return evaluateCapacitorConfigModule(configPath, source);
}

function evaluateCapacitorConfigModule(configPath: string, source: string): unknown {
  let normalizedSource = source.replace(/^\uFEFF/, '');
  normalizedSource = normalizedSource.replace(/^\s*import\s+type[\s\S]*?;?\s*$/gm, '');
  normalizedSource = normalizedSource.replace(
    /\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*:\s*[^=;\n]+=/g,
    '$1 $2 =',
  );
  normalizedSource = normalizedSource.replace(/\s+satisfies\s+[^;\n]+/g, '');
  normalizedSource = normalizedSource.replace(/\s+as\s+const\b/g, '');

  if (/^\s*import\s/m.test(normalizedSource)) {
    throw new Error(
      `${configPath} uses runtime imports. OtaKit can read capacitor config files that only use inline values, process.env, and type-only imports.`,
    );
  }

  normalizedSource = normalizedSource.replace(/\bexport\s+default\b/, 'return');
  normalizedSource = normalizedSource.replace(/\bmodule\.exports\s*=\s*/g, 'return ');
  normalizedSource = normalizedSource.replace(/\bexports\.default\s*=\s*/g, 'return ');

  try {
    const evaluator = new Function(
      'defineConfig',
      'process',
      `"use strict";\n${normalizedSource}`,
    ) as (defineConfig: <T>(value: T) => T, process: NodeJS.Process) => unknown;

    return evaluator((value) => value, process);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown evaluation error';
    throw new Error(
      `${configPath} could not be evaluated. Keep capacitor config simple or use CLI flags/env overrides. ${reason}`,
    );
  }
}

function extractProjectConfig(configPath: string, rawConfig: unknown): CapacitorProjectConfig {
  if (!isRecord(rawConfig)) {
    throw new Error(`${configPath} must export a config object.`);
  }

  const plugins = asOptionalRecord(rawConfig.plugins, `${configPath}.plugins`);
  const otaKitConfig = asOptionalRecord(plugins?.OtaKit, `${configPath}.plugins.OtaKit`);

  return {
    configPath,
    appId: readOptionalString(otaKitConfig?.appId, `${configPath}.plugins.OtaKit.appId`),
    channel: readOptionalString(otaKitConfig?.channel, `${configPath}.plugins.OtaKit.channel`),
    configuredServerUrl: readOptionalString(
      otaKitConfig?.serverUrl,
      `${configPath}.plugins.OtaKit.serverUrl`,
    ),
    outputDir: readOptionalString(rawConfig.webDir, `${configPath}.webDir`),
  };
}

function asOptionalRecord(value: unknown, fieldPath: string): UnknownRecord | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`${fieldPath} must be an object.`);
  }
  return value;
}

function readOptionalString(value: unknown, fieldPath: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`${fieldPath} must be a string.`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
