import { CliError } from './errors.js';
import { fetchCli, parseApiError } from './http.js';
import { ask } from './prompt.js';
import type { StoredAuthProfile } from './token-store.js';

export type OrganizationMembership = {
  id: string;
  organizationId: string;
  organizationName: string;
  role: string;
};

export type AccountResponse = {
  user: {
    id: string;
    email: string;
    name: string;
    activeOrganizationId: string | null;
  };
  memberships: OrganizationMembership[];
};

export async function fetchAccount(serverUrl: string, token: string): Promise<AccountResponse> {
  const response = await fetchCli(`${serverUrl}/api/v1/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new CliError(await parseApiError(response));

  const payload = (await response.json()) as AccountResponse;
  if (!payload.user?.id || !payload.user.email || !Array.isArray(payload.memberships)) {
    throw new CliError('Server returned an invalid account response.');
  }
  return payload;
}

export function initialOrganizationId(
  account: AccountResponse,
  storedProfile?: StoredAuthProfile | null,
): string | undefined {
  const membershipIds = new Set(account.memberships.map((membership) => membership.organizationId));
  if (
    storedProfile?.userId === account.user.id &&
    storedProfile.organizationId &&
    membershipIds.has(storedProfile.organizationId)
  ) {
    return storedProfile.organizationId;
  }
  if (account.user.activeOrganizationId && membershipIds.has(account.user.activeOrganizationId)) {
    return account.user.activeOrganizationId;
  }
  return account.memberships[0]?.organizationId;
}

export function organizationById(
  memberships: readonly OrganizationMembership[],
  organizationId: string | undefined | null,
): OrganizationMembership | undefined {
  if (!organizationId) return undefined;
  return memberships.find((membership) => membership.organizationId === organizationId);
}

function terminalSafe(value: string): string {
  return value.replace(/\p{Cc}/gu, (character) => JSON.stringify(character).slice(1, -1));
}

export function organizationDisplayLabel(
  membership: OrganizationMembership,
  memberships: readonly OrganizationMembership[],
): string {
  const duplicateName =
    memberships.filter((candidate) => candidate.organizationName === membership.organizationName)
      .length > 1;
  const suffix = duplicateName ? ` · ${membership.organizationId.slice(0, 8)}` : '';
  return `${terminalSafe(membership.organizationName)} — ${terminalSafe(membership.role)}${suffix}`;
}

export function organizationFromAnswer(
  memberships: readonly OrganizationMembership[],
  answer: string,
  defaultOrganizationId?: string,
): OrganizationMembership | undefined {
  const normalized = answer.trim();
  if (!normalized) {
    return organizationById(memberships, defaultOrganizationId) ?? memberships[0];
  }
  if (!/^\d+$/.test(normalized)) return undefined;
  const index = Number.parseInt(normalized, 10) - 1;
  return memberships[index];
}

export async function promptForOrganization(
  memberships: readonly OrganizationMembership[],
  options: { initialOrganizationId?: string; message?: string } = {},
): Promise<OrganizationMembership> {
  if (memberships.length === 0) {
    throw new CliError('This account does not belong to an OtaKit organization.');
  }
  if (memberships.length === 1) return memberships[0];
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError(
      [
        'Organization selection needs an interactive terminal.',
        'Run `otakit organization select` in a terminal, then retry.',
        'For automation, use the OTAKIT_ORGANIZATION_ID export it prints or an organization API key.',
      ].join('\n'),
    );
  }

  const defaultMembership =
    organizationById(memberships, options.initialOrganizationId) ?? memberships[0];
  const defaultIndex = memberships.indexOf(defaultMembership);
  console.log('');
  console.log(options.message ?? 'Choose a default organization for commands not tied to an app:');
  console.log('');
  memberships.forEach((membership, index) => {
    const marker = index === defaultIndex ? '*' : ' ';
    console.log(`  [${index + 1}]${marker} ${organizationDisplayLabel(membership, memberships)}`);
  });
  console.log('');

  while (true) {
    const answer = await ask(`Selection [${defaultIndex + 1}]: `);
    const selected = organizationFromAnswer(memberships, answer, defaultMembership.organizationId);
    if (selected) return selected;
    console.error(`Enter a number from 1 to ${memberships.length}.`);
  }
}

export function shellLiteral(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
