/**
 * How an organization is described to a person choosing between several of
 * them — during OAuth, on the consent screen, and in the CLI picker.
 *
 * Two workspaces are routinely called the same thing. An ID prefix tells them
 * apart on paper but not in someone's head, so lead with facts they recognise:
 * their role, the plan they pay for, how many people are in it, and what is
 * actually deployed there.
 */

const ORGANIZATION_PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

export type OrganizationFacts = {
  role: string;
  planKey: string;
  memberCount: number;
  appCount: number;
  sampleAppSlug: string | null;
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function describeOrganization(facts: OrganizationFacts): string {
  const parts = [
    facts.role.charAt(0).toUpperCase() + facts.role.slice(1),
    ORGANIZATION_PLAN_LABELS[facts.planKey] ?? facts.planKey,
    plural(facts.memberCount, 'member'),
  ];
  if (facts.appCount === 0) parts.push('no apps yet');
  else if (facts.sampleAppSlug && facts.appCount === 1) parts.push(facts.sampleAppSlug);
  else if (facts.sampleAppSlug) parts.push(`${facts.sampleAppSlug} +${facts.appCount - 1}`);
  return parts.join(' · ');
}

/**
 * Only when two entries would read identically is an ID worth showing. Mutates
 * nothing; returns the detail line each entry should display.
 */
export function disambiguate<T extends { id: string; name: string; detail: string }>(
  entries: T[],
): T[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = `${entry.name}|${entry.detail}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return entries.map((entry) =>
    (counts.get(`${entry.name}|${entry.detail}`) ?? 0) > 1
      ? { ...entry, detail: `${entry.detail} · ${entry.id.slice(0, 8)}` }
      : entry,
  );
}
