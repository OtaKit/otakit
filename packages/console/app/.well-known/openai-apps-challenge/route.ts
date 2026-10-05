export const dynamic = 'force-dynamic';

/**
 * OpenAI's plugin directory verifies that the submitter controls the MCP
 * server's domain by fetching this token. Set OPENAI_APPS_CHALLENGE to the
 * token from the submission form; without it the path does not exist.
 */
export function GET(): Response {
  const token = process.env.OPENAI_APPS_CHALLENGE?.trim();
  if (!token) return new Response('Not found', { status: 404 });
  return new Response(token, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}
