import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider';
import { NextRequest, NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { isRemoteMcpOAuthEnabled } from '@/lib/mcp/features';

export const runtime = 'nodejs';

const ALLOWED_METADATA_PREFIXES = [
  'oauth-protected-resource',
  'oauth-authorization-server',
  'openid-configuration',
];

/** Public metadata; browser-based MCP clients run discovery with fetch and need CORS. */
const DISCOVERY_CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-max-age': '600',
};

/**
 * The issuer is https://<host>/api/auth, so its RFC 8414 metadata lives at
 * /.well-known/oauth-authorization-server/api/auth. Clients written against the
 * 2025-03-26 MCP spec skip resource metadata and look at the origin root
 * instead. Better Auth provides this handler for exactly that case.
 */
const rootAuthorizationServerMetadata = oauthProviderAuthServerMetadata(auth, {
  headers: DISCOVERY_CORS,
});

function withDiscoveryCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(DISCOVERY_CORS)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handle(request: NextRequest): Promise<Response> {
  if (!isRemoteMcpOAuthEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  if (segments[0] !== '.well-known' || !ALLOWED_METADATA_PREFIXES.includes(segments[1] ?? '')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (segments.length === 2 && segments[1] === 'oauth-authorization-server') {
    return rootAuthorizationServerMetadata(request);
  }
  return withDiscoveryCors(await auth.handler(request));
}

export const GET = handle;
export const HEAD = handle;

export function OPTIONS(): Response {
  if (!isRemoteMcpOAuthEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return new Response(null, { status: 204, headers: DISCOVERY_CORS });
}
