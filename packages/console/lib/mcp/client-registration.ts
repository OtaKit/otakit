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
 * Dynamic client registration body with MCP-friendly defaults for fields the
 * client left out. Explicit values are never changed.
 *
 * - application_type: RFC 7591, which MCP clients follow, has none; Better Auth
 *   applies the OpenID default "web", which forbids the loopback and private-use
 *   redirect URIs that desktop and CLI agents register. When every redirect URI
 *   is one of those, the client is native (the MCP SDK's derivation, SEP-837).
 * - token_endpoint_auth_method: RFC 7591 defaults to client_secret_basic, which
 *   issues a secret a native client cannot keep. Native clients default to
 *   "none" (a public client with PKCE).
 * - grant_types: RFC 7591 defaults to authorization_code only, which rules out
 *   refresh tokens and forces a new sign-in every hour. Default to both.
 */
export function withMcpRegistrationDefaults(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const registration = body as Record<string, unknown>;
  const defaults: Record<string, unknown> = {};

  const redirectUris = registration.redirect_uris;
  const allNative =
    Array.isArray(redirectUris) &&
    redirectUris.length > 0 &&
    redirectUris.every(isNativeRedirectUri);
  if (registration.application_type === undefined && allNative) {
    defaults.application_type = 'native';
  }
  const applicationType = registration.application_type ?? defaults.application_type;
  if (applicationType === 'native' && registration.token_endpoint_auth_method === undefined) {
    defaults.token_endpoint_auth_method = 'none';
  }
  if (registration.grant_types === undefined) {
    defaults.grant_types = ['authorization_code', 'refresh_token'];
  }

  return Object.keys(defaults).length > 0 ? { ...registration, ...defaults } : body;
}
