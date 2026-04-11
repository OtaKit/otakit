import type { CliConfig } from './config.js';
import { fetchCli } from './http.js';
import { CLI_VERSION, getCliUserAgent } from './version.js';

export interface Bundle {
  id: string;
  version: string;
  sha256: string;
  size: number;
  runtimeVersion?: string | null;
  createdAt: string;
}

export interface UploadInitResponse {
  uploadId: string;
  presignedUrl: string;
  storageKey: string;
  expiresAt: string;
}

export interface Release {
  id: string;
  channel: string | null;
  runtimeVersion?: string | null;
  bundleId: string;
  bundleVersion?: string;
  promotedAt: string;
  promotedBy?: string;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly authToken: string;
  private readonly appId: string;
  private readonly version: string;

  constructor(config: CliConfig, version: string = CLI_VERSION) {
    this.baseUrl = config.serverUrl.replace(/\/$/, '');
    this.authToken = config.authToken;
    this.appId = config.appId;
    this.version = version;
  }

  private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const hasBody = options.body !== undefined;
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${this.authToken}`);
    headers.set('User-Agent', getCliUserAgent(this.version));
    if (hasBody && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetchCli(url, {
      ...options,
      headers,
    });

    const contentType = response.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json');

    if (!response.ok) {
      let errorMessage = `API error (${response.status})`;

      if (isJson) {
        const parsed = (await response.json()) as { error?: unknown };
        if (typeof parsed.error === 'string') {
          errorMessage = parsed.error;
        }
      } else {
        const text = await response.text();
        if (text.trim().length > 0) {
          errorMessage = text;
        }
      }

      throw new Error(errorMessage);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    if (!isJson) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  private appPath(suffix: string): string {
    return `/api/v1/apps/${encodeURIComponent(this.appId)}${suffix}`;
  }

  async initiateUpload(options: {
    version: string;
    runtimeVersion?: string;
    size: number;
    sha256: string;
  }): Promise<UploadInitResponse> {
    return this.fetch(this.appPath('/bundles/initiate'), {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async finalizeUpload(options: { uploadId: string }): Promise<Bundle> {
    return this.fetch(this.appPath('/bundles/finalize'), {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async listBundles(options?: {
    limit?: number;
    offset?: number;
  }): Promise<{ bundles: Bundle[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));

    const query = params.toString();
    return this.fetch(this.appPath(`/bundles${query ? `?${query}` : ''}`));
  }

  async deleteBundle(bundleId: string): Promise<void> {
    await this.fetch(this.appPath(`/bundles/${encodeURIComponent(bundleId)}`), {
      method: 'DELETE',
    });
  }

  async release(
    channel: string | null,
    bundleId: string,
  ): Promise<{ release: Release; previousRelease: Release | null }> {
    return this.fetch(this.appPath('/releases'), {
      method: 'POST',
      body: JSON.stringify({ bundleId, channel }),
    });
  }

  async listReleases(
    channel: string | null | undefined,
    options?: {
      limit?: number;
      offset?: number;
    },
  ): Promise<{ releases: Release[]; total: number }> {
    const params = new URLSearchParams();
    if (channel === null) params.set('channel', '');
    if (typeof channel === 'string') params.set('channel', channel);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));

    const query = params.toString();
    return this.fetch(this.appPath(`/releases${query ? `?${query}` : ''}`));
  }
}
