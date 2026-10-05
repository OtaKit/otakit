export const dynamic = 'force-dynamic';

/**
 * Glama lists the remote MCP server from the official registry; this file
 * proves ownership of the listing. Set GLAMA_CONNECTOR_CLAIM to the claim
 * token Glama shows; without it the path does not exist.
 */
export function GET(): Response {
  const claim = process.env.GLAMA_CONNECTOR_CLAIM?.trim();
  if (!claim) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(
    { $schema: 'https://glama.ai/mcp/schemas/connector.json', claim },
    { headers: { 'cache-control': 'no-store' } },
  );
}
