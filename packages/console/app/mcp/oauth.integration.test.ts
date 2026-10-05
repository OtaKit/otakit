import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { NextRequest } from 'next/server';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

// lib/auth's consent hook reads next/headers, which needs a Next.js request
// scope; in-process calls have none. No header means the user's only
// organization is used, as in the app.
vi.mock('next/headers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/headers')>()),
  headers: async () => new Headers(),
}));

// lib/auth decides at import time whether the MCP OAuth plugins are mounted.
vi.hoisted(() => {
  process.env.OTAKIT_REMOTE_MCP_ENABLED = 'true';
  process.env.OTAKIT_REMOTE_MCP_OAUTH_ENABLED = 'true';
  process.env.OTAKIT_REMOTE_MCP_LEGACY_DCR_ENABLED = 'true';
});

import {
  GET as discoveryGET,
  OPTIONS as discoveryOPTIONS,
} from '@/app/.well-known/[...authMetadata]/route';
import {
  GET as authGET,
  OPTIONS as authOPTIONS,
  POST as authPOST,
} from '@/app/api/auth/[...all]/route';
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

/** requireMcpAuth fetches the issuer's signing keys over HTTP; serve them in-process. */
function serveIssuerInProcess() {
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    return url.startsWith(`${ORIGIN}/api/auth/`)
      ? auth.handler(new Request(url, init))
      : realFetch(input, init);
  });
}

function postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function postForm(path: string, body: Record<string, string>) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
}

/** What the console pages send as oauth_query: buildSignedOAuthQuery in Better Auth's client plugin. */
function signedOAuthQuery(search: string): string {
  const params = new URLSearchParams(search);
  const signed = new Set(params.getAll('ba_param'));
  const query = new URLSearchParams();
  for (const [key, value] of params) {
    if (key === 'sig' || key === 'ba_param' || signed.has(key)) query.append(key, value);
  }
  return query.toString();
}

function jwtPayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
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

  /**
   * The login and consent pages for a new user: email code, sign-in carrying
   * the signed OAuth request, then approval. Returns the authorization code.
   */
  async function approveAsNewUser(login: URL, state: string) {
    const email = `agent-${randomUUID()}@example.com`;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sent = await authPOST(
      postJson('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' }),
    );
    expect(sent.status).toBe(200);
    const otp = warn.mock.calls
      .map((call) => String(call[0]))
      .join('\n')
      .match(new RegExp(`To: ${email}[\\s\\S]*?Your code: (\\d{6})`))?.[1];
    expect(otp).toBeDefined();
    const signIn = await authPOST(
      postJson('/api/auth/sign-in/email-otp', {
        email,
        otp,
        oauth_query: signedOAuthQuery(login.search),
      }),
    );
    expect(signIn.status).toBe(200);
    const sessionToken = signIn.headers.get('set-auth-token');
    expect(sessionToken).toBeTruthy();
    const user = await db.user.findUniqueOrThrow({
      where: { email },
      select: { id: true, memberships: { select: { organizationId: true } } },
    });
    userIds.push(user.id);
    organizationIds.push(...user.memberships.map((member) => member.organizationId));
    expect(user.memberships).toHaveLength(1);

    const consentPage = new URL(((await signIn.json()) as { url: string }).url, ORIGIN);
    expect(consentPage.pathname).toBe('/oauth/consent');
    const consent = await authPOST(
      postJson(
        '/api/auth/oauth2/consent',
        { accept: true, oauth_query: signedOAuthQuery(consentPage.search) },
        { authorization: `Bearer ${sessionToken}` },
      ),
    );
    expect(consent.status).toBe(200);
    const callback = new URL(((await consent.json()) as { url: string }).url);
    expect(`${callback.origin}${callback.pathname}`).toBe(LOOPBACK_REDIRECT);
    expect(callback.searchParams.get('state')).toBe(state);
    const code = callback.searchParams.get('code');
    expect(code).toBeTruthy();
    return { code: code ?? '', user, organizationId: user.memberships[0]?.organizationId };
  }

  function authorizeRequest(params: Record<string, string>) {
    return authGET(
      new NextRequest(`${ORIGIN}/api/auth/oauth2/authorize?${new URLSearchParams(params)}`, {
        headers: { accept: 'application/json' },
      }),
    );
  }

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

    serveIssuerInProcess();
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

  it('serves discovery and the public OAuth endpoints to browser-based clients', async () => {
    // Clients written for the 2025-03-26 spec read the origin root.
    const root = await discoveryGET(
      new NextRequest(`${ORIGIN}/.well-known/oauth-authorization-server`),
    );
    expect(root.status).toBe(200);
    expect(root.headers.get('access-control-allow-origin')).toBe('*');
    expect(await root.json()).toMatchObject({
      issuer: `${ORIGIN}/api/auth`,
      authorization_endpoint: `${ORIGIN}/api/auth/oauth2/authorize`,
      token_endpoint: `${ORIGIN}/api/auth/oauth2/token`,
    });

    const resourceMetadata = await discoveryGET(new NextRequest(RESOURCE_METADATA));
    expect(resourceMetadata.headers.get('access-control-allow-origin')).toBe('*');
    expect(await resourceMetadata.json()).toMatchObject({ resource: RESOURCE });

    const discoveryPreflight = discoveryOPTIONS();
    expect(discoveryPreflight.status).toBe(204);
    expect(discoveryPreflight.headers.get('access-control-allow-origin')).toBe('*');

    const tokenPreflight = authOPTIONS(
      new NextRequest(`${ORIGIN}/api/auth/oauth2/token`, { method: 'OPTIONS' }),
    );
    expect(tokenPreflight.status).toBe(204);
    expect(tokenPreflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(tokenPreflight.headers.get('access-control-allow-headers')).toContain('Content-Type');

    // A JSON body reaches the grant logic instead of failing with 415.
    const token = await authPOST(
      postJson('/api/auth/oauth2/token', {
        grant_type: 'authorization_code',
        code: 'not-a-code',
        client_id: 'not-a-client',
        redirect_uri: LOOPBACK_REDIRECT,
        code_verifier: 'x'.repeat(43),
      }),
    );
    expect(token.status).toBe(400);
    expect(token.headers.get('access-control-allow-origin')).toBe('*');
    expect(((await token.json()) as { error?: string }).error).toMatch(/^invalid_/);
  });

  it('signs in a client that omits optional OAuth parameters, and rotates its refresh token', async () => {
    // Registration with nothing but a loopback redirect URI.
    const registration = await authPOST(
      postJson('/api/auth/oauth2/register', {
        client_name: 'Minimal agent',
        redirect_uris: [LOOPBACK_REDIRECT],
      }),
    );
    expect(registration.status).toBe(201);
    const client = (await registration.json()) as Record<string, unknown>;
    expect(client).toMatchObject({
      application_type: 'native',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    });
    expect(client.client_secret).toBeUndefined();
    const clientId = String(client.client_id);
    clientIds.push(clientId);

    // OpenID scopes and no resource indicator: neither may break the flow.
    const verifier = randomBytes(32).toString('base64url');
    const authorize = await authorizeRequest({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: LOOPBACK_REDIRECT,
      scope: 'openid profile email otakit:read',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      state: 'state-2',
    });
    const login = new URL(((await authorize.json()) as { url: string }).url, ORIGIN);
    expect(login.pathname).toBe('/login');
    expect(login.searchParams.get('error')).toBeNull();
    expect(login.searchParams.get('scope')).toBe('otakit:read offline_access');
    expect(login.searchParams.get('resource')).toBe(RESOURCE);

    const { code, user, organizationId } = await approveAsNewUser(login, 'state-2');
    expect(
      await db.auditLog.findFirst({
        where: { organizationId, action: 'oauth.connection_granted', targetId: clientId },
        select: { actorId: true, metadata: true },
      }),
    ).toMatchObject({
      actorId: user.id,
      metadata: { client: 'Minimal agent', scopes: 'otakit:read offline_access' },
    });

    // Token exchange, sent as JSON and without a resource indicator.
    const exchange = await authPOST(
      postJson('/api/auth/oauth2/token', {
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: clientId,
        redirect_uri: LOOPBACK_REDIRECT,
      }),
    );
    expect(exchange.status).toBe(200);
    const tokens = (await exchange.json()) as { access_token: string; refresh_token?: string };
    expect(jwtPayload(tokens.access_token)).toMatchObject({
      aud: RESOURCE,
      otakit_organization_id: organizationId,
    });
    expect(tokens.refresh_token).toBeTruthy();

    serveIssuerInProcess();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const list = await mcpPOST(
      mcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, tokens.access_token),
    );
    expect(list.status).toBe(200);
    const logged = log.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.startsWith('{"remoteMcp"'))
      .map((line) => (JSON.parse(line) as { remoteMcp: Record<string, unknown> }).remoteMcp);
    expect(logged.at(-1)).toMatchObject({
      status: 200,
      methods: ['tools/list'],
      credential: 'oauth',
      organizationId,
      oauthClientId: clientId,
    });
    expect(JSON.stringify(logged)).not.toContain(tokens.access_token);

    // Refresh rotates: a new refresh token, and the old one stops working.
    // Clients name the resource on refresh, which is where Better Auth filters
    // the scopes it stores with the next refresh token.
    const refreshed = await authPOST(
      postForm('/api/auth/oauth2/token', {
        grant_type: 'refresh_token',
        resource: RESOURCE,
        refresh_token: tokens.refresh_token ?? '',
        client_id: clientId,
      }),
    );
    expect(refreshed.status).toBe(200);
    const rotated = (await refreshed.json()) as { access_token: string; refresh_token?: string };
    expect(rotated.refresh_token).toBeTruthy();
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
    expect(jwtPayload(rotated.access_token)).toMatchObject({ aud: RESOURCE });
    // The MCP plugin keeps a 30-second reuse window so a client that lost the
    // response can retry: it gets the same tokens back, not a second set.
    const retried = await authPOST(
      postForm('/api/auth/oauth2/token', {
        grant_type: 'refresh_token',
        resource: RESOURCE,
        refresh_token: tokens.refresh_token ?? '',
        client_id: clientId,
      }),
    );
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({
      access_token: rotated.access_token,
      refresh_token: rotated.refresh_token,
    });
    expect(await db.oauthRefreshToken.count({ where: { clientId, revoked: null } })).toBe(1);

    const next = await authPOST(
      postForm('/api/auth/oauth2/token', {
        grant_type: 'refresh_token',
        resource: RESOURCE,
        refresh_token: rotated.refresh_token ?? '',
        client_id: clientId,
      }),
    );
    expect(next.status).toBe(200);
    const third = (await next.json()) as { refresh_token?: string };
    expect(third.refresh_token).toBeTruthy();
    expect(third.refresh_token).not.toBe(rotated.refresh_token);
  });
  it('rotates refresh tokens for a client that names the resource on every request', async () => {
    // How the MCP SDK behaves: explicit registration, and the resource indicator
    // on authorize, token and refresh requests.
    const registration = await authPOST(
      postJson('/api/auth/oauth2/register', {
        client_name: 'SDK agent',
        redirect_uris: [LOOPBACK_REDIRECT],
        application_type: 'native',
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    );
    expect(registration.status).toBe(201);
    const clientId = String(((await registration.json()) as { client_id: string }).client_id);
    clientIds.push(clientId);

    const verifier = randomBytes(32).toString('base64url');
    const authorize = await authorizeRequest({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: LOOPBACK_REDIRECT,
      scope: 'otakit:read offline_access',
      resource: RESOURCE,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      state: 'state-3',
    });
    const login = new URL(((await authorize.json()) as { url: string }).url, ORIGIN);
    expect(login.pathname).toBe('/login');
    const { code } = await approveAsNewUser(login, 'state-3');

    const exchange = await authPOST(
      postForm('/api/auth/oauth2/token', {
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: clientId,
        redirect_uri: LOOPBACK_REDIRECT,
        resource: RESOURCE,
      }),
    );
    expect(exchange.status).toBe(200);
    let refreshToken = ((await exchange.json()) as { refresh_token?: string }).refresh_token;
    expect(refreshToken).toBeTruthy();

    // Every refresh returns a new refresh token; a stored token that lost
    // offline_access would stop rotating after the first one.
    for (let round = 1; round <= 2; round++) {
      const refreshed = await authPOST(
        postForm('/api/auth/oauth2/token', {
          grant_type: 'refresh_token',
          refresh_token: refreshToken ?? '',
          client_id: clientId,
          resource: RESOURCE,
        }),
      );
      expect(refreshed.status, `refresh ${round}`).toBe(200);
      const next = ((await refreshed.json()) as { refresh_token?: string }).refresh_token;
      expect(next, `refresh ${round}`).toBeTruthy();
      expect(next, `refresh ${round}`).not.toBe(refreshToken);
      refreshToken = next;
    }
    expect(await db.oauthRefreshToken.count({ where: { clientId, revoked: null } })).toBe(1);
  });
});
