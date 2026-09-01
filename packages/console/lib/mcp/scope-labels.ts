/**
 * One description per scope, shared by the consent screen and the connections
 * list. People grant access reading one of these and audit it later reading the
 * other, so they must not drift: `title` is the short chip, `description` is the
 * sentence shown before anything is granted.
 *
 * Client-safe on purpose — no environment access — so both surfaces can import it.
 */
export type ScopeLabel = { title: string; description: string };

export const OTAKIT_SCOPE_LABELS: Record<string, ScopeLabel> = {
  'otakit:read': {
    title: 'Read',
    description: 'Read apps, bundles, releases, rollout events, and account status',
  },
  'otakit:app:write': {
    title: 'Create apps',
    description: 'Create apps in this organization',
  },
  'otakit:bundle:write': {
    title: 'Upload & delete bundles',
    description: 'Upload new bundles and delete bundles that were never released',
  },
  'otakit:release:write': {
    title: 'Publish & revert',
    description: 'Publish releases to your users and revert them',
  },
  offline_access: {
    title: 'Stay connected',
    description: 'Stay connected until you revoke access',
  },
};

export function scopeLabel(scope: string): ScopeLabel {
  return OTAKIT_SCOPE_LABELS[scope] ?? { title: scope, description: scope };
}
