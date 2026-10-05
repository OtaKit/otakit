import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { NextRequest } from 'next/server';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

// lib/auth decides at import time whether the MCP OAuth plugins are mounted.
vi.hoisted(() => {
  process.env.OTAKIT_REMOTE_MCP_ENABLED = 'true';
  process.env.OTAKIT_REMOTE_MCP_OAUTH_ENABLED = 'true';
  process.env.OTAKIT_REMOTE_MCP_LEGACY_DCR_ENABLED = 'true';
});

import { GET as authGET, POST as authPOST } from '@/app/api/auth/[...all]/route';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

import { GET as mcpGET, POST as mcpPOST } from './route';

// vitest.config.ts sets BETTER_AUTH_URL and NEXT_PUBLIC_APP_URL to this origin.
const ORIGIN = 'https://console.example';
const RESOURCE = `${ORIGIN}/mcp`;
const RESOURCE_METADATA = `${ORIGIN}/.well-known/oauth-protected-resource/mcp`;
const LOOPBACK_REDIRECT = 'http://127.0.0.1:33418/callback';

const databaseDescribe = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

function mcpRequest(body: unknown, token?: string): NextRequest {
  return new NextRequest(RESOURCE, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-11-25',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** The handler may answer as JSON or as a one-message SSE stream. */
async function jsonRpcResult<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text.startsWith('{') ? text : text.match(/^data: (.*)$/m)?.[1];
  return (JSON.parse(data ?? 'null') as { result: T }).result;
}

databaseDescribe('remote MCP OAuth (PostgreSQL integration)', () => {
  const clientIds: string[] = [];
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    vi.unstubAllGlobals();
    await db.oauthClient.deleteMany({ where: { clientId: { in: clientIds.splice(0) } } });
    await db.organization.deleteMany({ where: { id: { in: organizationIds.splice(0) } } });
    await db.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('registers a 127.0.0.1 client without application_type and sends it to sign-in', async () => {
    const registration = await authPOST(
      new NextRequest(`${ORIGIN}/api/auth/oauth2/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Loopback agent',
          redirect_uris: [LOOPBACK_REDIRECT],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        }),
      }),
    );
    const client = (await registration.json()) as Record<string, unknown>;
    expect(registration.status).toBe(201);
    expect(client.application_type).toBe('native');
    clientIds.push(String(client.client_id));

    // Through NextRequest, as on Vercel: Next 16.1 rewrote this 127.0.0.1 to
    // localhost inside the query, which then failed redirect URI matching.
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: String(client.client_id),
      redirect_uri: LOOPBACK_REDIRECT,
      scope: 'otakit:read offline_access',
      resource: RESOURCE,
      code_challenge: createHash('sha256').update(randomBytes(32)).digest('base64url'),
      code_challenge_method: 'S256',
      state: 'state-1',
    });
    const authorize = await authGET(
      new NextRequest(`${ORIGIN}/api/auth/oauth2/authorize?${query}`, {
        headers: { accept: 'application/json' },
      }),
    );
    const { url } = (await authorize.json()) as { url: string };
    const signIn = new URL(url, ORIGIN);
    expect(signIn.pathname).toBe('/login');
    expect(signIn.searchParams.get('error')).toBeNull();
    expect(signIn.searchParams.get('redirect_uri')).toBe(LOOPBACK_REDIRECT);
  });

  it('answers GET with 405 and challenges missing or invalid tokens per RFC 6750', async () => {
    const get = await mcpGET(new NextRequest(RESOURCE));
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST, OPTIONS');

    const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
    const anonymous = await mcpPOST(mcpRequest(initialize));
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('www-authenticate')).toContain(
      `resource_metadata="${RESOURCE_METADATA}"`,
    );
    expect(anonymous.headers.get('www-authenticate')).not.toContain('error=');

    const invalid = await mcpPOST(mcpRequest(initialize, 'not.a.token'));
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get('www-authenticate')).toMatch(/^Bearer error="invalid_token", /);
    expect(invalid.headers.get('www-authenticate')).toContain(
      `resource_metadata="${RESOURCE_METADATA}"`,
    );
  });

  it('lists write tools to a read-only connection and steps up when one is called', async () => {
    const organizationId = randomUUID();
    const userId = randomUUID();
    const clientId = `client-${randomUUID()}`;
    organizationIds.push(organizationId);
    userIds.push(userId);
    clientIds.push(clientId);
    await db.user.create({
      data: { id: userId, name: 'Agent owner', email: `${userId}@example.com` },
    });
    await db.organization.create({
      data: {
        id: organizationId,
        name: `MCP step-up ${organizationId}`,
        members: { create: { userId, role: 'owner' } },
      },
    });
    await db.oauthClient.create({
      data: { id: randomUUID(), clientId, name: 'Agent', redirectUris: [LOOPBACK_REDIRECT] },
    });
    await db.oauthConsent.create({
      data: {
        id: randomUUID(),
        clientId,
        userId,
        referenceId: organizationId,
        scopes: ['otakit:read', 'offline_access'],
        resources: [RESOURCE],
      },
    });

    // requireMcpAuth fetches the signing keys from the issuer; serve them in-process.
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      return url.startsWith(`${ORIGIN}/api/auth/`)
        ? auth.handler(new Request(url, init))
        : realFetch(input, init);
    });
    const { token } = await auth.api.signJWT({
      body: {
        payload: {
          iss: `${ORIGIN}/api/auth`,
          aud: RESOURCE,
          sub: userId,
          client_id: clientId,
          scope: 'otakit:read offline_access',
          otakit_organization_id: organizationId,
          otakit_user_id: userId,
          exp: Math.floor(Date.now() / 1000) + 300,
        },
      },
    });

    const list = await mcpPOST(
      mcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, token),
    );
    expect(list.status).toBe(200);
    const listed = await jsonRpcResult<{ tools: { name: string }[] }>(list);
    const names = listed.tools.map((tool) => tool.name);
    expect(names).toContain('list_apps');
    expect(names).toContain('create_app');

    const call = await mcpPOST(
      mcpRequest(
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'create_app', arguments: { name: 'Step-up app' } },
        },
        token,
      ),
    );
    expect(call.status).toBe(403);
    const challenge = call.headers.get('www-authenticate') ?? '';
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain('scope="otakit:read offline_access otakit:app:write"');
    expect(challenge).toContain(`resource_metadata="${RESOURCE_METADATA}"`);
    expect(await db.app.count({ where: { organizationId } })).toBe(0);
  });
});
