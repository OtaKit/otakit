export const OTAKIT_OAUTH_ORGANIZATION_HEADER = 'x-otakit-oauth-organization-id';
export const OTAKIT_OAUTH_ORGANIZATION_QUERY = 'otakit_organization_id';

export function normalizeOAuthOrganizationId(value: string | null | undefined): string | undefined {
  const organizationId = value?.trim();
  return organizationId && organizationId.length <= 128 ? organizationId : undefined;
}
