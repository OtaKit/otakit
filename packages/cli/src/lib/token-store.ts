import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

type TokenStoreOperationResult = {
  ok: boolean;
  reason?: string;
};

type TokenDeleteResult = TokenStoreOperationResult & {
  deleted: boolean;
};

export type StoredAuthProfile = {
  token: string;
  userId?: string;
  organizationId?: string;
};

type TokenStorePayload = {
  version: 2;
  profiles: Record<string, StoredAuthProfile>;
};

function emptyPayload(): TokenStorePayload {
  return { version: 2, profiles: {} };
}

function getAuthFilePath(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA?.trim();
    const baseDir = appData && appData.length > 0 ? appData : join(homedir(), 'AppData', 'Roaming');
    return join(baseDir, 'otakit', 'auth.json');
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  const baseDir =
    xdgConfigHome && xdgConfigHome.length > 0 ? xdgConfigHome : join(homedir(), '.config');
  return join(baseDir, 'otakit', 'auth.json');
}

function normalizeProfile(value: unknown): StoredAuthProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const token = typeof raw.token === 'string' ? raw.token.trim() : '';
  if (!token) return null;
  const userId = typeof raw.userId === 'string' ? raw.userId.trim() : '';
  const organizationId = typeof raw.organizationId === 'string' ? raw.organizationId.trim() : '';
  return {
    token,
    ...(userId ? { userId } : {}),
    ...(organizationId ? { organizationId } : {}),
  };
}

function normalizeProfiles(value: unknown): Record<string, StoredAuthProfile> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const profiles: Record<string, StoredAuthProfile> = {};
  for (const [serverUrl, rawProfile] of Object.entries(value)) {
    const profile = normalizeProfile(rawProfile);
    if (profile) profiles[serverUrl] = profile;
  }
  return profiles;
}

function migrateLegacyTokens(value: unknown): Record<string, StoredAuthProfile> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const profiles: Record<string, StoredAuthProfile> = {};
  for (const [serverUrl, rawToken] of Object.entries(value)) {
    if (typeof rawToken === 'string' && rawToken.trim()) {
      profiles[serverUrl] = { token: rawToken.trim() };
    }
  }
  return profiles;
}

async function readPayload(path: string): Promise<TokenStorePayload> {
  const raw = await readFile(path, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyPayload();
  const record = parsed as Record<string, unknown>;
  const profiles = normalizeProfiles(record.profiles);
  if (Object.keys(profiles).length > 0 || record.version === 2) {
    return { version: 2, profiles };
  }
  return { version: 2, profiles: migrateLegacyTokens(record.tokens) };
}

async function writePayload(path: string, payload: TokenStorePayload): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);

  const temporaryPath = join(directory, `.auth-${process.pid}-${randomUUID()}.tmp`);
  const compatiblePayload = {
    ...payload,
    tokens: Object.fromEntries(
      Object.entries(payload.profiles).map(([serverUrl, profile]) => [serverUrl, profile.token]),
    ),
  };
  try {
    await writeFile(temporaryPath, `${JSON.stringify(compatiblePayload, null, 2)}\n`, {
      encoding: 'utf-8',
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function readPayloadOrEmpty(path: string): Promise<TokenStorePayload> {
  try {
    return await readPayload(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyPayload();
    const reason = error instanceof Error ? error.message : 'unknown error';
    console.warn(`Warning: auth file at ${path} is unreadable, recreating it (${reason}).`);
    return emptyPayload();
  }
}

export async function readStoredAuthProfile(serverUrl: string): Promise<StoredAuthProfile | null> {
  const path = getAuthFilePath();
  try {
    const payload = await readPayload(path);
    return payload.profiles[serverUrl] ?? null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    const reason = error instanceof Error ? error.message : 'unknown error';
    console.warn(`Warning: could not read auth file at ${path}: ${reason}`);
    return null;
  }
}

export async function storeAuthProfile(
  serverUrl: string,
  profile: StoredAuthProfile,
): Promise<TokenStoreOperationResult> {
  const path = getAuthFilePath();
  const normalized = normalizeProfile(profile);
  if (!normalized) return { ok: false, reason: 'Access token is required.' };
  const payload = await readPayloadOrEmpty(path);
  payload.profiles[serverUrl] = normalized;

  try {
    await writePayload(path, payload);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Failed to save auth profile.',
    };
  }
}

export async function storeSelectedOrganization(
  serverUrl: string,
  userId: string,
  organizationId: string,
): Promise<TokenStoreOperationResult> {
  const existing = await readStoredAuthProfile(serverUrl);
  if (!existing) return { ok: false, reason: 'No stored login exists for this server.' };
  return storeAuthProfile(serverUrl, { token: existing.token, userId, organizationId });
}

export async function clearStoredAccessToken(serverUrl: string): Promise<TokenDeleteResult> {
  const path = getAuthFilePath();
  let payload: TokenStorePayload;
  try {
    payload = await readPayload(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: true, deleted: false };
    }
    return {
      ok: false,
      deleted: false,
      reason: error instanceof Error ? error.message : 'Failed to read auth store.',
    };
  }

  if (!payload.profiles[serverUrl]) return { ok: true, deleted: false };
  delete payload.profiles[serverUrl];

  try {
    if (Object.keys(payload.profiles).length === 0) await unlink(path);
    else await writePayload(path, payload);
    return { ok: true, deleted: true };
  } catch (error) {
    return {
      ok: false,
      deleted: false,
      reason: error instanceof Error ? error.message : 'Failed to delete auth profile.',
    };
  }
}
