import { resolve } from 'node:path';

import { CAPACITOR_CONFIG_FILE_NAMES, readCapacitorProjectConfig } from './capacitor-config.js';
import { readStoredAccessToken } from './token-store.js';

const API_PATH_SUFFIX = '/api/v1';
const DEFAULT_SERVER_URL = 'https://console.otakit.app';
export const PROJECT_CONFIG_LABEL = 'capacitor.config.*';

const HOSTED_PRIMARY_HOST = 'otakit.app';
const HOSTED_CANONICAL_HOST = 'console.otakit.app';

export type AuthSource = 'env_token' | 'env_access_token' | 'file' | 'env_secret_key';

export type ConfigValueSource = 'flag' | 'env' | 'config' | 'default' | 'file' | 'none';

export interface ResolvedValue<T> {
  value: T;
  source: ConfigValueSource;
}

export interface ResolvedAuthToken {
  token: string;
  source: AuthSource;
}

export interface ServerAuthConfig {
  serverUrl: string;
  authToken: string;
  authSource: AuthSource;
}

export interface ProjectConfig {
  appId?: string;
  channel?: string;
  runtimeVersion?: string;
  configuredServerUrl?: string;
  outputDir?: string;
}

export interface CliConfig extends ServerAuthConfig {
  appId: string;
  channel?: string;
  runtimeVersion?: string;
  outputDir?: string;
}

export interface ConfigResolveOptions {
  cwd?: string;
  appId?: string;
  serverUrl?: string;
  outputDir?: string;
  channel?: string;
  requireProjectConfig?: boolean;
}

export interface ConfigResolveSnapshot {
  configFile: {
    path: string;
    found: boolean;
  };
  appId: ResolvedValue<string | null>;
  serverUrl: ResolvedValue<string>;
  outputDir: ResolvedValue<string | null>;
  channel: ResolvedValue<string | null>;
  runtimeVersion: ResolvedValue<string | null>;
  authToken: ResolvedValue<string | null>;
  authSource: AuthSource | null;
}

export function normalizeServerUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  const withoutApiPath = trimmed.endsWith(API_PATH_SUFFIX)
    ? trimmed.slice(0, -API_PATH_SUFFIX.length)
    : trimmed;

  try {
    const parsed = new URL(withoutApiPath);
    if (parsed.hostname === HOSTED_PRIMARY_HOST) {
      parsed.hostname = HOSTED_CANONICAL_HOST;
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return withoutApiPath;
  }
}

function toNonEmptyString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function validateServerUrl(rawServerUrl: string): string {
  const serverUrl = normalizeServerUrl(rawServerUrl);

  try {
    new URL(serverUrl);
  } catch {
    throw new Error(`Invalid server URL "${rawServerUrl}". Set OTAKIT_SERVER_URL to a valid URL.`);
  }

  return serverUrl;
}

export function resolveServerUrl(
  _cwd: string = process.cwd(),
  explicitServerUrl?: string,
  configuredServerUrl?: string,
): string {
  const rawServerUrl =
    toNonEmptyString(explicitServerUrl) ??
    toNonEmptyString(process.env.OTAKIT_SERVER_URL) ??
    toNonEmptyString(configuredServerUrl) ??
    DEFAULT_SERVER_URL;

  return validateServerUrl(rawServerUrl);
}

export async function resolveAuthToken(serverUrl: string): Promise<ResolvedAuthToken | null> {
  const token = toNonEmptyString(process.env.OTAKIT_TOKEN);
  if (token) {
    return { token, source: 'env_token' };
  }

  const storedToken = await readStoredAccessToken(serverUrl);
  if (storedToken) {
    return { token: storedToken, source: 'file' };
  }

  return null;
}

export async function requireServerAndAuth(options?: {
  cwd?: string;
  serverUrl?: string;
  projectServerUrl?: string;
}): Promise<ServerAuthConfig> {
  const cwd = options?.cwd ?? process.cwd();
  const serverUrl = resolveServerUrl(cwd, options?.serverUrl, options?.projectServerUrl);
  const auth = await resolveAuthToken(serverUrl);

  if (!auth) {
    throw new Error(
      [
        'Missing authentication:',
        '- Run `otakit login`',
        '- or set OTAKIT_TOKEN env var',
      ].join('\n'),
    );
  }

  return {
    serverUrl,
    authToken: auth.token,
    authSource: auth.source,
  };
}

export function readProjectConfig(cwd: string = process.cwd()): ProjectConfig | null {
  const projectConfig = readCapacitorProjectConfig(cwd);
  if (!projectConfig) {
    return null;
  }

  return {
    appId: projectConfig.appId,
    channel: projectConfig.channel,
    runtimeVersion: projectConfig.runtimeVersion,
    configuredServerUrl: projectConfig.configuredServerUrl
      ? parseServerUrl(projectConfig.configuredServerUrl, cwd)
      : undefined,
    outputDir: projectConfig.outputDir,
  };
}

export function requireProjectConfig(cwd: string = process.cwd()): ProjectConfig {
  const config = readProjectConfig(cwd);
  if (!config) {
    throw new Error(
      [
        `No ${PROJECT_CONFIG_LABEL} found in the current directory or its parents.`,
        '- Add plugins.OtaKit to capacitor.config.ts',
        '- or pass CLI flags / environment variables directly',
      ].join('\n'),
    );
  }
  return config;
}

function resolveEnvOutputDir(): string | undefined {
  return (
    toNonEmptyString(process.env.OTAKIT_BUILD_DIR) ??
    toNonEmptyString(process.env.OTAKIT_OUTPUT_DIR)
  );
}

function toAuthValueSource(source: AuthSource | null): ConfigValueSource {
  if (!source) {
    return 'none';
  }
  if (source === 'file') {
    return 'file';
  }
  return 'env';
}

export async function resolveConfigSnapshot(
  options?: ConfigResolveOptions,
): Promise<ConfigResolveSnapshot> {
  const cwd = options?.cwd ?? process.cwd();
  const capacitorProjectConfig = readCapacitorProjectConfig(cwd);
  const configPath =
    capacitorProjectConfig?.configPath ?? resolve(cwd, CAPACITOR_CONFIG_FILE_NAMES[0]);
  const projectConfig = readProjectConfig(cwd);

  if (options?.requireProjectConfig && !projectConfig) {
    throw new Error(
      [
        `No ${PROJECT_CONFIG_LABEL} found in the current directory or its parents.`,
        '- Add plugins.OtaKit to capacitor.config.ts',
        '- or pass CLI flags / environment variables directly',
      ].join('\n'),
    );
  }

  const appIdFromFlag = toNonEmptyString(options?.appId);
  const appIdFromEnv = toNonEmptyString(process.env.OTAKIT_APP_ID);
  const appIdFromConfig = projectConfig?.appId;
  const appIdValue = appIdFromFlag ?? appIdFromEnv ?? appIdFromConfig ?? null;
  const appIdSource: ConfigValueSource = appIdFromFlag
    ? 'flag'
    : appIdFromEnv
      ? 'env'
      : appIdFromConfig
        ? 'config'
        : 'none';

  const channelFromFlag = toNonEmptyString(options?.channel);
  const channelFromConfig = projectConfig?.channel;
  const channelValue = channelFromFlag ?? channelFromConfig ?? null;
  const channelSource: ConfigValueSource = channelFromFlag
    ? 'flag'
    : channelFromConfig
      ? 'config'
      : 'none';

  const runtimeVersionFromConfig = projectConfig?.runtimeVersion;
  const runtimeVersionValue = runtimeVersionFromConfig ?? null;
  const runtimeVersionSource: ConfigValueSource = runtimeVersionFromConfig ? 'config' : 'none';

  const outputDirFromFlag = toNonEmptyString(options?.outputDir);
  const outputDirFromEnv = resolveEnvOutputDir();
  const outputDirFromConfig = projectConfig?.outputDir;
  const outputDirValue = outputDirFromFlag ?? outputDirFromEnv ?? outputDirFromConfig ?? null;
  const outputDirSource: ConfigValueSource = outputDirFromFlag
    ? 'flag'
    : outputDirFromEnv
      ? 'env'
      : outputDirFromConfig
        ? 'config'
        : 'none';

  const serverFromFlag = toNonEmptyString(options?.serverUrl);
  const serverFromEnv = toNonEmptyString(process.env.OTAKIT_SERVER_URL);
  const serverFromConfig = toNonEmptyString(projectConfig?.configuredServerUrl);
  const serverRaw = serverFromFlag ?? serverFromEnv ?? serverFromConfig ?? DEFAULT_SERVER_URL;
  const serverValue = validateServerUrl(serverRaw);
  const serverSource: ConfigValueSource = serverFromFlag
    ? 'flag'
    : serverFromEnv
      ? 'env'
      : serverFromConfig
        ? 'config'
        : 'default';

  const auth = await resolveAuthToken(serverValue);
  const authTokenValue = auth?.token ?? null;
  const authTokenSource = toAuthValueSource(auth?.source ?? null);

  return {
    configFile: {
      path: configPath,
      found: capacitorProjectConfig !== null,
    },
    appId: {
      value: appIdValue,
      source: appIdSource,
    },
    serverUrl: {
      value: serverValue,
      source: serverSource,
    },
    outputDir: {
      value: outputDirValue,
      source: outputDirSource,
    },
    channel: {
      value: channelValue,
      source: channelSource,
    },
    runtimeVersion: {
      value: runtimeVersionValue,
      source: runtimeVersionSource,
    },
    authToken: {
      value: authTokenValue,
      source: authTokenSource,
    },
    authSource: auth?.source ?? null,
  };
}

export async function requireConfig(options?: ConfigResolveOptions): Promise<CliConfig> {
  const snapshot = await resolveConfigSnapshot(options);

  if (!snapshot.authToken.value || !snapshot.authSource) {
    throw new Error(
      [
        'Missing authentication:',
        '- Run `otakit login`',
        '- or set OTAKIT_TOKEN env var',
      ].join('\n'),
    );
  }

  if (!snapshot.appId.value) {
    throw new Error(
      [
        'Missing app ID:',
        '- Pass --app-id <id>',
        '- or set OTAKIT_APP_ID in your environment',
        '- or add plugins.OtaKit.appId to capacitor.config.ts',
      ].join('\n'),
    );
  }

  return {
    appId: snapshot.appId.value,
    channel: snapshot.channel.value ?? undefined,
    runtimeVersion: snapshot.runtimeVersion.value ?? undefined,
    outputDir: snapshot.outputDir.value ?? undefined,
    serverUrl: snapshot.serverUrl.value,
    authToken: snapshot.authToken.value,
    authSource: snapshot.authSource,
  };
}

function parseServerUrl(value: unknown, cwd: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const raw = toTrimmedString(value);
  if (!raw) {
    throw new Error(`"${PROJECT_CONFIG_LABEL}".serverUrl must be a non-empty string.`);
  }

  return resolveServerUrl(cwd, raw);
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
