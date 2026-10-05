import { OTAKIT_OAUTH_SCOPES } from './features';

const SUPPORTED_SCOPES = new Set<string>([...OTAKIT_OAUTH_SCOPES, 'offline_access']);

/** Scope granted when a client asked only for scopes this server does not offer. */
const FALLBACK_SCOPE = 'otakit:read';

/**
 * Requested scopes reduced to the ones OtaKit offers. RFC 6749 §3.3 lets the
 * server ignore part of a request, and some clients add OpenID scopes (openid,
 * profile, email) that would otherwise abort the whole authorization with
 * invalid_scope. If nothing usable is left, the client gets read access, the
 * same scope the 401 challenge names.
 *
 * `addOfflineAccess` adds offline_access for clients registered with the
 * refresh_token grant. Better Auth only issues refresh tokens for that scope,
 * and without one a client must send its user through sign-in every hour.
 *
 * An absent scope stays absent: Better Auth then uses the client's registered
 * scopes, which is its documented default.
 */
export function normalizeRequestedScope(
  scope: unknown,
  options: { addOfflineAccess: boolean },
): string | undefined {
  if (typeof scope !== 'string') return undefined;
  const requested = scope.split(/\s+/).filter(Boolean);
  const kept = [...new Set(requested.filter((value) => SUPPORTED_SCOPES.has(value)))];
  if (!kept.some((value) => value !== 'offline_access')) kept.unshift(FALLBACK_SCOPE);
  if (options.addOfflineAccess && !kept.includes('offline_access')) kept.push('offline_access');
  return kept.join(' ');
}

/**
 * RFC 8707 resource indicators with the server origin mapped to the MCP
 * endpoint. Some clients name the origin; the only resource here is /mcp, and
 * access tokens must carry it as their audience. Other values pass through so
 * Better Auth can reject them.
 */
export function normalizeResourceIndicator(resource: unknown, canonicalResource: string): unknown {
  const origin = new URL(canonicalResource).origin;
  const map = (value: unknown) =>
    typeof value === 'string' && (value === origin || value === `${origin}/`)
      ? canonicalResource
      : value;
  return Array.isArray(resource) ? resource.map(map) : map(resource);
}
