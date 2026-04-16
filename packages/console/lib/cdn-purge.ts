const CDN_PURGE_API_BASE = 'https://api.cloudflare.com/client/v4';

function getConfiguredZoneId(): string | null {
  const value = process.env.CF_ZONE_ID?.trim();
  return value ? value : null;
}

function getConfiguredApiToken(): string | null {
  const value = process.env.CF_API_TOKEN?.trim();
  return value ? value : null;
}

export async function purgeCdnUrls(urls: string[]): Promise<void> {
  const uniqueUrls = Array.from(new Set(urls.filter((url) => url.trim().length > 0)));
  if (uniqueUrls.length === 0) {
    return;
  }

  const zoneId = getConfiguredZoneId();
  const apiToken = getConfiguredApiToken();
  if (!zoneId || !apiToken) {
    console.warn('[CDNPurge] Skipping purge because CF_ZONE_ID or CF_API_TOKEN is not configured.');
    return;
  }

  const response = await fetch(`${CDN_PURGE_API_BASE}/zones/${zoneId}/purge_cache`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ files: uniqueUrls }),
  });

  const body = (await response.json().catch(() => null)) as
    | { success?: boolean; errors?: Array<{ message?: string }> }
    | null;

  if (!response.ok || !body?.success) {
    const errorMessage = body?.errors?.map((entry) => entry.message).filter(Boolean).join('; ');
    throw new Error(
      `Cloudflare purge failed (${response.status}): ${errorMessage || 'unknown error'}`,
    );
  }
}
