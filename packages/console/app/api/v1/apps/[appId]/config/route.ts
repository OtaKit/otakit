import { NextRequest, NextResponse } from 'next/server';

import { accessActor } from '@/lib/audit-log';
import { resolveOrganizationAccess } from '@/lib/organization-access';
import { serviceErrorResponse } from '@/lib/services/http';
import {
  deleteRemoteConfig,
  getRemoteConfig,
  parseConfigChannel,
  patchRemoteConfig,
  publishRemoteConfig,
} from '@/lib/services/remote-config';

export const runtime = 'nodejs';

type Params = { params: Promise<{ appId: string }> };

async function jsonObject(request: NextRequest): Promise<Record<string, unknown> | null> {
  const body: unknown = await request.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

/** A channel's config. `?channel=` names it; omitted or empty is the base channel. */
export async function GET(request: NextRequest, { params }: Params) {
  const { appId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  try {
    return NextResponse.json(
      await getRemoteConfig({
        organizationId: access.access.organizationId,
        appId,
        channel: parseConfigChannel(request.nextUrl.searchParams.get('channel')),
      }),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

/** Replace a channel's config: `{ channel?, values, expectedVersion, message? }`. */
export async function PUT(request: NextRequest, { params }: Params) {
  const { appId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const body = await jsonObject(request);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  try {
    return NextResponse.json(
      await publishRemoteConfig(
        {
          organizationId: access.access.organizationId,
          actor: await accessActor(access.access),
          appId,
        },
        {
          channel: body.channel,
          values: body.values,
          expectedVersion: body.expectedVersion,
          message: body.message,
        },
      ),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

/** Set and remove keys: `{ channel?, set?, unset?, expectedVersion, message? }`. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { appId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const body = await jsonObject(request);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  try {
    return NextResponse.json(
      await patchRemoteConfig(
        {
          organizationId: access.access.organizationId,
          actor: await accessActor(access.access),
          appId,
        },
        {
          channel: body.channel,
          set: body.set,
          unset: body.unset,
          expectedVersion: body.expectedVersion,
          message: body.message,
        },
      ),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

/**
 * Delete a channel's config: `?channel=&expectedVersion=`. Its devices then use
 * the base channel's config; deleting the base config leaves apps on their
 * code defaults.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { appId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const searchParams = request.nextUrl.searchParams;
  const expected = searchParams.get('expectedVersion');
  try {
    return NextResponse.json(
      await deleteRemoteConfig(
        {
          organizationId: access.access.organizationId,
          actor: await accessActor(access.access),
          appId,
        },
        {
          channel: searchParams.get('channel'),
          expectedVersion:
            expected !== null && /^\d+$/.test(expected) ? Number(expected) : expected,
          message: searchParams.get('message') ?? undefined,
        },
      ),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
