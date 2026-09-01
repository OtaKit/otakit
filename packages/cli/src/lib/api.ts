import { randomUUID } from 'node:crypto';

import type { CliConfig } from './config.js';
import { fetchCli } from './http.js';
import type { NativePackage } from './native-deps.js';
import { CLI_VERSION, getCliUserAgent } from './version.js';

export interface Bundle {
  id: string;
  version: string;
  sha256: string;
  size: number;
  runtimeVersion?: string | null;
  strategy?: string;
  createdAt: string;
}

export interface BundleDetail extends Bundle {
  nativePackages?: NativePackage[] | null;
}

export interface UploadInitResponse {
  uploadId: string;
  presignedUrl: string;
  storageKey: string;
  expiresAt: string;
}

export interface DeltaFileDescriptor {
  path: string;
  sha256: string;
  size: number;
  /** Base64 MD5, pinned into the presigned PUT as Content-MD5. */
  md5: string;
}

export interface DeltaUploadInitResponse {
  uploadId: string;
  filesHash: string;
  uploads: { sha256: string; presignedUrl: string }[];
  expiresAt: string;
}

export interface Release {
  id: string;
  channel: string | null;
  runtimeVersion?: string | null;
  bundleId: string;
  bundleVersion?: string;
  forceImmediate?: boolean;
  autoRevert?: boolean;
  autoRevertRatePercent?: number;
  autoRevertMinSample?: number;
  promotedAt: string;
  promotedBy?: string;
  revertedAt?: string | null;
}

export interface ReleaseResult {
  operationId: string;
  idempotencyKey: string;
  publicationStatus: 'published' | 'manifest_sync_pending';
  release: Release;
  previousRelease: Release | null;
}

export class OtaKitApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly nextStep?: string;

  constructor(status: number, message: string, code?: string, nextStep?: string) {
    super(message);
    this.name = 'OtaKitApiError';
    this.status = status;
    this.code = code;
    this.nextStep = nextStep;
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly authToken: string;
  private readonly appId: string;
  private readonly version: string;
  private readonly organizationId?: string;

  constructor(
    config: CliConfig,
    version: string = CLI_VERSION,
    options: { organizationId?: string } = {},
  ) {
    this.baseUrl = config.serverUrl.replace(/\/$/, '');
    this.authToken = config.authToken;
    this.appId = config.appId;
    this.version = version;
    this.organizationId = options.organizationId;
  }

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const hasBody = options.body !== undefined;
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${this.authToken}`);
    headers.set('User-Agent', getCliUserAgent(this.version));
    if (this.organizationId) {
      headers.set('X-OtaKit-Organization-Id', this.organizationId);
    }
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
        const parsed = (await response.json()) as {
          error?: unknown;
          code?: unknown;
          nextStep?: unknown;
        };
        if (typeof parsed.error === 'string') {
          errorMessage = parsed.error;
        }
        throw new OtaKitApiError(
          response.status,
          errorMessage,
          typeof parsed.code === 'string' ? parsed.code : undefined,
          typeof parsed.nextStep === 'string' ? parsed.nextStep : undefined,
        );
      } else {
        // A proxy, a captive portal, or a wrong origin answers with HTML. Dumping
        // a whole page at the user helps nobody, so keep the status and say where
        // it came from instead.
        const text = (await response.text()).trim();
        const looksLikeMarkup = text.startsWith('<');
        if (text.length > 0 && !looksLikeMarkup) {
          errorMessage = text.length > 500 ? `${text.slice(0, 500)}…` : text;
        } else if (looksLikeMarkup) {
          errorMessage = `${url} returned HTML with status ${response.status}, not the OtaKit API. Check the server URL.`;
        }
      }

      throw new OtaKitApiError(response.status, errorMessage);
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
    nativePackages?: NativePackage[];
    encryption?: {
      alg: string;
      kid: string;
      wrapNonce: string;
      wrappedDek: string;
      nonce: string;
    };
  }): Promise<UploadInitResponse> {
    return this.request(this.appPath('/bundles/initiate'), {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async getBundle(bundleId: string): Promise<BundleDetail> {
    return this.request(this.appPath(`/bundles/${encodeURIComponent(bundleId)}`));
  }

  async finalizeUpload(options: { uploadId: string }): Promise<Bundle> {
    return this.request(this.appPath('/bundles/finalize'), {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async initiateDeltaUpload(options: {
    version: string;
    runtimeVersion?: string;
    files: DeltaFileDescriptor[];
    nativePackages?: NativePackage[];
  }): Promise<DeltaUploadInitResponse> {
    return this.request(this.appPath('/bundles/initiate-delta'), {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async finalizeDeltaUpload(options: { uploadId: string }): Promise<Bundle> {
    return this.request(this.appPath('/bundles/finalize-delta'), {
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
    return this.request(this.appPath(`/bundles${query ? `?${query}` : ''}`));
  }

  async deleteBundle(bundleId: string): Promise<void> {
    await this.request(this.appPath(`/bundles/${encodeURIComponent(bundleId)}`), {
      method: 'DELETE',
    });
  }

  async release(
    channel: string | null,
    bundleId: string,
    options?: {
      forceImmediate?: boolean;
      autoRevert?: boolean;
      autoRevertRatePercent?: number;
      autoRevertMinSample?: number;
      expectedCurrentReleaseId?: string | null;
      idempotencyKey?: string;
      compatibilityDecision?: 'block' | 'proceed' | 'skip';
    },
  ): Promise<ReleaseResult> {
    const autoRevert = options?.autoRevert === true;
    return this.request(this.appPath('/releases'), {
      method: 'POST',
      headers: { 'Idempotency-Key': options?.idempotencyKey ?? randomUUID() },
      body: JSON.stringify({
        bundleId,
        channel,
        ...(options && 'expectedCurrentReleaseId' in options
          ? { expectedCurrentReleaseId: options.expectedCurrentReleaseId }
          : {}),
        forceImmediate: options?.forceImmediate ?? false,
        autoRevert,
        compatibilityDecision: options?.compatibilityDecision,
        // The server rejects threshold fields unless autoRevert is true.
        ...(autoRevert
          ? {
              autoRevertRatePercent: options?.autoRevertRatePercent,
              autoRevertMinSample: options?.autoRevertMinSample,
            }
          : {}),
      }),
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
    return this.request(this.appPath(`/releases${query ? `?${query}` : ''}`));
  }
}
