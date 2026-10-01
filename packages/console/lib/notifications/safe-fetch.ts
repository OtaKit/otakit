import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/**
 * Outbound requests to customer-supplied URLs. They may only reach the public
 * internet: every address a host resolves to is checked and the connection is
 * pinned to the checked address (no DNS rebinding), IP literals are checked
 * directly, and redirects are never followed. Self-hosted servers that post to
 * internal services set NOTIFICATIONS_ALLOW_PRIVATE_URLS=true, which also allows
 * plain http.
 */

export const REQUEST_TIMEOUT_MS = 15_000;
const MAX_URL_LENGTH = 2048;
const MAX_RESPONSE_BYTES = 2048;

export type UrlDestinationType = 'webhook' | 'slack' | 'discord';

const BLOCKED_RANGES: Array<[string, number, 'ipv4' | 'ipv6']> = [
  ['0.0.0.0', 8, 'ipv4'], // "this" network
  ['10.0.0.0', 8, 'ipv4'], // private
  ['100.64.0.0', 10, 'ipv4'], // carrier-grade NAT
  ['127.0.0.0', 8, 'ipv4'], // loopback
  ['169.254.0.0', 16, 'ipv4'], // link-local, cloud metadata
  ['172.16.0.0', 12, 'ipv4'], // private
  ['192.0.0.0', 24, 'ipv4'], // IETF protocol assignments
  ['192.0.2.0', 24, 'ipv4'], // documentation
  ['192.88.99.0', 24, 'ipv4'], // 6to4 relay
  ['192.168.0.0', 16, 'ipv4'], // private
  ['198.18.0.0', 15, 'ipv4'], // benchmarking
  ['198.51.100.0', 24, 'ipv4'], // documentation
  ['203.0.113.0', 24, 'ipv4'], // documentation
  ['224.0.0.0', 4, 'ipv4'], // multicast
  ['240.0.0.0', 4, 'ipv4'], // reserved, broadcast
  ['::', 128, 'ipv6'], // unspecified
  ['::1', 128, 'ipv6'], // loopback
  ['64:ff9b::', 96, 'ipv6'], // NAT64
  ['64:ff9b:1::', 48, 'ipv6'], // local NAT64
  ['100::', 64, 'ipv6'], // discard
  ['2001::', 32, 'ipv6'], // Teredo
  ['2001:db8::', 32, 'ipv6'], // documentation
  ['2002::', 16, 'ipv6'], // 6to4
  ['fc00::', 7, 'ipv6'], // unique local
  ['fe80::', 10, 'ipv6'], // link-local
  ['ff00::', 8, 'ipv6'], // multicast
];

// BlockList checks IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) against the IPv4
// rules itself. A ::ffff:0:0/96 rule must not be added: it matches every IPv4.
const blockList = new net.BlockList();
for (const [address, prefix, type] of BLOCKED_RANGES) {
  blockList.addSubnet(address, prefix, type);
}

export function allowPrivateUrls(): boolean {
  return process.env.NOTIFICATIONS_ALLOW_PRIVATE_URLS === 'true';
}

/** True for addresses outside the public internet, and for anything unparseable. */
export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return true;
  return blockList.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

function hostnameAddress(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

const DISCORD_HOSTS = new Set([
  'discord.com',
  'discordapp.com',
  'ptb.discord.com',
  'canary.discord.com',
]);

/** Checks a destination URL when it is saved. Returns the normalized URL. */
export function validateDestinationUrl(
  type: UrlDestinationType,
  raw: unknown,
): { url: string } | { error: string } {
  if (typeof raw !== 'string' || !raw.trim()) return { error: 'URL is required' };
  const value = raw.trim();
  if (value.length > MAX_URL_LENGTH) return { error: 'URL is too long' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { error: 'Enter a valid URL' };
  }
  const allowPrivate = allowPrivateUrls();
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) {
    return { error: 'URL must start with https://' };
  }
  if (url.username || url.password) {
    return { error: 'URL must not contain a username or password' };
  }
  const host = url.hostname.toLowerCase();
  if (type === 'slack' && (host !== 'hooks.slack.com' || !url.pathname.startsWith('/services/'))) {
    return { error: 'Use a Slack incoming webhook URL (https://hooks.slack.com/services/…)' };
  }
  if (
    type === 'discord' &&
    (!DISCORD_HOSTS.has(host) || !url.pathname.startsWith('/api/webhooks/'))
  ) {
    return { error: 'Use a Discord webhook URL (https://discord.com/api/webhooks/…)' };
  }
  if (!allowPrivate) {
    const literal = hostnameAddress(host);
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      (net.isIP(literal) !== 0 && isBlockedAddress(literal))
    ) {
      return { error: 'URL must point to a public address' };
    }
  }
  return { url: url.toString() };
}

class BlockedAddressError extends Error {
  constructor(hostname: string) {
    super(`${hostname} resolves to a private or reserved address`);
  }
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

/** dns.lookup that refuses non-public answers; net.connect uses what it returns. */
function guardedLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, []);
    if (addresses.length === 0) {
      return callback(new Error(`Could not resolve ${hostname}`), []);
    }
    if (!allowPrivateUrls() && addresses.some((entry) => isBlockedAddress(entry.address))) {
      return callback(new BlockedAddressError(hostname), []);
    }
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

export type PostResult = {
  statusCode: number;
  /** The start of the response body, for the delivery log. */
  body: string;
  location: string | null;
};

function describeNetworkError(error: unknown, hostname: string): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `Could not resolve ${hostname}`;
  if (code === 'ECONNREFUSED') return `Connection refused by ${hostname}`;
  if (code === 'ECONNRESET') return `Connection reset by ${hostname}`;
  return error instanceof Error ? error.message : 'Request failed';
}

/**
 * POST a JSON body. Resolves with the HTTP status for any response (including
 * 3xx, which is not followed) and rejects with a readable message when no
 * response arrives within the deadline.
 */
export function postJson(
  rawUrl: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<PostResult> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return reject(new Error('Invalid URL'));
    }
    const allowPrivate = allowPrivateUrls();
    const isHttps = url.protocol === 'https:';
    if (!isHttps && !(allowPrivate && url.protocol === 'http:')) {
      return reject(new Error('URL must use https'));
    }
    const literal = hostnameAddress(url.hostname);
    if (!allowPrivate && net.isIP(literal) !== 0 && isBlockedAddress(literal)) {
      return reject(new BlockedAddressError(url.hostname));
    }

    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      outcome();
    };

    const request = (isHttps ? https : http).request(
      url,
      {
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
        },
        lookup: guardedLookup as unknown as typeof dns.lookup,
        agent: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let received = 0;
        const done = () =>
          finish(() =>
            resolve({
              statusCode: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
              location: response.headers.location ?? null,
            }),
          );
        response.on('data', (chunk: Buffer) => {
          if (received < MAX_RESPONSE_BYTES) {
            chunks.push(chunk.subarray(0, MAX_RESPONSE_BYTES - received));
          }
          received += chunk.length;
          if (received >= MAX_RESPONSE_BYTES) {
            done();
            response.destroy();
          }
        });
        response.on('end', done);
        response.on('error', done);
      },
    );
    const deadline = setTimeout(() => {
      request.destroy(new Error(`No response within ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    request.on('error', (error) =>
      finish(() => reject(new Error(describeNetworkError(error, url.hostname)))),
    );
    request.end(body);
  });
}
