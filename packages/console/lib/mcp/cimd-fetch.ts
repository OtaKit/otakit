import { isPublicRoutableHost } from '@better-auth/core/utils/host';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

const BODY_FORBIDDEN_STATUSES = new Set([204, 205, 304]);

function responseHeaders(headers: Record<string, string | string[] | undefined>): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      value.forEach((item) => result.append(name, item));
    } else if (value !== undefined) {
      result.append(name, value);
    }
  }
  return result;
}

export async function fetchCimdMetadataResource(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const webRequest = new Request(input, init);
  const url = new URL(webRequest.url);
  if (url.protocol !== 'https:') throw new TypeError('CIMD metadata requires HTTPS');
  if (webRequest.method !== 'GET' && webRequest.method !== 'HEAD') {
    throw new TypeError('CIMD metadata fetch supports only GET and HEAD');
  }

  const originalHostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(originalHostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new TypeError('CIMD metadata hostname has no DNS address');
  if (addresses.some(({ address }) => !isPublicRoutableHost(address))) {
    throw new TypeError('CIMD metadata hostname must resolve only to public addresses');
  }

  const pinnedAddress = addresses[0];
  const headers = Object.fromEntries(webRequest.headers.entries());
  headers.host = url.host;
  const signal = init?.signal ?? (input instanceof Request ? input.signal : webRequest.signal);

  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        protocol: 'https:',
        hostname: pinnedAddress.address,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: webRequest.method,
        headers,
        servername: isIP(originalHostname) === 0 ? originalHostname : undefined,
        signal,
        agent: false,
      },
      (incoming) => {
        const status = incoming.statusCode ?? 500;
        const body: BodyInit | null =
          webRequest.method === 'HEAD' || BODY_FORBIDDEN_STATUSES.has(status)
            ? null
            : (Readable.toWeb(incoming) as unknown as BodyInit);
        resolve(
          new Response(body, {
            status,
            statusText: incoming.statusMessage,
            headers: responseHeaders(incoming.headers),
          }),
        );
      },
    );
    outgoing.once('error', reject);
    outgoing.end();
  });
}
