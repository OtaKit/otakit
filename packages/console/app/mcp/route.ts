import { createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server';
import { requireMcpAuth } from '@better-auth/mcp';

import { auth } from '@/lib/auth';
import { verifySecretAuth } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  createOtaKitMcpServer,
  getToolDefinition,
  OTAKIT_MCP_VERSION,
  type OtaKitToolName,
} from '@otakit/mcp-core';
import {
  isRemoteMcpEnabled,
  isRemoteMcpOAuthEnabled,
  remoteMcpResourceUrl,
  remoteMcpServerOrigin,
} from '@/lib/mcp/features';
import {
  organizationKeyConnection,
  RemoteMcpAuthError,
  resolveOAuthConnection,
  type RemoteMcpConnection,
} from '@/lib/mcp/remote-auth';
import { createRemoteToolAuthorization, RemoteOtaKitToolAdapter } from '@/lib/mcp/remote-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_REQUEST_BYTES = 1024 * 1024;
const SERVER_VERSION = OTAKIT_MCP_VERSION;
const REMOTE_MCP_DISABLED_MESSAGE =
  'Remote MCP is not enabled on this deployment. Use local MCP or ask the deployment operator to enable it.';

function connectionFromAuthInfo(authInfo: AuthInfo | undefined): RemoteMcpConnection {
  const connection = authInfo?.extra?.connection;
  if (!connection || typeof connection !== 'object') {
    throw new Error('MCP request is missing verified connection context');
  }
  return connection as RemoteMcpConnection;
}

const mcpHandler = createMcpHandler(
  ({ authInfo }) => {
    const connection = connectionFromAuthInfo(authInfo);
    return createOtaKitMcpServer({
      mode: 'remote',
      version: SERVER_VERSION,
      adapter: new RemoteOtaKitToolAdapter(connection),
      authorization: createRemoteToolAuthorization(connection),
      onError: (error, tool) => {
        console.error(
          JSON.stringify({
            remoteMcpToolFailed: tool,
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
        );
      },
    });
  },
  {
    // One shared factory serves both protocol eras so tool behavior cannot drift.
    legacy: 'stateless',
    responseMode: 'auto',
    onerror: (error) => {
      console.error(JSON.stringify({ remoteMcpProtocolError: error.message }));
    },
  },
);

function jsonRpcError(status: number, message: string, headers?: HeadersInit): Response {
  return Response.json(
    {
      jsonrpc: '2.0',
      error: { code: status === 429 ? -32001 : -32000, message },
      id: null,
    },
    { status, headers },
  );
}

function remoteMcpDisabled(): Response {
  return jsonRpcError(503, REMOTE_MCP_DISABLED_MESSAGE, {
    link: '<https://otakit.app/docs/agents>; rel="help"',
    'retry-after': '300',
  });
}

function allowedOrigins(): ReadonlySet<string> {
  const configured = (process.env.OTAKIT_REMOTE_MCP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([remoteMcpServerOrigin(), ...configured]);
}

function validateOrigin(request: Request): Response | null {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  if (allowedOrigins().has(origin)) return null;
  return jsonRpcError(403, 'Origin is not allowed');
}

function withCors(request: Request, response: Response): Response {
  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins().has(origin)) return response;
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', origin);
  headers.set(
    'access-control-expose-headers',
    'WWW-Authenticate, MCP-Protocol-Version, MCP-Session-Id',
  );
  headers.append('vary', 'Origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new RangeError('MCP request body is too large');
  }
  if (!request.body) throw new SyntaxError('Missing JSON request body');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new RangeError('MCP request body is too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function calledToolNames(body: unknown): OtaKitToolName[] {
  const messages = Array.isArray(body) ? body : [body];
  const names: OtaKitToolName[] = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const record = message as Record<string, unknown>;
    if (record.method !== 'tools/call') continue;
    const params = record.params;
    if (!params || typeof params !== 'object') continue;
    const name = (params as Record<string, unknown>).name;
    if (typeof name !== 'string') continue;
    try {
      getToolDefinition(name as OtaKitToolName);
      names.push(name as OtaKitToolName);
    } catch {
      // The MCP handler returns the protocol-level unknown-tool response.
    }
  }
  return names;
}

function authInfo(connection: RemoteMcpConnection): AuthInfo {
  return {
    // The transport only needs verified identity context. Never copy a bearer secret
    // into callbacks or logs after authentication has completed.
    token: 'verified',
    clientId: connection.clientId ?? `organization-key:${connection.access.actorId}`,
    scopes: Array.from(connection.scopes),
    resource: new URL(remoteMcpResourceUrl()),
    extra: { connection },
  };
}

async function serveAuthorized(
  request: Request,
  connection: RemoteMcpConnection,
): Promise<Response> {
  let parsedBody: unknown;
  try {
    parsedBody = await readBoundedJson(request);
  } catch (error) {
    if (error instanceof RangeError) return jsonRpcError(413, error.message);
    return jsonRpcError(400, 'Invalid JSON request body');
  }

  const tools = calledToolNames(parsedBody);
  const hasWrite = tools.some((name) => getToolDefinition(name).annotations.readOnlyHint !== true);
  // A JSON-RPC batch carries many calls in one request, so charge the limiter
  // per tool call. Otherwise one request could ask for unbounded work.
  const rateLimit = await checkRateLimit(
    hasWrite ? 'remote-mcp-write' : 'remote-mcp-read',
    `${connection.access.organizationId}:${connection.credentialType}:${connection.clientId ?? connection.access.actorId}`,
    hasWrite ? 20 : 120,
    60,
    Math.max(1, tools.length),
  );
  if (!rateLimit.allowed) return jsonRpcError(429, 'Too many MCP requests; retry shortly');

  return mcpHandler.fetch(request, { authInfo: authInfo(connection), parsedBody });
}

async function serveOAuthAuthorized(request: Request, claims: Record<string, unknown>) {
  try {
    return await serveAuthorized(request, await resolveOAuthConnection(claims));
  } catch (error) {
    if (error instanceof RemoteMcpAuthError) {
      return jsonRpcError(401, error.message, {
        'WWW-Authenticate': 'Bearer error="invalid_token"',
      });
    }
    throw error;
  }
}

const oauthHandler = requireMcpAuth(auth, serveOAuthAuthorized, {
  resource: remoteMcpResourceUrl(),
  challengeScopes: ['otakit:read'],
});

export async function POST(request: Request): Promise<Response> {
  if (!isRemoteMcpEnabled()) return remoteMcpDisabled();
  const originFailure = validateOrigin(request);
  if (originFailure) return originFailure;
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return withCors(request, jsonRpcError(415, 'Content-Type must be application/json'));
  }

  const key = await verifySecretAuth(request.headers.get('authorization'));
  const response = key.success
    ? await serveAuthorized(
        request,
        organizationKeyConnection({ organizationId: key.organizationId, keyId: key.keyId }),
      )
    : isRemoteMcpOAuthEnabled()
      ? await oauthHandler(request)
      : jsonRpcError(401, 'A valid organization API key is required');
  return withCors(request, response);
}

export async function OPTIONS(request: Request): Promise<Response> {
  if (!isRemoteMcpEnabled()) return remoteMcpDisabled();
  const originFailure = validateOrigin(request);
  if (originFailure) return originFailure;
  const origin = request.headers.get('origin');
  const headers = new Headers({
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers':
      'Authorization, Content-Type, Last-Event-ID, MCP-Method, MCP-Name, MCP-Protocol-Version, MCP-Session-Id',
    'access-control-max-age': '600',
  });
  if (origin) {
    headers.set('access-control-allow-origin', origin);
    headers.set('vary', 'Origin');
  }
  return new Response(null, { status: 204, headers });
}
