import { NextRequest, NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { isRemoteMcpOAuthEnabled } from '@/lib/mcp/features';

export const runtime = 'nodejs';

const ALLOWED_METADATA_PREFIXES = [
  'oauth-protected-resource',
  'oauth-authorization-server',
  'openid-configuration',
];

async function handle(request: NextRequest): Promise<Response> {
  if (!isRemoteMcpOAuthEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  if (segments[0] !== '.well-known' || !ALLOWED_METADATA_PREFIXES.includes(segments[1] ?? '')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return auth.handler(request);
}

export const GET = handle;
export const HEAD = handle;
