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
  /** Share of devices (1-100); below 100 on a non-reverted release is an active rollout. */
  rolloutPercent?: number;
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
  replacedRelease?: Release;
}

export interface RolloutResult {
  operationId: string;
  idempotencyKey: string;
  publicationStatus: 'published' | 'manifest_sync_pending';
  release: Release;
  previousPercent: number;
}

export interface RevertResult {
  operationId: string;
  idempotencyKey: string;
  publicationStatus: 'published' | 'manifest_sync_pending';
  release: Release;
  currentRelease: Release | null;
}

export type PreviewExpiry = '1h' | '24h' | '7d' | '30d';

export interface Preview {
  id: string;
  bundleId: string;
  bundleVersion: string;
  runtimeVersion: string | null;
  createdAt: string;
  createdBy: string | null;
  expiresAt: string;
  /** Page to share or scan. */
  url: string;
  /** PNG QR code of `url`. */
  qrUrl: string;
  /** Opens the app on this preview, once the app's URL scheme is known. */
  deepLink: string | null;
}

/** True for the lane-current release of an active rollout. */
export function isActiveRollout(release: Release): boolean {
  return !release.revertedAt && (release.rolloutPercent ?? 100) < 100;
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

export type PushPayloadInput = {
  title: string;
  body: string;
  url?: string;
  data?: Record<string, string>;
};

export type PushAudienceInput = {
  platforms?: Array<'ios' | 'android'>;
  channels?: string[];
  runtimeVersions?: string[];
  topics?: string[];
  userIds?: string[];
};

export type PushPreview = {
  audienceCount: { total: number; ios: number; android: number };
  warnings: string[];
};

export type PushCampaign = {
  id: string;
  status: 'queued' | 'sending' | 'completed' | 'failed' | 'canceled';
  payload: PushPayloadInput;
  targeted: number;
  accepted: number;
  failed: number;
  invalidRemoved: number;
  errorSummary: Record<string, number> | null;
  failureReason: string | null;
  createdAt: string;
};

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

  async previewPush(input: {
    payload: PushPayloadInput;
    audience: PushAudienceInput;
  }): Promise<PushPreview> {
    return this.request<PushPreview>(this.appPath('/push/audience'), {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async sendPush(input: {
    payload: PushPayloadInput;
    audience: PushAudienceInput;
    expectedAudience?: number;
    idempotencyKey: string;
  }): Promise<{ campaign: PushCampaign }> {
    return this.request<{ campaign: PushCampaign }>(this.appPath('/push/campaigns'), {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: JSON.stringify({
        payload: input.payload,
        audience: input.audience,
        expectedAudience: input.expectedAudience,
      }),
    });
  }

  async listPushCampaigns(limit = 20): Promise<{ campaigns: PushCampaign[] }> {
    return this.request<{ campaigns: PushCampaign[] }>(
      this.appPath(`/push/campaigns?limit=${encodeURIComponent(String(limit))}`),
    );
  }

  async getPushCampaign(campaignId: string): Promise<{ campaign: PushCampaign }> {
    return this.request<{ campaign: PushCampaign }>(
      this.appPath(`/push/campaigns/${encodeURIComponent(campaignId)}`),
    );
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
      rolloutPercent?: number;
      replaceRollout?: boolean;
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
        rolloutPercent: options?.rolloutPercent,
        replaceRollout: options?.replaceRollout,
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

  async createPreview(
    bundleId: string,
    options: { expiresIn?: PreviewExpiry; urlScheme?: string } = {},
  ): Promise<{ preview: Preview }> {
    return this.request(this.appPath(`/bundles/${encodeURIComponent(bundleId)}/previews`), {
      method: 'POST',
      body: JSON.stringify({ expiresIn: options.expiresIn, urlScheme: options.urlScheme }),
    });
  }

  async listPreviews(
    bundleId?: string,
  ): Promise<{ previews: Preview[]; urlScheme: string | null }> {
    const query = bundleId ? `?${new URLSearchParams({ bundleId }).toString()}` : '';
    return this.request(this.appPath(`/previews${query}`));
  }

  async revokePreview(
    previewId: string,
  ): Promise<{ status: 'revoked' | 'already_ended'; previewId: string }> {
    return this.request(this.appPath(`/previews/${encodeURIComponent(previewId)}`), {
      method: 'DELETE',
    });
  }

  /**
   * Whether the server accepts percentage rollouts, or null when it cannot
   * say (an older server without the context endpoint).
   */
  async supportsRollouts(): Promise<boolean | null> {
    try {
      const context = await this.request<{ capabilities?: { releaseReliability?: unknown } }>(
        `/api/v1/context?${new URLSearchParams({ appId: this.appId }).toString()}`,
      );
      const supported = context.capabilities?.releaseReliability;
      return typeof supported === 'boolean' ? supported : null;
    } catch {
      return null;
    }
  }

  /** Change an active rollout's percentage; 100 completes it. */
  async updateRollout(
    releaseId: string,
    options: { percent: number; expectedPercent?: number; idempotencyKey?: string },
  ): Promise<RolloutResult> {
    return this.request(this.appPath(`/releases/${encodeURIComponent(releaseId)}/rollout`), {
      method: 'PATCH',
      headers: { 'Idempotency-Key': options.idempotencyKey ?? randomUUID() },
      body: JSON.stringify({ percent: options.percent, expectedPercent: options.expectedPercent }),
    });
  }

  async revertRelease(
    releaseId: string,
    options?: {
      expectedCurrentReleaseId?: string;
      /** Cancelling a rollout: refused unless the release is still at this share. */
      expectedRolloutPercent?: number;
      forceImmediate?: boolean;
      idempotencyKey?: string;
    },
  ): Promise<RevertResult> {
    return this.request(this.appPath(`/releases/${encodeURIComponent(releaseId)}/revert`), {
      method: 'POST',
      headers: { 'Idempotency-Key': options?.idempotencyKey ?? randomUUID() },
      body: JSON.stringify({
        expectedCurrentReleaseId: options?.expectedCurrentReleaseId,
        expectedRolloutPercent: options?.expectedRolloutPercent,
        forceImmediate: options?.forceImmediate,
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
