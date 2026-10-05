const NATIVE_HTTP_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isNativeRedirectUri(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return false;
  if (url.protocol === 'http:') return NATIVE_HTTP_LOOPBACK_HOSTS.has(url.hostname);
  // Private-use scheme such as com.example.app:/callback.
  return true;
}

/**
 * Dynamic client registration body with application_type defaulted for native
 * clients. RFC 7591, which MCP clients follow, has no application_type; Better
 * Auth applies the OpenID default "web", which forbids the loopback and
 * private-use redirect URIs that desktop and CLI agents register. When every
 * redirect URI is one of those, the client is native (the same derivation the
 * MCP SDK applies, SEP-837). Anything else is returned unchanged.
 */
export function withNativeApplicationTypeDefault(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const registration = body as Record<string, unknown>;
  if (registration.application_type !== undefined) return body;
  const redirectUris = registration.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) return body;
  if (!redirectUris.every(isNativeRedirectUri)) return body;
  return { ...registration, application_type: 'native' };
}
