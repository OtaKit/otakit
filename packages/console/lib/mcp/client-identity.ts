/**
 * The address shown next to an OAuth client's self-declared name on the consent
 * page and in Settings → Agents, so people can tell a client from a lookalike.
 *
 * A client ID metadata document client (CIMD) is identified by an https URL that
 * we fetched its metadata from, so that origin is proven. Its `client_uri` is
 * only a homepage link and may sit on another origin (Smithery Connect is
 * connect.smithery.ai with client_uri https://smithery.ai), so it is not shown as
 * the identity. Dynamically registered clients have opaque IDs; for them the
 * registered `client_uri` is all there is.
 */
export function oauthClientOrigin(clientId: string, clientUri: string | null): string | null {
  try {
    const url = new URL(clientId);
    if (url.protocol === 'https:') return url.origin;
  } catch {
    // Not a URL: a dynamically registered client.
  }
  return clientUri;
}
