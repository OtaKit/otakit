import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

type TokenStoreOperationResult = {
  ok: boolean;
  reason?: string;
};

type TokenDeleteResult = TokenStoreOperationResult & {
  deleted: boolean;
};

type TokenStorePayload = {
  tokens: Record<string, string>;
};

function getServerUrlAliases(serverUrl: string): string[] {
  if (serverUrl === 'https://www.otakit.app') {
    return ['https://otakit.app'];
  }
  if (serverUrl === 'https://otakit.app') {
    return ['https://www.otakit.app'];
  }
  return [];
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

async function readPayload(path: string): Promise<TokenStorePayload | null> {
  const raw = await readFile(path, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const tokens = (parsed as { tokens?: unknown }).tokens;
    if (tokens && typeof tokens === 'object' && !Array.isArray(tokens)) {
      const normalized: Record<string, string> = {};
      for (const [key, value] of Object.entries(tokens)) {
        if (typeof value === 'string' && value.trim().length > 0) {
          normalized[key] = value.trim();
        }
      }
      return { tokens: normalized };
    }
  }
  return { tokens: {} };
}

async function writePayload(path: string, payload: TokenStorePayload): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

export async function readStoredAccessToken(serverUrl: string): Promise<string | null> {
  const path = getAuthFilePath();
  let payload: TokenStorePayload | null;
  try {
    payload = await readPayload(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    const reason = error instanceof Error ? error.message : 'unknown error';
    console.warn(`Warning: could not read auth file at ${path}: ${reason}`);
    return null;
  }

  if (!payload) {
    return null;
  }
  const direct = payload.tokens[serverUrl];
  if (direct) {
    return direct;
  }

  for (const alias of getServerUrlAliases(serverUrl)) {
    const aliased = payload.tokens[alias];
    if (aliased) {
      return aliased;
    }
  }

  return null;
}

export async function storeAccessToken(
  serverUrl: string,
  token: string,
): Promise<TokenStoreOperationResult> {
  const path = getAuthFilePath();
  let payload: TokenStorePayload;
  try {
    payload = (await readPayload(path)) ?? { tokens: {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      payload = { tokens: {} };
    } else {
      const reason = error instanceof Error ? error.message : 'unknown error';
      console.warn(`Warning: auth file at ${path} is unreadable, recreating it (${reason}).`);
      payload = { tokens: {} };
    }
  }

  payload.tokens[serverUrl] = token.trim();

  try {
    await writePayload(path, payload);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Failed to save token.',
    };
  }
}

export async function clearStoredAccessToken(serverUrl: string): Promise<TokenDeleteResult> {
  const path = getAuthFilePath();
  let payload: TokenStorePayload | null;
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

  if (!payload) {
    return { ok: true, deleted: false };
  }

  const keysToDelete = [serverUrl, ...getServerUrlAliases(serverUrl)].filter(
    (value, index, array) => array.indexOf(value) === index,
  );
  let deleted = false;
  for (const key of keysToDelete) {
    if (payload.tokens[key]) {
      delete payload.tokens[key];
      deleted = true;
    }
  }

  if (!deleted) {
    return { ok: true, deleted: false };
  }

  try {
    if (Object.keys(payload.tokens).length === 0) {
      await unlink(path);
    } else {
      await writePayload(path, payload);
    }

    return { ok: true, deleted: true };
  } catch (error) {
    return {
      ok: false,
      deleted: false,
      reason: error instanceof Error ? error.message : 'Failed to delete token.',
    };
  }
}
