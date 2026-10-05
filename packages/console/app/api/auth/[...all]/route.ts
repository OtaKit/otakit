import { auth } from '@/lib/auth';
import { toNextJsHandler } from 'better-auth/next-js';

const handlers = toNextJsHandler(auth);

/**
 * OAuth endpoints that MCP clients call directly. They use no cookies, so any
 * origin may call them; browser-based clients (MCP Inspector, web IDEs) need the
 * CORS headers to read the responses.
 */
const PUBLIC_OAUTH_PATHS = new Set([
  '/api/auth/oauth2/register',
  '/api/auth/oauth2/token',
  '/api/auth/oauth2/revoke',
]);

/** RFC 6749 form endpoints. A JSON body is converted rather than refused with 415. */
const FORM_ENCODED_PATHS = new Set(['/api/auth/oauth2/token', '/api/auth/oauth2/revoke']);

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type, DPoP',
  'access-control-expose-headers': 'WWW-Authenticate, DPoP-Nonce',
  'access-control-max-age': '600',
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function asFormEncoded(request: Request): Promise<Request> {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return request;
  }
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return request;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return request;

  const form = new URLSearchParams();
  for (const [name, value] of Object.entries(body)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
        form.append(name, String(item));
      }
    }
  }
  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/x-www-form-urlencoded');
  headers.delete('content-length');
  return new Request(request.url, { method: 'POST', headers, body: form.toString() });
}

export const GET = handlers.GET;

export async function POST(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (!PUBLIC_OAUTH_PATHS.has(pathname)) return handlers.POST(request);
  const forwarded = FORM_ENCODED_PATHS.has(pathname) ? await asFormEncoded(request) : request;
  return withCors(await handlers.POST(forwarded));
}

export function OPTIONS(request: Request): Response {
  const { pathname } = new URL(request.url);
  if (PUBLIC_OAUTH_PATHS.has(pathname)) {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  // What Next.js answers by default when a route defines no OPTIONS handler.
  return new Response(null, { status: 204, headers: { allow: 'GET, HEAD, OPTIONS, POST' } });
}
