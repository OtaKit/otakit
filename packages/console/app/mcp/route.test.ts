import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifySecretAuth: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ verifySecretAuth: mocks.verifySecretAuth }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.checkRateLimit }));

import { OPTIONS, POST } from './route';

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://console.example/mcp', {
    method: 'POST',
    headers: {
      authorization: 'Bearer organization-key',
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function responsePayload(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
  return JSON.parse(dataLine ? dataLine.slice('data: '.length) : text) as Record<string, unknown>;
}

describe('remote MCP HTTP boundary', () => {
  beforeEach(() => {
    vi.stubEnv('OTAKIT_REMOTE_MCP_RESOURCE_URL', 'https://console.example/mcp');
    vi.stubEnv('OTAKIT_REMOTE_MCP_ENABLED', 'true');
    vi.stubEnv('OTAKIT_REMOTE_MCP_OAUTH_ENABLED', 'false');
    mocks.verifySecretAuth.mockResolvedValue({
      success: true,
      organizationId: 'org-1',
      keyId: 'key-1',
    });
    mocks.checkRateLimit.mockResolvedValue({ allowed: true });
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
  });

  it('is dark by default and does not touch authentication', async () => {
    vi.stubEnv('OTAKIT_REMOTE_MCP_ENABLED', 'false');

    const response = await POST(request({ jsonrpc: '2.0', id: 1, method: 'initialize' }));

    expect(response.status).toBe(404);
    expect(mocks.verifySecretAuth).not.toHaveBeenCalled();
  });

  it('rejects untrusted browser origins and non-JSON input before authentication', async () => {
    const originResponse = await POST(request({}, { origin: 'https://attacker.example' }));
    expect(originResponse.status).toBe(403);

    const contentResponse = await POST(request({}, { 'content-type': 'text/plain' }));
    expect(contentResponse.status).toBe(415);
    expect(mocks.verifySecretAuth).not.toHaveBeenCalled();
  });

  it('negotiates the legacy protocol through the shared factory with an organization key', async () => {
    const response = await POST(
      request({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'remote-test', version: '1.0.0' },
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await responsePayload(response)).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-11-25',
        serverInfo: { name: 'otakit-remote' },
      },
    });
    expect(mocks.verifySecretAuth).toHaveBeenCalledWith('Bearer organization-key');
  });

  it('negotiates the current protocol through the same stateless endpoint', async () => {
    const response = await POST(
      request(
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'server/discover',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
              'io.modelcontextprotocol/clientInfo': {
                name: 'remote-modern-test',
                version: '1.0.0',
              },
            },
          },
        },
        {
          'mcp-method': 'server/discover',
          'mcp-protocol-version': '2026-07-28',
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(await responsePayload(response)).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: {
        resultType: 'complete',
        supportedVersions: ['2026-07-28'],
      },
    });
  });

  it('returns the standard OAuth discovery challenge when delegated auth is enabled', async () => {
    vi.stubEnv('OTAKIT_REMOTE_MCP_OAUTH_ENABLED', 'true');
    mocks.verifySecretAuth.mockResolvedValue({ success: false, error: 'Invalid secret key' });

    const response = await POST(
      request({ jsonrpc: '2.0', id: 1, method: 'initialize' }, { authorization: '' }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata=');
  });

  it('answers CORS preflight only for an explicitly trusted origin', async () => {
    const response = await OPTIONS(
      new Request('https://console.example/mcp', {
        method: 'OPTIONS',
        headers: { origin: 'https://console.example' },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://console.example');
    expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('access-control-allow-headers')).toContain('MCP-Method');
    expect(response.headers.get('access-control-allow-headers')).toContain('MCP-Name');
  });
});
