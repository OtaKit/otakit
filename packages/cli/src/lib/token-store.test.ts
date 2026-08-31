import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearStoredAccessToken,
  readStoredAuthProfile,
  storeAuthProfile,
  storeSelectedOrganization,
} from './token-store.js';

describe('auth profile store', () => {
  let configRoot: string;
  let previousAppData: string | undefined;
  let previousXdgConfigHome: string | undefined;

  beforeEach(async () => {
    configRoot = await mkdtemp(join(tmpdir(), 'otakit-auth-'));
    previousAppData = process.env.APPDATA;
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.APPDATA = configRoot;
    process.env.XDG_CONFIG_HOME = configRoot;
  });

  afterEach(async () => {
    if (previousAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previousAppData;
    if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    await rm(configRoot, { recursive: true, force: true });
  });

  it('reads the legacy token map and rewrites it as a versioned profile', async () => {
    const directory = join(configRoot, 'otakit');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'auth.json'),
      JSON.stringify({ tokens: { 'https://console.example': ' legacy-token ' } }),
    );

    await expect(readStoredAuthProfile('https://console.example')).resolves.toEqual({
      token: 'legacy-token',
    });
    await expect(
      storeSelectedOrganization('https://console.example', 'user-1', 'org-2'),
    ).resolves.toEqual({ ok: true });

    const stored = JSON.parse(await readFile(join(directory, 'auth.json'), 'utf8')) as unknown;
    expect(stored).toEqual({
      version: 2,
      profiles: {
        'https://console.example': {
          token: 'legacy-token',
          userId: 'user-1',
          organizationId: 'org-2',
        },
      },
      tokens: { 'https://console.example': 'legacy-token' },
    });
  });

  it('replaces the complete login profile so another user cannot inherit a selection', async () => {
    await storeAuthProfile('https://console.example', {
      token: 'token-one',
      userId: 'user-1',
      organizationId: 'org-1',
    });
    await storeAuthProfile('https://console.example', {
      token: 'token-two',
      userId: 'user-2',
    });

    await expect(readStoredAuthProfile('https://console.example')).resolves.toEqual({
      token: 'token-two',
      userId: 'user-2',
    });
  });

  it('removes the whole server profile on logout', async () => {
    await storeAuthProfile('https://console.example', {
      token: 'token',
      userId: 'user-1',
      organizationId: 'org-1',
    });

    await expect(clearStoredAccessToken('https://console.example')).resolves.toEqual({
      ok: true,
      deleted: true,
    });
    await expect(readStoredAuthProfile('https://console.example')).resolves.toBeNull();
  });
});
