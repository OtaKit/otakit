type TinybirdQueryParams = Record<string, string | number | boolean | null | undefined>;

type TinybirdResponseEnvelope<T> = {
  data?: T[];
};

const DEFAULT_TINYBIRD_API_HOST = 'https://api.tinybird.co';

let _warnedMissing = false;

export function isTinybirdConfigured(): boolean {
  return !!process.env.TINYBIRD_READ_TOKEN?.trim();
}

export function warnTinybirdNotConfigured(context: string): void {
  if (!_warnedMissing) {
    console.warn(
      '[OtaKit] Tinybird is not configured — device event analytics are disabled. Set TINYBIRD_READ_TOKEN to enable.',
    );
    _warnedMissing = true;
  }
  console.warn(`[OtaKit] Skipping ${context}: Tinybird not configured`);
}

export class TinybirdConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TinybirdConfigError';
  }
}

function trimToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeTinybirdApiHost(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'https:') {
    throw new TinybirdConfigError('TINYBIRD_API_HOST must use https');
  }
  return parsed.toString().replace(/\/+$/, '');
}

function resolveTinybirdReadConfig(): { apiHost: string; readToken: string } {
  const readToken = trimToNull(process.env.TINYBIRD_READ_TOKEN);
  if (!readToken) {
    throw new TinybirdConfigError('Missing TINYBIRD_READ_TOKEN');
  }

  const rawApiHost = trimToNull(process.env.TINYBIRD_API_HOST) ?? DEFAULT_TINYBIRD_API_HOST;
  return {
    apiHost: normalizeTinybirdApiHost(rawApiHost),
    readToken,
  };
}

export async function queryTinybirdPipe<T>(
  pipeName: string,
  params: TinybirdQueryParams,
): Promise<T[]> {
  const { apiHost, readToken } = resolveTinybirdReadConfig();
  const url = new URL(`/v0/pipes/${pipeName}.json`, apiHost);

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${readToken}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Tinybird pipe "${pipeName}" failed with ${response.status}${body ? `: ${body}` : ''}`,
    );
  }

  const payload = (await response.json()) as TinybirdResponseEnvelope<T> | T[];
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === 'object' && Array.isArray(payload.data)) {
    return payload.data;
  }

  throw new Error(`Tinybird pipe "${pipeName}" returned an unexpected JSON shape`);
}
