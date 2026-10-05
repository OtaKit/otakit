import { describe, expect, it } from 'vitest';

import { normalizeRequestedScope, normalizeResourceIndicator } from './oauth-request';

const RESOURCE = 'https://console.example/mcp';

describe('requested scope normalization', () => {
  const plain = { addOfflineAccess: false };

  it('drops scopes OtaKit does not offer instead of failing the request', () => {
    expect(normalizeRequestedScope('openid profile email otakit:read', plain)).toBe('otakit:read');
    expect(normalizeRequestedScope('otakit:read mcp:tools  otakit:app:write', plain)).toBe(
      'otakit:read otakit:app:write',
    );
  });

  it('falls back to read access when nothing usable was requested', () => {
    expect(normalizeRequestedScope('openid profile', plain)).toBe('otakit:read');
    expect(normalizeRequestedScope('offline_access', plain)).toBe('otakit:read offline_access');
    expect(normalizeRequestedScope('', plain)).toBe('otakit:read');
  });

  it('adds offline_access only for clients registered for refresh', () => {
    expect(normalizeRequestedScope('otakit:read', { addOfflineAccess: true })).toBe(
      'otakit:read offline_access',
    );
    expect(normalizeRequestedScope('otakit:read offline_access', { addOfflineAccess: true })).toBe(
      'otakit:read offline_access',
    );
    expect(normalizeRequestedScope('otakit:read', plain)).toBe('otakit:read');
  });

  it('leaves an absent scope to Better Auth defaults', () => {
    expect(normalizeRequestedScope(undefined, { addOfflineAccess: true })).toBeUndefined();
  });
});

describe('resource indicator normalization', () => {
  it('maps the server origin to the MCP resource', () => {
    expect(normalizeResourceIndicator('https://console.example', RESOURCE)).toBe(RESOURCE);
    expect(normalizeResourceIndicator('https://console.example/', RESOURCE)).toBe(RESOURCE);
    expect(normalizeResourceIndicator(['https://console.example'], RESOURCE)).toEqual([RESOURCE]);
  });

  it('passes anything else through for Better Auth to judge', () => {
    expect(normalizeResourceIndicator(RESOURCE, RESOURCE)).toBe(RESOURCE);
    expect(normalizeResourceIndicator('https://other.example', RESOURCE)).toBe(
      'https://other.example',
    );
    expect(normalizeResourceIndicator('https://console.example/api', RESOURCE)).toBe(
      'https://console.example/api',
    );
    expect(normalizeResourceIndicator(undefined, RESOURCE)).toBeUndefined();
  });
});
