export const OTAKIT_OAUTH_SCOPES = [
  'otakit:read',
  'otakit:app:write',
  'otakit:bundle:write',
  'otakit:release:write',
] as const;

export type OtaKitOAuthScope = (typeof OTAKIT_OAUTH_SCOPES)[number];

export function isOtaKitOAuthScope(scope: string): scope is OtaKitOAuthScope {
  return (OTAKIT_OAUTH_SCOPES as readonly string[]).includes(scope);
}

export function isRemoteMcpEnabled(): boolean {
  return process.env.OTAKIT_REMOTE_MCP_ENABLED === 'true';
}

export function isRemoteMcpOAuthEnabled(): boolean {
  return isRemoteMcpEnabled() && process.env.OTAKIT_REMOTE_MCP_OAUTH_ENABLED === 'true';
}

export function isLegacyMcpDcrEnabled(): boolean {
  return isRemoteMcpOAuthEnabled() && process.env.OTAKIT_REMOTE_MCP_LEGACY_DCR_ENABLED === 'true';
}

export function remoteMcpResourceUrl(): string {
  const explicit = process.env.OTAKIT_REMOTE_MCP_RESOURCE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  // A host that stores a variable with no value hands us an empty string, which
  // `??` would keep. Fall back on any blank value, not only an unset one.
  const baseUrl = (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.BETTER_AUTH_URL?.trim() ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');
  return `${baseUrl}/mcp`;
}

export function remoteMcpServerOrigin(): string {
  const resource = remoteMcpResourceUrl();
  try {
    return new URL(resource).origin;
  } catch {
    // Every request into /mcp reads this origin, so a relative or malformed
    // value fails the whole endpoint. Say which variable to fix.
    throw new Error(
      `Remote MCP resource URL is not absolute: ${JSON.stringify(resource)}. ` +
        'Set NEXT_PUBLIC_APP_URL or OTAKIT_REMOTE_MCP_RESOURCE_URL to the console origin.',
    );
  }
}
