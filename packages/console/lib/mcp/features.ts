export const OTAKIT_OAUTH_SCOPES = [
  'otakit:read',
  'otakit:app:write',
  'otakit:bundle:write',
  'otakit:release:write',
] as const;

export type OtaKitOAuthScope = (typeof OTAKIT_OAUTH_SCOPES)[number];

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

  const baseUrl = (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.BETTER_AUTH_URL ??
    'http://localhost:3000'
  ).replace(/\/+$/, '');
  return `${baseUrl}/mcp`;
}

export function remoteMcpServerOrigin(): string {
  return new URL(remoteMcpResourceUrl()).origin;
}
