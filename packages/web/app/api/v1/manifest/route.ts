import { NextRequest, NextResponse } from 'next/server';

import { checkRateLimit } from '@/lib/rate-limit';
import {
  getCachedLatestManifestRelease,
  getCachedManifestAppAccess,
} from '@/lib/cache/manifest-cache';
import { signManifest } from '@/lib/manifest-signing';
import { createSignedDownloadUrl } from '@/lib/storage';
import { isValidChannelName, normalizeOptionalChannel, parsePlatform } from '@/lib/validation';

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

  const app = await getCachedManifestAppAccess(appId);
  if (!app) {
    return NextResponse.json({ error: 'Invalid app ID' }, { status: 401 });
  }

  if (app.usageBlocked) {
    return NextResponse.json({ error: 'usage_limit_reached', blocked: true }, { status: 402 });
  }

  const currentVersion = request.headers.get('X-Current-Version');
  const nativeBuild = request.headers.get('X-Native-Build');

  const latestRelease = await getCachedLatestManifestRelease(app.appId, channel);

  if (!latestRelease) {
    return new NextResponse(null, { status: 204 });
  }

  const bundle = latestRelease.bundle;
  if (currentVersion && currentVersion === bundle.version) {
    return new NextResponse(null, { status: 204 });
  }

  if (bundle.minNativeBuild !== null) {
    if (!nativeBuild) {
      return NextResponse.json({ error: 'Missing X-Native-Build header' }, { status: 400 });
    }

    const clientBuild = Number.parseInt(nativeBuild, 10);
    if (!Number.isInteger(clientBuild) || clientBuild <= 0) {
      return NextResponse.json({ error: 'Invalid X-Native-Build header' }, { status: 400 });
    }

    if (clientBuild < bundle.minNativeBuild) {
      return NextResponse.json(
        {
          error: 'native_build_too_old',
          minNativeBuild: bundle.minNativeBuild,
          message: `Native build ${clientBuild} is below minimum ${bundle.minNativeBuild}`,
        },
        { status: 406 },
      );
    }
  }

  const downloadUrl = await createSignedDownloadUrl(bundle.storageKey);
  const signature = signManifest({
    appId: app.appId,
    channel,
    platform,
    version: bundle.version,
    sha256: bundle.sha256,
    size: bundle.size,
    minNativeBuild: bundle.minNativeBuild,
  });

  return NextResponse.json({
    version: bundle.version,
    channel,
    releaseId: latestRelease.id,
    url: downloadUrl,
    sha256: bundle.sha256,
    size: bundle.size,
    minNativeBuild: bundle.minNativeBuild,
    signature,
  });
}
