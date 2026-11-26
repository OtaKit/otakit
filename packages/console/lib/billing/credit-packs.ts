// Extra download packs, one per self-serve plan. Pure data so both server code
// and client components can import it; the Polar product IDs live in
// config.ts because they come from server-only environment variables.

export type CreditPackKey = 'downloads_5k' | 'downloads_100k' | 'downloads_1m';

export type CreditPack = {
  key: CreditPackKey;
  // The plan whose workspaces can buy this pack.
  planKey: 'free' | 'starter' | 'pro';
  downloads: number;
  // Must match the price of the pack's Polar product.
  priceCents: number;
};

export const CREDIT_PACKS: readonly CreditPack[] = [
  { key: 'downloads_5k', planKey: 'free', downloads: 5_000, priceCents: 500 },
  { key: 'downloads_100k', planKey: 'starter', downloads: 100_000, priceCents: 1_000 },
  { key: 'downloads_1m', planKey: 'pro', downloads: 1_000_000, priceCents: 5_000 },
];

export function isCreditPackKey(value: unknown): value is CreditPackKey {
  return CREDIT_PACKS.some((pack) => pack.key === value);
}

export function getCreditPack(key: CreditPackKey): CreditPack {
  const pack = CREDIT_PACKS.find((candidate) => candidate.key === key);
  if (!pack) throw new Error(`Unknown credit pack: ${key}`);
  return pack;
}

/** The pack a workspace on this plan can buy, or null (Enterprise). */
export function getCreditPackForPlan(planKey: string | null | undefined): CreditPack | null {
  return CREDIT_PACKS.find((pack) => pack.planKey === planKey) ?? null;
}

export function formatCreditPackPrice(pack: Pick<CreditPack, 'priceCents'>): string {
  const dollars = pack.priceCents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

export function formatCreditPackDownloads(pack: Pick<CreditPack, 'downloads'>): string {
  return pack.downloads.toLocaleString('en-US');
}
