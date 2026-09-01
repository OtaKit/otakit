import { afterEach, describe, expect, it, vi } from 'vitest';

import { remoteMcpResourceUrl, remoteMcpServerOrigin } from './features';

describe('remote MCP resource URL resolution', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('falls through a configured-but-empty app URL instead of building a relative resource', () => {
    // A host that stores the variable with no value hands the runtime an empty
    // string. `??` would keep it and yield "/mcp", which every request into the
    // endpoint would then fail to parse as an origin.
    vi.stubEnv('OTAKIT_REMOTE_MCP_RESOURCE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    vi.stubEnv('BETTER_AUTH_URL', 'https://console.example');

    expect(remoteMcpResourceUrl()).toBe('https://console.example/mcp');
    expect(remoteMcpServerOrigin()).toBe('https://console.example');
  });

  it('prefers an explicit resource override and trims its trailing slashes', () => {
    vi.stubEnv('OTAKIT_REMOTE_MCP_RESOURCE_URL', 'https://mcp.example/mcp//');

    expect(remoteMcpResourceUrl()).toBe('https://mcp.example/mcp');
    expect(remoteMcpServerOrigin()).toBe('https://mcp.example');
  });

  it('names the variable to fix when the configured resource is not absolute', () => {
    vi.stubEnv('OTAKIT_REMOTE_MCP_RESOURCE_URL', 'console.example/mcp');

    expect(() => remoteMcpServerOrigin()).toThrow(/NEXT_PUBLIC_APP_URL/);
  });
});
