import { describe, expect, it } from 'vitest';

import {
  initialOrganizationId,
  organizationDisplayLabel,
  organizationFromAnswer,
  type AccountResponse,
  type OrganizationMembership,
} from './organization.js';

const memberships: OrganizationMembership[] = [
  { id: 'membership-1', organizationId: 'org-11111111', organizationName: 'Acme', role: 'owner' },
  {
    id: 'membership-2',
    organizationId: 'org-22222222',
    organizationName: 'Studio',
    role: 'member',
  },
];

function account(overrides: Partial<AccountResponse['user']> = {}): AccountResponse {
  return {
    user: {
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      activeOrganizationId: 'org-22222222',
      ...overrides,
    },
    memberships,
  };
}

describe('organization selection', () => {
  it('keeps a matching stored CLI default ahead of dashboard state', () => {
    expect(
      initialOrganizationId(account(), {
        token: 'token',
        userId: 'user-1',
        organizationId: 'org-11111111',
      }),
    ).toBe('org-11111111');
  });

  it('does not inherit another user’s stored organization', () => {
    expect(
      initialOrganizationId(account(), {
        token: 'token',
        userId: 'user-2',
        organizationId: 'org-11111111',
      }),
    ).toBe('org-22222222');
  });

  it('accepts a numbered choice and uses the explicit default for an empty answer', () => {
    expect(organizationFromAnswer(memberships, '1')?.organizationId).toBe('org-11111111');
    expect(organizationFromAnswer(memberships, '', 'org-22222222')?.organizationId).toBe(
      'org-22222222',
    );
    expect(organizationFromAnswer(memberships, 'not-a-number')).toBeUndefined();
  });

  it('disambiguates duplicate names and escapes terminal control characters', () => {
    const duplicates = [
      { ...memberships[0], organizationName: 'Acme\nInjected' },
      { ...memberships[1], organizationName: 'Acme\nInjected' },
    ];
    expect(organizationDisplayLabel(duplicates[0], duplicates)).toBe(
      'Acme\\nInjected — owner · org-1111',
    );
  });
});
