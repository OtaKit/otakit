import QRCode from 'qrcode';

import type { BundleDiff } from '@/lib/services/bundle-diff';
import { bundleWarnings, diffFileLists, downloadBytes } from '@/lib/bundle-diff';
import { activityWindow, buildEventActivity } from '@/lib/event-activity-core';
import { isEventActivityRange, isEventActivitySplit } from '@/lib/event-activity-types';

import { demoBundleFiles } from './files';
import { DEMO_APPS } from './scenario';
import { DemoAppWorld, DemoError, type DemoFilters } from './world';

/**
 * The console API for the dashboard demo, answered in the browser from the
 * simulated worlds. Paths, bodies and errors match the real routes the
 * dashboard calls; anything else reports that the demo does not offer it.
 */

export type DemoResponse = { status: number; body: unknown };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const TIMEFRAMES: Record<string, number> = {
  '1h': HOUR,
  '24h': DAY,
  '7d': 7 * DAY,
  '30d': 30 * DAY,
};
const PREVIEW_EXPIRY: Record<string, number> = {
  '1h': HOUR,
  '24h': DAY,
  '7d': 7 * DAY,
  '30d': 30 * DAY,
};
const ACTIONS = new Set(['downloaded', 'applied', 'download_error', 'check_error', 'rollback']);
const DEMO_URL_SCHEME = 'acmefit';

export class DemoConsole {
  readonly worlds: DemoAppWorld[];

  constructor(now: number) {
    this.worlds = DEMO_APPS.map((spec) => new DemoAppWorld(spec, now));
  }

  advanceTo(now: number) {
    for (const world of this.worlds) world.advanceTo(now);
  }

  async handle(method: string, url: URL, body: unknown, now: number): Promise<DemoResponse> {
    try {
      return await this.route(method, url, body, now);
    } catch (error) {
      if (error instanceof DemoError)
        return { status: error.status, body: { error: error.message } };
      throw error;
    }
  }

  private async route(method: string, url: URL, body: unknown, now: number): Promise<DemoResponse> {
    const path = url.pathname.replace(/\/+$/, '').split('/').slice(3); // after /api/v1
    const query = url.searchParams;
    const ok = (payload: unknown): DemoResponse => ({ status: 200, body: payload });

    if (path[0] === 'apps' && path.length === 1 && method === 'POST') {
      return {
        status: 403,
        body: { error: 'This is a demo, so it cannot connect apps. Start free to connect yours.' },
      };
    }
    if (path[0] !== 'apps' || !path[1]) return notInDemo();
    const world = this.worlds.find((item) => item.id === path[1]);
    if (!world) return { status: 404, body: { error: 'App not found' } };
    world.advanceTo(now);
    const rest = path.slice(2);
    const input = (body ?? {}) as Record<string, unknown>;

    // Bundles
    if (rest[0] === 'bundles' && rest[1] === 'summary' && method === 'GET') {
      return ok({ bundles: world.bundleSummaries() });
    }
    if (rest[0] === 'bundles' && rest[2] === 'diff' && method === 'GET') {
      return ok(bundleDiff(world, rest[1], query));
    }
    if (rest[0] === 'bundles' && rest[2] === 'previews' && method === 'POST') {
      const expiresIn = typeof input.expiresIn === 'string' ? input.expiresIn : '7d';
      const token = world.previewToken();
      const pageUrl = `${url.origin}/p/${token}`;
      return {
        status: 201,
        body: {
          preview: world.createPreview(now, rest[1], PREVIEW_EXPIRY[expiresIn] ?? 7 * DAY, {
            token,
            url: pageUrl,
            qrUrl: await QRCode.toDataURL(pageUrl, { margin: 1, width: 320 }),
            deepLink: `${DEMO_URL_SCHEME}://otakit-preview?token=${token}`,
          }),
        },
      };
    }

    // Previews
    if (rest[0] === 'previews' && rest.length === 1 && method === 'GET') {
      return ok({
        previews: world.listPreviews(now, query.get('bundleId')),
        urlScheme: DEMO_URL_SCHEME,
      });
    }
    if (rest[0] === 'previews' && rest[1] && method === 'DELETE') {
      world.revokePreview(now, rest[1]);
      return ok({ revoked: true });
    }

    // Releases
    if (rest[0] === 'releases' && rest.length === 1 && method === 'GET') {
      const limit = Math.max(1, Math.min(Number(query.get('limit') ?? 20) || 20, 100));
      const releases = world.releaseHistory(limit);
      return ok({ releases, total: world.releases.length });
    }
    if (rest[0] === 'releases' && rest.length === 1 && method === 'POST') {
      const release = world.release(now, {
        bundleId: String(input.bundleId ?? ''),
        channel: typeof input.channel === 'string' && input.channel ? input.channel : null,
        expectedCurrentReleaseId:
          typeof input.expectedCurrentReleaseId === 'string'
            ? input.expectedCurrentReleaseId
            : null,
        rolloutPercent: typeof input.rolloutPercent === 'number' ? input.rolloutPercent : 100,
        autoRevert: input.autoRevert
          ? {
              ratePercent: Number(input.autoRevertRatePercent ?? 20),
              minSample: Number(input.autoRevertMinSample ?? 50),
            }
          : null,
        forceImmediate: input.forceImmediate === true,
        replaceRollout: input.replaceRollout === true,
        notes: typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim() : null,
      });
      return {
        status: 201,
        body: { publicationStatus: 'published', releaseId: release.id },
      };
    }
    if (rest[0] === 'releases' && rest[2] === 'rollout' && method === 'PATCH') {
      world.changeRollout(now, rest[1], Number(input.percent), Number(input.expectedPercent));
      return ok({ publicationStatus: 'published' });
    }
    if (rest[0] === 'releases' && rest[2] === 'revert' && method === 'POST') {
      world.revert(now, rest[1]);
      return ok({ publicationStatus: 'published' });
    }
    if (rest[0] === 'releases' && rest[2] === 'notes' && method === 'PATCH') {
      const notes =
        typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim() : null;
      if (notes && notes.length > 2000) {
        return { status: 400, body: { error: 'Release notes are limited to 2,000 characters' } };
      }
      world.setNotes(rest[1], notes);
      return ok({ publicationStatus: 'published' });
    }

    // Events
    if (rest[0] === 'events' && rest.length === 1 && method === 'GET') {
      const filters = parseFilters(query);
      if (!filters) return { status: 400, body: { error: 'Invalid filter' } };
      const from = query.get('from')
        ? Date.parse(query.get('from')!)
        : now - (TIMEFRAMES[query.get('timeframe') ?? '24h'] ?? DAY);
      const to = query.get('to') ? Date.parse(query.get('to')!) : Infinity;
      const limit = Math.max(1, Math.min(Number(query.get('limit') ?? 50) || 50, 200));
      return ok({ events: world.listEvents(filters, from, to, limit), analyticsAvailable: true });
    }
    if (rest[0] === 'events' && rest[1] === 'timeseries' && method === 'GET') {
      const filters = parseFilters(query);
      const range = query.get('range') ?? '24h';
      const splitBy = query.get('splitBy') ?? 'action';
      if (!filters || !isEventActivityRange(range) || !isEventActivitySplit(splitBy)) {
        return { status: 400, body: { error: 'Invalid query' } };
      }
      const window = activityWindow(range, now, Number(query.get('tzOffset') ?? 0) || 0);
      return ok(
        buildEventActivity({
          range,
          splitBy,
          window,
          now,
          points: world.activityPoints(
            filters,
            window.from,
            window.to,
            window.bucketMs,
            window.shiftMs,
            splitBy,
          ),
          available: true,
          markers: world.activityMarkers(filters, window.from, window.to),
        }),
      );
    }

    return notInDemo();
  }
}

function notInDemo(): DemoResponse {
  return { status: 404, body: { error: 'This part of OtaKit is not in the demo' } };
}

/** The event list's filters, with the real route's meaning of "all" and "base". */
function parseFilters(query: URLSearchParams): DemoFilters | null {
  const platform = query.get('platform');
  const action = query.get('action');
  const bundle = query.get('bundle');
  const channel = query.get('channel');
  const runtime = query.get('runtime');
  if (platform && platform !== 'all' && platform !== 'ios' && platform !== 'android') return null;
  if (action && action !== 'all' && !ACTIONS.has(action)) return null;
  return {
    platform: platform === 'ios' || platform === 'android' ? platform : null,
    action: action && action !== 'all' ? (action as DemoFilters['action']) : null,
    bundleVersion: bundle && bundle !== 'all' ? bundle : null,
    channel: !channel || channel === 'all' ? undefined : channel === 'base' ? null : channel,
    runtimeVersion: !query.has('runtime') || runtime === 'all' ? undefined : runtime || null,
  };
}

/** What a bundle changes, from its simulated file list, like the bundle diff service. */
function bundleDiff(world: DemoAppWorld, bundleId: string, query: URLSearchParams): BundleDiff {
  const target = world.bundleRecord(bundleId);
  if (!target) throw new DemoError(404, 'Bundle not found');
  let base: typeof target | null = null;
  let baseSource: BundleDiff['baseSource'] = 'previous_upload';
  let baseChannel: string | null | undefined;
  if (query.has('against')) {
    base = world.bundleRecord(query.get('against')!) ?? null;
    if (!base) throw new DemoError(404, 'Bundle not found');
    baseSource = 'against';
  } else if (query.has('channel')) {
    baseChannel = query.get('channel') || null;
    const lane = world.laneBundles(baseChannel, target.runtimeVersion);
    if (!lane) throw new DemoError(404, 'Nothing is released on that channel for this runtime');
    // The bundle the channel runs is compared with the release it replaced.
    if (lane.bundle.id === target.id) {
      base = lane.replaced;
      baseSource = 'channel_previous';
    } else {
      base = lane.bundle;
      baseSource = 'channel';
    }
  } else {
    base = world.previousUpload(target);
  }

  const describe = (bundle: typeof target) => ({
    id: bundle.id,
    version: bundle.version,
    runtimeVersion: bundle.runtimeVersion,
    strategy: 'deltas',
    size: bundle.size,
    encrypted: false,
    createdAt: new Date(bundle.createdAt).toISOString(),
  });
  const targetList = demoBundleFiles(world.slug, target.version);
  const baseList = base ? demoBundleFiles(world.slug, base.version) : null;
  const diff = diffFileLists(baseList, targetList);
  return {
    target: describe(target),
    base: base ? describe(base) : null,
    baseSource,
    ...(baseChannel !== undefined ? { baseChannel } : {}),
    status: 'ok',
    unavailableReason: null,
    comparable: diff.comparable,
    summary: {
      added: diff.added,
      removed: diff.removed,
      changed: diff.changed,
      unchanged: diff.unchanged,
      totalBefore: diff.totalBefore,
      totalAfter: diff.totalAfter,
      downloadBytes: downloadBytes(base ? { strategy: 'deltas', list: baseList } : null, {
        strategy: 'deltas',
        size: target.size,
        list: targetList,
      }),
    },
    changes: diff.changes,
    unlistedChanges: 0,
    warnings: bundleWarnings(targetList, diff),
  };
}
