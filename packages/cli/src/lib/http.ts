import { CliError } from './errors.js';
import { CLI_VERSION, getCliUserAgent } from './version.js';

export const DEFAULT_API_TIMEOUT_MS = 30_000;

type FetchCliConfig = {
  timeoutMs?: number;
  userAgent?: string;
};

export async function fetchCli(
  url: string,
  options: RequestInit = {},
  config: FetchCliConfig = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = config.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(options.headers);
  headers.set('User-Agent', config.userAgent ?? getCliUserAgent(CLI_VERSION));

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new CliError(`Request timed out after ${Math.ceil(timeoutMs / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function parseApiError(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');

  if (!isJson) {
    const text = await response.text();
    return text.trim().length > 0 ? text : `API error (${response.status})`;
  }

  const payload = (await response.json()) as {
    message?: unknown;
    error?: unknown;
  };

  if (typeof payload.message === 'string' && payload.message.trim().length > 0) {
    return payload.message;
  }
  if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
    return payload.error;
  }

  return `API error (${response.status})`;
}
