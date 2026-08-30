import { NextRequest, NextResponse } from 'next/server';

import { accessActor } from '@/lib/audit-log';
import { resolveOrganizationAccess } from '@/lib/organization-access';
import { resolveReleaseActor } from '@/lib/release-audit';
import { isReleaseReliabilityEnabled } from '@/lib/release-features';
import { serviceErrorResponse } from '@/lib/services/http';
import { listReleases, publishRelease, publishReleaseLegacy } from '@/lib/services/releases';
import {
  isValidChannelName,
  normalizeOptionalChannel,
  parseNonNegativeInteger,
} from '@/lib/validation';

export const runtime = 'nodejs';

function resolveChannelFilter(request: NextRequest): {
  present: boolean;
  value: string | null;
  invalid: boolean;
} {
  const searchParams = request.nextUrl.searchParams;
  if (!searchParams.has('channel')) {
    return { present: false, value: null, invalid: false };
  }

  const rawChannel = searchParams.get('channel');
  const channel = normalizeOptionalChannel(rawChannel);
  const invalid =
    typeof rawChannel === 'string' &&
    rawChannel.trim().length > 0 &&
    (!channel || !isValidChannelName(channel));

  return {
    present: true,
    value: channel,
    invalid,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const routeParams = await params;
  const appId = routeParams.appId;

  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const channelFilter = resolveChannelFilter(request);
  if (channelFilter.invalid) {
    return NextResponse.json({ error: 'Invalid channel filter' }, { status: 400 });
  }

  const searchParams = request.nextUrl.searchParams;
  const limit = Math.min(parseNonNegativeInteger(searchParams.get('limit'), 100), 200);
  const offset = parseNonNegativeInteger(searchParams.get('offset'), 0);

  try {
    return NextResponse.json(
      await listReleases({
        organizationId: access.access.organizationId,
        appId,
        channelPresent: channelFilter.present,
        channel: channelFilter.value,
        limit,
        offset,
      }),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const routeParams = await params;
  const appId = routeParams.appId;

  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawBundleId = body.bundleId;
  if (typeof rawBundleId !== 'string' || rawBundleId.trim().length === 0) {
    return NextResponse.json({ error: 'Missing bundleId' }, { status: 400 });
  }
  const bundleId = rawBundleId.trim();

  const rawChannel = body.channel;
  if (rawChannel !== undefined && rawChannel !== null && typeof rawChannel !== 'string') {
    return NextResponse.json({ error: 'Invalid channel' }, { status: 400 });
  }

  const channel = normalizeOptionalChannel(rawChannel);
  if (
    typeof rawChannel === 'string' &&
    rawChannel.trim().length > 0 &&
    (!channel || !isValidChannelName(channel))
  ) {
    return NextResponse.json({ error: 'Invalid channel' }, { status: 400 });
  }

  const rawForceImmediate = body.forceImmediate;
  if (rawForceImmediate !== undefined && typeof rawForceImmediate !== 'boolean') {
    return NextResponse.json({ error: 'forceImmediate must be a boolean' }, { status: 400 });
  }
  const forceImmediate = rawForceImmediate === true;

  const rawAutoRevert = body.autoRevert;
  if (rawAutoRevert !== undefined && typeof rawAutoRevert !== 'boolean') {
    return NextResponse.json({ error: 'autoRevert must be a boolean' }, { status: 400 });
  }
  const autoRevert = rawAutoRevert === true;

  const rawAutoRevertRatePercent = body.autoRevertRatePercent;
  const rawAutoRevertMinSample = body.autoRevertMinSample;
  if (
    !autoRevert &&
    (rawAutoRevertRatePercent !== undefined || rawAutoRevertMinSample !== undefined)
  ) {
    return NextResponse.json(
      { error: 'autoRevert thresholds require autoRevert to be true' },
      { status: 400 },
    );
  }
  if (
    rawAutoRevertRatePercent !== undefined &&
    (typeof rawAutoRevertRatePercent !== 'number' ||
      !Number.isInteger(rawAutoRevertRatePercent) ||
      rawAutoRevertRatePercent < 1 ||
      rawAutoRevertRatePercent > 95)
  ) {
    return NextResponse.json(
      { error: 'autoRevertRatePercent must be an integer between 1 and 95' },
      { status: 400 },
    );
  }
  if (
    rawAutoRevertMinSample !== undefined &&
    (typeof rawAutoRevertMinSample !== 'number' ||
      !Number.isInteger(rawAutoRevertMinSample) ||
      rawAutoRevertMinSample < 10 ||
      rawAutoRevertMinSample > 100000)
  ) {
    return NextResponse.json(
      { error: 'autoRevertMinSample must be an integer between 10 and 100000' },
      { status: 400 },
    );
  }
  const autoRevertRatePercent =
    typeof rawAutoRevertRatePercent === 'number' ? rawAutoRevertRatePercent : undefined;
  const autoRevertMinSample =
    typeof rawAutoRevertMinSample === 'number' ? rawAutoRevertMinSample : undefined;

  const rawExpectedCurrentReleaseId = body.expectedCurrentReleaseId;
  if (
    rawExpectedCurrentReleaseId !== undefined &&
    rawExpectedCurrentReleaseId !== null &&
    (typeof rawExpectedCurrentReleaseId !== 'string' ||
      rawExpectedCurrentReleaseId.trim().length === 0)
  ) {
    return NextResponse.json(
      { error: 'expectedCurrentReleaseId must be a release ID or null' },
      { status: 400 },
    );
  }
  const expectedCurrentReleaseId =
    typeof rawExpectedCurrentReleaseId === 'string'
      ? rawExpectedCurrentReleaseId.trim()
      : rawExpectedCurrentReleaseId;

  const rawCompatibilityDecision = body.compatibilityDecision;
  if (
    rawCompatibilityDecision !== undefined &&
    rawCompatibilityDecision !== 'block' &&
    rawCompatibilityDecision !== 'proceed' &&
    rawCompatibilityDecision !== 'skip'
  ) {
    return NextResponse.json({ error: 'Invalid compatibilityDecision' }, { status: 400 });
  }

  const promotedBy = await resolveReleaseActor(access.access);
  try {
    const publish = isReleaseReliabilityEnabled() ? publishRelease : publishReleaseLegacy;
    const result = await publish({
      organizationId: access.access.organizationId,
      actor: await accessActor(access.access, promotedBy),
      appId,
      bundleId,
      channel,
      forceImmediate,
      autoRevert,
      autoRevertRatePercent,
      autoRevertMinSample,
      expectedCurrentReleaseId,
      idempotencyKey: request.headers.get('idempotency-key') ?? undefined,
      compatibilityDecision: rawCompatibilityDecision,
      enforceCompatibility: rawCompatibilityDecision !== undefined,
    });

    return NextResponse.json(result, {
      status: result.publicationStatus === 'published' ? 200 : 202,
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
