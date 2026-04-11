import { NextRequest, NextResponse } from 'next/server';

import { checkRateLimit } from '@/lib/rate-limit';
import {
  getCachedLatestManifestRelease,
  getCachedManifestAppAccess,
} from '@/lib/cache/manifest-cache';
import { signLegacyManifest, signManifest } from '@/lib/manifest-signing';
import { createSignedDownloadUrl } from '@/lib/storage';
import {
  isValidChannelName,
  isValidRuntimeVersion,
  normalizeOptionalChannel,
  normalizeOptionalRuntimeVersion,
  parsePlatform,
} from '@/lib/validation';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const appId = request.headers.get('X-App-Id')?.trim();
  if (!appId) {
    return NextResponse.json({ error: 'Missing X-App-Id header' }, { status: 401 });
  }

  const rl = await checkRateLimit('manifest', appId, 20, 1);
  if (!rl.allowed) {
    return new NextResponse(null, { status: 429 });
  }

  const platform = parsePlatform(request.headers.get('X-Platform'));
  if (!platform) {
    return NextResponse.json({ error: 'Missing or invalid X-Platform header' }, { status: 400 });
  }

  const channel = normalizeOptionalChannel(request.headers.get('X-Channel'));
  if (channel && !isValidChannelName(channel)) {
    return NextResponse.json({ error: 'Invalid X-Channel header' }, { status: 400 });
  }

  const rawRuntimeVersion = request.headers.get('X-Runtime-Version');
  const runtimeVersion = normalizeOptionalRuntimeVersion(rawRuntimeVersion);
  if (
    typeof rawRuntimeVersion === 'string' &&
    rawRuntimeVersion.trim().length > 0 &&
    (!runtimeVersion || !isValidRuntimeVersion(runtimeVersion))
  ) {
    return NextResponse.json({ error: 'Invalid X-Runtime-Version header' }, { status: 400 });
  }

  const app = await getCachedManifestAppAccess(appId);
  if (!app) {
    return NextResponse.json({ error: 'Invalid app ID' }, { status: 401 });
  }

  if (app.usageBlocked) {
    return NextResponse.json({ error: 'usage_limit_reached', blocked: true }, { status: 402 });
  }

  const currentVersion = request.headers.get('X-Current-Version');
  const latestRelease = await getCachedLatestManifestRelease(app.appId, channel, runtimeVersion);

  if (!latestRelease) {
    return new NextResponse(null, { status: 204 });
  }

  const bundle = latestRelease.bundle;
  if (currentVersion && currentVersion === bundle.version) {
    return new NextResponse(null, { status: 204 });
  }

  const downloadUrl = await createSignedDownloadUrl(bundle.storageKey);
  const signature = signLegacyManifest({
    appId: app.appId,
    channel,
    platform,
    version: bundle.version,
    sha256: bundle.sha256,
    size: bundle.size,
    runtimeVersion: bundle.runtimeVersion,
  });
  const signatureV2 = signManifest({
    appId: app.appId,
    channel,
    platform,
    version: bundle.version,
    sha256: bundle.sha256,
    size: bundle.size,
    runtimeVersion: bundle.runtimeVersion,
  });

  return NextResponse.json({
    version: bundle.version,
    channel,
    runtimeVersion: bundle.runtimeVersion,
    releaseId: latestRelease.id,
    url: downloadUrl,
    sha256: bundle.sha256,
    size: bundle.size,
    signature,
    signatureV2,
  });
}
