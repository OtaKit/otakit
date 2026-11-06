import type {
  BundleSummaryItem,
  DeviceEvent,
  EventCountSummary,
  PreviewSummary,
  ReleaseHistoryItem,
} from '@/app/components/dashboard-types';
import {
  buildActivityMarkers,
  type ActivityPoint,
  type MarkerRelease,
} from '@/lib/event-activity-core';
import type { EventActivityMarker, EventActivitySplit } from '@/lib/event-activity-types';
import { AUTO_REVERT_REVERTED_BY, ROLLOUT_REPLACED_BY } from '@/lib/release-actors';

import {
  ACTION_INDEX,
  EVENT_ACTIONS,
  EVENT_PLATFORMS,
  EventStore,
  type PendingEvent,
} from './event-store';
import { binomial, hexId, poisson, seededRandom, type Random } from './random';
import { DEMO_USER, type DemoAppSpec } from './scenario';

/**
 * One demo app: a fleet of simulated devices, its bundles and releases, and the
 * device events they produce. Devices open the app on a daily rhythm; a device
 * that should run a newer bundle downloads it, applies it on a later launch, and
 * sometimes fails or rolls back. History and the live part run the same model.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const DEMO_HISTORY_MS = 31 * DAY;
const HISTORY_STEP_MS = 5 * MINUTE;
/** A hidden tab catches up in steps no longer than this. */
const CATCH_UP_STEP_MS = 5 * MINUTE;

/** Each device opens the app about 1.3 times a day; it checks for updates on every open. */
const OPENS_PER_DEVICE_HOUR = 0.055;
const NEW_INSTALLS_PER_DEVICE_HOUR = 0.0004;
const DOWNLOAD_ERROR_RATE = 0.012;
const CHECK_ERROR_RATE = 0.0011;
/** Rollbacks of a healthy bundle: the app closed during its first launch. */
const BASELINE_ROLLBACK_RATE = 0.004;
/** A downloaded bundle applies on a launch that usually follows soon. */
const APPLY_BOOST = 5;
const FORCE_IMMEDIATE_BOOST = 12;
/** Lanes changed in the demo update this much faster, so visitors see a release land. */
export const DEMO_SPEEDUP = 60;
const AUTO_REVERT_WINDOW_MS = DAY;

const DETAILS: Partial<Record<number, string[]>> = {
  [ACTION_INDEX.download_error]: [
    'Download timed out after 30 s',
    'HTTP 503 from the CDN',
    'Connection lost during the download',
    'Checksum mismatch; the download was discarded',
  ],
  [ACTION_INDEX.check_error]: [
    'Update check failed: offline',
    'Update check timed out',
    'HTTP 502 from the manifest',
  ],
  [ACTION_INDEX.rollback]: [
    'notifyAppReady() was not called within 10 s',
    'The app crashed during its first launch',
  ],
};

export type DemoFilters = {
  platform: 'ios' | 'android' | null;
  action: DeviceEvent['action'] | null;
  bundleVersion: string | null;
  /** undefined: any; null: the base channel. */
  channel: string | null | undefined;
  /** undefined: any; null: none. */
  runtimeVersion: string | null | undefined;
};

/** A change visitors made, or that auto-revert made, after the demo opened. */
export type DemoChange = {
  type: 'released' | 'rollout' | 'reverted' | 'auto_reverted';
  appId: string;
  bundleVersion: string;
  channel: string | null;
  rolloutPercent: number;
  /** Rollback share that triggered an auto-revert. */
  rollbackSharePercent?: number;
};

type Lane = {
  index: number;
  channel: string | null;
  runtimeVersion: string;
  devices: number;
  iosShare: number;
  /** Devices running each bundle. */
  counts: Map<number, number>;
  /** Devices that downloaded a bundle and apply it on a later launch, by "from>to". */
  pending: Map<string, { from: number; to: number; count: number }>;
  /** Devices that rolled back from a bundle and stay on their previous one. */
  rejected: Map<number, number>;
  /**
   * Bundles a change made in the demo sends devices to (a release, or the
   * bundle a revert returns to): moves to them run DEMO_SPEEDUP times faster.
   * Other moves keep their real pace, so a 10% rollout does not also rush the
   * stragglers of the previous release.
   */
  fast: Set<number>;
  /** Release indexes, oldest first. */
  releases: number[];
};

type Bundle = {
  index: number;
  id: string;
  version: string;
  runtimeVersion: string;
  createdAt: number;
  size: number;
  rollbackRate: number;
  counts: EventCountSummary;
};

type Release = {
  index: number;
  id: string;
  bundle: number;
  lane: number;
  previousBundle: number | null;
  promotedAt: number;
  promotedBy: string;
  rolloutPercent: number;
  revertedAt: number | null;
  revertedBy: string | null;
  forceImmediate: boolean;
  autoRevert: boolean;
  autoRevertRatePercent: number;
  autoRevertMinSample: number;
  notes: string | null;
  counts: EventCountSummary;
  /** Applies and rollbacks per simulated step, for auto-revert. */
  health: Array<{ time: number; applied: number; rollbacks: number }>;
};

type RolloutStep = { at: number; release: number; fromPercent: number; toPercent: number };

type Preview = PreviewSummary & { revokedAt: number | null };

export class DemoError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function previewSummary(preview: Preview): PreviewSummary {
  return {
    id: preview.id,
    bundleId: preview.bundleId,
    bundleVersion: preview.bundleVersion,
    runtimeVersion: preview.runtimeVersion,
    createdAt: preview.createdAt,
    createdBy: preview.createdBy,
    expiresAt: preview.expiresAt,
    url: preview.url,
    qrUrl: preview.qrUrl,
    deepLink: preview.deepLink,
  };
}

function emptyCounts(): EventCountSummary {
  return { downloads: 0, applied: 0, downloadErrors: 0, rollbacks: 0 };
}

function uuid(random: Random): string {
  const hex = hexId(random, 32);
  const variant = '89ab'[Math.floor(random() * 4)];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** App opens through the day on the viewer's clock, averaging 1. */
function diurnal(time: number): number {
  const date = new Date(time);
  const hour = date.getHours() + date.getMinutes() / 60;
  // Quiet at night, a lunch bump and an evening peak.
  const day = 0.35 + 0.65 * Math.max(0, Math.sin(((hour - 6) / 18) * Math.PI));
  const evening = 0.55 * Math.exp(-((hour - 20.5) ** 2) / 4);
  return (day + evening) / 0.79;
}

/**
 * Splits `count` items across weights with sequential binomial draws, never
 * giving an item more than its weight: weights are devices that can move.
 */
function splitByWeights(random: Random, count: number, weights: number[]): number[] {
  const out = weights.map(() => 0);
  let remaining = count;
  let weightLeft = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  for (let i = 0; i < weights.length && remaining > 0; i += 1) {
    if (weights[i] <= 0) continue;
    const share =
      weightLeft <= weights[i] ? remaining : binomial(random, remaining, weights[i] / weightLeft);
    const take = Math.min(share, weights[i], remaining);
    out[i] = take;
    remaining -= take;
    weightLeft -= weights[i];
  }
  return out;
}

export class DemoAppWorld {
  readonly id: string;
  readonly slug: string;
  readonly createdAt: number;
  readonly events = new EventStore();
  readonly lanes: Lane[] = [];
  readonly bundles: Bundle[] = [];
  readonly releases: Release[] = [];
  readonly steps: RolloutStep[] = [];
  private previews: Preview[] = [];
  private readonly random: Random;
  /** Simulated up to this time. */
  private time: number;
  private readonly listeners = new Set<(change: DemoChange) => void>();
  private live = false;

  constructor(spec: DemoAppSpec, now: number) {
    this.id = spec.id;
    this.slug = spec.slug;
    this.createdAt = now - spec.createdAgo;
    this.random = seededRandom(spec.seed);

    for (const bundle of spec.bundles) {
      this.bundles.push({
        index: this.bundles.length,
        id: uuid(this.random),
        version: bundle.version,
        runtimeVersion: bundle.runtimeVersion,
        createdAt: now - bundle.uploadedAgo,
        size: bundle.size,
        rollbackRate: bundle.rollbackRate ?? BASELINE_ROLLBACK_RATE,
        counts: emptyCounts(),
      });
    }
    for (const lane of spec.lanes) this.laneFor(lane.channel, lane.runtimeVersion, lane);

    const start = now - DEMO_HISTORY_MS;
    this.time = start;
    // Releases before the history: devices already run the newest one per lane.
    type Action = { at: number; run: () => void };
    const actions: Action[] = [];
    for (const release of spec.releases) {
      const bundle = this.bundleByVersion(release.version);
      if (!bundle) throw new Error(`Unknown demo bundle ${release.version}`);
      const at = now - release.ago;
      const create = () =>
        this.createRelease({
          bundle: bundle.index,
          channel: release.channel,
          at,
          by: release.by,
          rolloutPercent: release.rolloutPercent ?? 100,
          autoRevert: release.autoRevert ?? null,
          forceImmediate: release.forceImmediate ?? false,
          notes: release.notes ?? null,
          replaceRollout: false,
        });
      if (at < start) {
        const created = create();
        this.lanes[created.lane].counts = new Map([
          [created.bundle, this.lanes[created.lane].devices],
        ]);
      } else {
        actions.push({ at, run: create });
      }
      for (const step of release.steps ?? []) {
        actions.push({
          at: now - step.ago,
          run: () => {
            const created = this.releases.findLast(
              (item) => item.bundle === bundle.index && item.lane === this.laneIndex(release),
            );
            if (created && !created.revertedAt)
              this.setRollout(created, step.percent, now - step.ago);
          },
        });
      }
    }
    actions.sort((left, right) => left.at - right.at);

    let next = 0;
    for (let t = start; t < now; t += HISTORY_STEP_MS) {
      const end = Math.min(t + HISTORY_STEP_MS, now);
      while (next < actions.length && actions[next].at < end) {
        actions[next].run();
        next += 1;
      }
      this.simulate(t, end - t);
    }
    while (next < actions.length) actions[next++].run();
    this.time = now;
    this.live = true;
  }

  // ── Structure ─────────────────────────────────────────────────────

  private laneIndex(release: { channel: string | null; version: string }): number {
    const bundle = this.bundleByVersion(release.version)!;
    return this.laneFor(release.channel, bundle.runtimeVersion).index;
  }

  private laneFor(
    channel: string | null,
    runtimeVersion: string,
    spec?: { devices: number; iosShare: number },
  ): Lane {
    const existing = this.lanes.find(
      (lane) => lane.channel === channel && lane.runtimeVersion === runtimeVersion,
    );
    if (existing) return existing;
    const lane: Lane = {
      index: this.lanes.length,
      channel,
      runtimeVersion,
      // A channel created in the demo has no devices yet, as in real life.
      devices: spec?.devices ?? 0,
      iosShare: spec?.iosShare ?? 0.5,
      counts: new Map(),
      pending: new Map(),
      rejected: new Map(),
      fast: new Set(),
      releases: [],
    };
    this.lanes.push(lane);
    return lane;
  }

  bundleByVersion(version: string): Bundle | undefined {
    return this.bundles.find((bundle) => bundle.version === version);
  }

  private bundleById(id: string): Bundle | undefined {
    return this.bundles.find((bundle) => bundle.id === id);
  }

  private currentRelease(lane: Lane): Release | null {
    for (let i = lane.releases.length - 1; i >= 0; i -= 1) {
      const release = this.releases[lane.releases[i]];
      if (release.revertedAt === null) return release;
    }
    return null;
  }

  /** The release that delivered `bundle` on `lane`, for event attribution. */
  private releaseOf(lane: Lane, bundle: number): number {
    for (let i = lane.releases.length - 1; i >= 0; i -= 1) {
      const release = this.releases[lane.releases[i]];
      if (release.bundle === bundle) return release.index;
    }
    return -1;
  }

  subscribe(listener: (change: DemoChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(type: DemoChange['type'], release: Release, extra?: Partial<DemoChange>) {
    if (!this.live) return;
    const change: DemoChange = {
      type,
      appId: this.id,
      bundleVersion: this.bundles[release.bundle].version,
      channel: this.lanes[release.lane].channel,
      rolloutPercent: release.rolloutPercent,
      ...extra,
    };
    for (const listener of this.listeners) listener(change);
  }

  // ── Simulation ────────────────────────────────────────────────────

  /** Runs the fleet up to `now`; cheap when little time passed. */
  advanceTo(now: number) {
    while (this.time < now) {
      const end = Math.min(now, this.time + CATCH_UP_STEP_MS);
      this.simulate(this.time, end - this.time);
      this.time = end;
    }
  }

  private simulate(start: number, duration: number) {
    if (duration <= 0) return;
    const random = this.random;
    const batch: PendingEvent[] = [];
    const opensPerDevice = (OPENS_PER_DEVICE_HOUR * diurnal(start) * duration) / HOUR;

    const push = (lane: Lane, action: number, bundle: number, release: number) => {
      const detailOptions = DETAILS[action];
      batch.push({
        time: start + random() * duration,
        action,
        bundle,
        lane: lane.index,
        platform: random() < lane.iosShare ? 0 : 1,
        release,
        detail: detailOptions ? Math.floor(random() * detailOptions.length) : 0,
      });
      const counts = this.bundles[bundle].counts;
      const releaseCounts = release >= 0 ? this.releases[release].counts : null;
      for (const target of releaseCounts ? [counts, releaseCounts] : [counts]) {
        if (action === ACTION_INDEX.downloaded) target.downloads += 1;
        else if (action === ACTION_INDEX.applied) target.applied += 1;
        else if (action === ACTION_INDEX.download_error) target.downloadErrors += 1;
        else if (action === ACTION_INDEX.rollback) target.rollbacks += 1;
      }
    };

    for (const lane of this.lanes) {
      if (lane.devices === 0) continue;
      const current = this.currentRelease(lane);
      if (!current) continue;
      const speedTo = (bundle: number) => (lane.fast.has(bundle) ? DEMO_SPEEDUP : 1);

      // What devices should run: the current release, or during a rollout its
      // share of devices with the stable release for the rest.
      const rolling = current.rolloutPercent < 100 && current.previousBundle !== null;
      const desired = new Map<number, number>();
      const rolloutDevices = rolling
        ? Math.round((lane.devices * current.rolloutPercent) / 100)
        : lane.devices;
      desired.set(current.bundle, rolloutDevices);
      if (rolling) desired.set(current.previousBundle!, lane.devices - rolloutDevices);

      // A staged download of a bundle the lane no longer wants is dropped.
      for (const [key, pool] of lane.pending) if (!desired.has(pool.to)) lane.pending.delete(key);
      const pendingTo = new Map<number, number>();
      const pendingFrom = new Map<number, number>();
      for (const pool of lane.pending.values()) {
        pendingTo.set(pool.to, (pendingTo.get(pool.to) ?? 0) + pool.count);
        pendingFrom.set(pool.from, (pendingFrom.get(pool.from) ?? 0) + pool.count);
      }

      // Devices that can move: those on a bundle beyond what is wanted of it.
      const sources: number[] = [];
      const surplus: number[] = [];
      for (const [bundle, count] of lane.counts) {
        const free = count - (desired.get(bundle) ?? 0) - (pendingFrom.get(bundle) ?? 0);
        if (free > 0) {
          sources.push(bundle);
          surplus.push(free);
        }
      }

      // Downloads: devices that open the app and find a bundle they lack.
      for (const [bundle, wanted] of desired) {
        const have = (lane.counts.get(bundle) ?? 0) + (pendingTo.get(bundle) ?? 0);
        const deficit = Math.min(
          wanted - have - (lane.rejected.get(bundle) ?? 0),
          surplus.reduce((sum, value) => sum + value, 0),
        );
        if (deficit <= 0) continue;
        const attempts = binomial(random, deficit, 1 - Math.exp(-opensPerDevice * speedTo(bundle)));
        if (attempts === 0) continue;
        const release = this.releaseOf(lane, bundle);
        const bySource = splitByWeights(random, attempts, surplus);
        bySource.forEach((count, i) => {
          if (count === 0) return;
          surplus[i] -= count;
          const errors = binomial(random, count, DOWNLOAD_ERROR_RATE);
          for (let k = 0; k < errors; k += 1)
            push(lane, ACTION_INDEX.download_error, bundle, release);
          const downloaded = count - errors;
          for (let k = 0; k < downloaded; k += 1)
            push(lane, ACTION_INDEX.downloaded, bundle, release);
          const key = `${sources[i]}>${bundle}`;
          const pool = lane.pending.get(key) ?? { from: sources[i], to: bundle, count: 0 };
          pool.count += downloaded;
          lane.pending.set(key, pool);
        });
      }

      // Applies on a later launch; a bundle with a bug rolls back.
      for (const [key, pool] of lane.pending) {
        const release = this.releaseOf(lane, pool.to);
        const boost =
          release >= 0 && this.releases[release].forceImmediate
            ? FORCE_IMMEDIATE_BOOST
            : APPLY_BOOST;
        const applies = binomial(
          random,
          pool.count,
          1 - Math.exp(-opensPerDevice * speedTo(pool.to) * boost),
        );
        if (applies === 0) continue;
        const rollbacks = binomial(random, applies, this.bundles[pool.to].rollbackRate);
        for (let k = 0; k < applies; k += 1) push(lane, ACTION_INDEX.applied, pool.to, release);
        for (let k = 0; k < rollbacks; k += 1) push(lane, ACTION_INDEX.rollback, pool.to, release);
        pool.count -= applies;
        if (pool.count <= 0) lane.pending.delete(key);
        const moved = applies - rollbacks;
        lane.counts.set(pool.from, (lane.counts.get(pool.from) ?? 0) - moved);
        lane.counts.set(pool.to, (lane.counts.get(pool.to) ?? 0) + moved);
        if (rollbacks > 0)
          lane.rejected.set(pool.to, (lane.rejected.get(pool.to) ?? 0) + rollbacks);
        if (release >= 0) {
          this.releases[release].health.push({
            time: start + duration,
            applied: applies,
            rollbacks,
          });
        }
      }

      // New installs start on the store build and update right away.
      const installs = poisson(
        random,
        (lane.devices * NEW_INSTALLS_PER_DEVICE_HOUR * diurnal(start) * duration) / HOUR,
      );
      for (let k = 0; k < installs; k += 1) {
        const bundle =
          rolling && random() * lane.devices >= rolloutDevices
            ? current.previousBundle!
            : current.bundle;
        const release = this.releaseOf(lane, bundle);
        push(lane, ACTION_INDEX.downloaded, bundle, release);
        push(lane, ACTION_INDEX.applied, bundle, release);
      }

      // Update checks that fail: offline, timeouts.
      const checkErrors = binomial(
        random,
        poisson(random, lane.devices * opensPerDevice),
        CHECK_ERROR_RATE,
      );
      if (checkErrors > 0) {
        const bundles = [...lane.counts.keys()];
        const split = splitByWeights(
          random,
          checkErrors,
          bundles.map((bundle) => Math.max(0, lane.counts.get(bundle) ?? 0)),
        );
        split.forEach((count, i) => {
          const release = this.releaseOf(lane, bundles[i]);
          for (let k = 0; k < count; k += 1)
            push(lane, ACTION_INDEX.check_error, bundles[i], release);
        });
      }
    }

    this.events.append(batch);
    this.checkAutoReverts(start + duration);
  }

  private checkAutoReverts(now: number) {
    for (const lane of this.lanes) {
      const release = this.currentRelease(lane);
      if (!release?.autoRevert) continue;
      let applied = 0;
      let rollbacks = 0;
      for (const entry of release.health) {
        if (entry.time <= now - AUTO_REVERT_WINDOW_MS) continue;
        applied += entry.applied;
        rollbacks += entry.rollbacks;
      }
      const attempts = applied + rollbacks;
      if (attempts < release.autoRevertMinSample) continue;
      const share = (rollbacks / attempts) * 100;
      if (share < release.autoRevertRatePercent) continue;
      release.revertedAt = now;
      release.revertedBy = AUTO_REVERT_REVERTED_BY;
      if (this.live) this.speedUpReturn(lane);
      this.emit('auto_reverted', release, {
        rollbackSharePercent: Math.round(share * 10) / 10,
      });
    }
  }

  // ── Changes ───────────────────────────────────────────────────────

  private createRelease(input: {
    bundle: number;
    channel: string | null;
    at: number;
    by: string;
    rolloutPercent: number;
    autoRevert: { ratePercent: number; minSample: number } | null;
    forceImmediate: boolean;
    notes: string | null;
    replaceRollout: boolean;
  }): Release {
    const bundle = this.bundles[input.bundle];
    const lane = this.laneFor(input.channel, bundle.runtimeVersion);
    const current = this.currentRelease(lane);
    let previousBundle =
      current === null
        ? null
        : current.rolloutPercent < 100 && current.previousBundle !== null
          ? current.previousBundle
          : current.bundle;
    if (current && current.rolloutPercent < 100 && input.replaceRollout) {
      current.revertedAt = input.at;
      current.revertedBy = ROLLOUT_REPLACED_BY;
      previousBundle = current.previousBundle;
    }
    const release: Release = {
      index: this.releases.length,
      id: uuid(this.random),
      bundle: bundle.index,
      lane: lane.index,
      previousBundle,
      promotedAt: input.at,
      promotedBy: input.by,
      rolloutPercent: input.rolloutPercent,
      revertedAt: null,
      revertedBy: null,
      forceImmediate: input.forceImmediate,
      autoRevert: input.autoRevert !== null,
      autoRevertRatePercent: input.autoRevert?.ratePercent ?? 20,
      autoRevertMinSample: input.autoRevert?.minSample ?? 50,
      notes: input.notes,
      counts: emptyCounts(),
      health: [],
    };
    this.releases.push(release);
    lane.releases.push(release.index);
    return release;
  }

  /** After a revert in the demo, devices return to the lane's current bundle quickly. */
  private speedUpReturn(lane: Lane) {
    const current = this.currentRelease(lane);
    if (current) lane.fast.add(current.bundle);
  }

  private setRollout(release: Release, percent: number, at: number) {
    this.steps.push({
      at,
      release: release.index,
      fromPercent: release.rolloutPercent,
      toPercent: percent,
    });
    release.rolloutPercent = percent;
  }

  /** Mirrors the release service's rules and messages. */
  release(
    now: number,
    input: {
      bundleId: string;
      channel: string | null;
      expectedCurrentReleaseId: string | null;
      rolloutPercent: number;
      autoRevert: { ratePercent: number; minSample: number } | null;
      forceImmediate: boolean;
      replaceRollout: boolean;
      notes: string | null;
    },
  ): Release {
    this.advanceTo(now);
    const bundle = this.bundleById(input.bundleId);
    if (!bundle) throw new DemoError(404, 'Bundle not found');
    const lane = this.laneFor(input.channel, bundle.runtimeVersion);
    const current = this.currentRelease(lane);
    if ((current?.id ?? null) !== input.expectedCurrentReleaseId) {
      throw new DemoError(409, 'The current release changed after it was reviewed');
    }
    if (current?.bundle === bundle.index) {
      throw new DemoError(409, 'Bundle is already current for this release lane');
    }
    if (current && current.rolloutPercent < 100) {
      if (!input.replaceRollout) {
        throw new DemoError(
          409,
          `Release ${this.bundles[current.bundle].version} is rolling out to ${current.rolloutPercent}% of this lane`,
        );
      }
      if (current.previousBundle === bundle.index) {
        throw new DemoError(409, 'Bundle is already the stable release of this lane');
      }
    }
    if (!current && input.rolloutPercent < 100) {
      throw new DemoError(409, 'The first release on a lane goes to every device');
    }
    const release = this.createRelease({
      bundle: bundle.index,
      channel: input.channel,
      at: now,
      by: DEMO_USER.email,
      rolloutPercent: input.rolloutPercent,
      autoRevert: input.autoRevert,
      forceImmediate: input.forceImmediate,
      notes: input.notes,
      replaceRollout: input.replaceRollout,
    });
    lane.fast.add(release.bundle);
    this.emit('released', release);
    return release;
  }

  changeRollout(now: number, releaseId: string, percent: number, expectedPercent: number) {
    this.advanceTo(now);
    const release = this.releaseById(releaseId);
    const current = this.currentRelease(this.lanes[release.lane]);
    if (current?.id !== release.id || release.rolloutPercent === 100) {
      throw new DemoError(
        409,
        release.revertedAt
          ? 'Release is already reverted'
          : current?.id === release.id
            ? 'This release already reaches every device'
            : 'Release is no longer current on this lane',
      );
    }
    if (release.rolloutPercent !== expectedPercent) {
      throw new DemoError(
        409,
        `The rollout is at ${release.rolloutPercent}%, not ${expectedPercent}%`,
      );
    }
    if (release.rolloutPercent === percent) {
      throw new DemoError(409, `The rollout is already at ${percent}%`);
    }
    this.setRollout(release, percent, now);
    this.lanes[release.lane].fast.add(release.bundle);
    this.emit('rollout', release);
  }

  revert(now: number, releaseId: string) {
    this.advanceTo(now);
    const release = this.releaseById(releaseId);
    if (release.revertedAt !== null) throw new DemoError(409, 'Release is already reverted');
    if (this.currentRelease(this.lanes[release.lane])?.id !== release.id) {
      throw new DemoError(409, 'Release is no longer current on this lane');
    }
    release.revertedAt = now;
    release.revertedBy = DEMO_USER.email;
    this.speedUpReturn(this.lanes[release.lane]);
    this.emit('reverted', release);
  }

  setNotes(releaseId: string, notes: string | null) {
    this.releaseById(releaseId).notes = notes;
  }

  private releaseById(id: string): Release {
    const release = this.releases.find((item) => item.id === id);
    if (!release) throw new DemoError(404, 'Release not found');
    return release;
  }

  // ── Previews ──────────────────────────────────────────────────────

  listPreviews(now: number, bundleId: string | null): PreviewSummary[] {
    return this.previews
      .filter(
        (preview) =>
          preview.revokedAt === null &&
          Date.parse(preview.expiresAt) > now &&
          (!bundleId || preview.bundleId === bundleId),
      )
      .map(previewSummary);
  }

  createPreview(
    now: number,
    bundleId: string,
    expiresInMs: number,
    page: { url: string; qrUrl: string; deepLink: string | null; token: string },
  ): PreviewSummary {
    const bundle = this.bundleById(bundleId);
    if (!bundle) throw new DemoError(404, 'Bundle not found');
    const preview: Preview = {
      id: uuid(this.random),
      bundleId: bundle.id,
      bundleVersion: bundle.version,
      runtimeVersion: bundle.runtimeVersion,
      createdAt: new Date(now).toISOString(),
      createdBy: DEMO_USER.email,
      expiresAt: new Date(now + expiresInMs).toISOString(),
      url: page.url,
      qrUrl: page.qrUrl,
      deepLink: page.deepLink,
      revokedAt: null,
    };
    this.previews.push(preview);
    return previewSummary(preview);
  }

  revokePreview(now: number, previewId: string) {
    const preview = this.previews.find((item) => item.id === previewId);
    if (!preview || preview.revokedAt !== null) throw new DemoError(404, 'Preview link not found');
    preview.revokedAt = now;
  }

  previewToken(): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
    let token = '';
    for (let i = 0; i < 26; i += 1) token += alphabet[Math.floor(this.random() * alphabet.length)];
    return token;
  }

  // ── Reads ─────────────────────────────────────────────────────────

  bundleSummaries(): BundleSummaryItem[] {
    const deployed = new Map<number, Map<number, number>>();
    const current = new Map<number, Set<number>>();
    for (const lane of this.lanes) {
      // Newest first: the current release is live, and during a rollout the
      // stable release below it stays live for the remaining devices.
      const live: Release[] = [];
      for (let i = lane.releases.length - 1; i >= 0; i -= 1) {
        const release = this.releases[lane.releases[i]];
        const byLane = deployed.get(release.bundle) ?? new Map<number, number>();
        byLane.set(lane.index, Math.max(byLane.get(lane.index) ?? 0, release.promotedAt));
        deployed.set(release.bundle, byLane);
        if (
          release.revertedAt === null &&
          (live.length === 0 || (live.length === 1 && live[0].rolloutPercent < 100))
        ) {
          live.push(release);
          const lanes = current.get(release.bundle) ?? new Set<number>();
          lanes.add(lane.index);
          current.set(release.bundle, lanes);
        }
      }
    }
    const target = (lane: Lane) => ({ channel: lane.channel, runtimeVersion: lane.runtimeVersion });
    const byTarget = (
      left: { channel: string | null; runtimeVersion: string | null },
      right: { channel: string | null; runtimeVersion: string | null },
    ) =>
      (left.channel ?? '').localeCompare(right.channel ?? '') ||
      (left.runtimeVersion ?? '').localeCompare(right.runtimeVersion ?? '');
    return [...this.bundles]
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((bundle) => {
        const currentLanes = [...(current.get(bundle.index) ?? [])].map((i) => this.lanes[i]);
        return {
          version: bundle.version,
          id: bundle.id,
          size: bundle.size,
          createdAt: new Date(bundle.createdAt).toISOString(),
          runtimeVersion: bundle.runtimeVersion,
          isLive: currentLanes.some((lane) => lane.channel === null),
          currentTargets: currentLanes.map(target).sort(byTarget),
          deployedTargets: [...(deployed.get(bundle.index) ?? new Map<number, number>())]
            .map(([laneIndex, at]) => ({
              ...target(this.lanes[laneIndex]),
              deployedAt: new Date(at).toISOString(),
            }))
            .sort(byTarget),
          eventCounts: { ...bundle.counts },
        };
      });
  }

  releaseHistory(limit: number): ReleaseHistoryItem[] {
    return [...this.releases]
      .sort((left, right) => right.promotedAt - left.promotedAt || right.index - left.index)
      .slice(0, limit)
      .map((release) => {
        const bundle = this.bundles[release.bundle];
        const previous =
          release.previousBundle === null ? null : this.bundles[release.previousBundle];
        return {
          id: release.id,
          channel: this.lanes[release.lane].channel,
          runtimeVersion: bundle.runtimeVersion,
          bundleId: bundle.id,
          bundleVersion: bundle.version,
          previousBundleId: previous?.id ?? null,
          previousBundleVersion: previous?.version ?? null,
          forceImmediate: release.forceImmediate,
          autoRevert: release.autoRevert,
          autoRevertRatePercent: release.autoRevertRatePercent,
          autoRevertMinSample: release.autoRevertMinSample,
          rolloutPercent: release.rolloutPercent,
          notes: release.notes,
          promotedAt: new Date(release.promotedAt).toISOString(),
          promotedBy: release.promotedBy,
          revertedAt:
            release.revertedAt === null ? null : new Date(release.revertedAt).toISOString(),
          revertedBy: release.revertedBy,
          eventCounts: { ...release.counts },
        };
      });
  }

  /** Which stored events a filter keeps, as per-column lookups. */
  private matcher(filters: DemoFilters) {
    const lanes = new Uint8Array(Math.max(1, this.lanes.length));
    for (const lane of this.lanes) {
      const channelOk = filters.channel === undefined || lane.channel === filters.channel;
      const runtimeOk =
        filters.runtimeVersion === undefined || lane.runtimeVersion === filters.runtimeVersion;
      lanes[lane.index] = channelOk && runtimeOk ? 1 : 0;
    }
    const bundle = filters.bundleVersion
      ? (this.bundleByVersion(filters.bundleVersion)?.index ?? -2)
      : -1;
    const action = filters.action ? ACTION_INDEX[filters.action] : -1;
    const platform = filters.platform ? EVENT_PLATFORMS.indexOf(filters.platform) : -1;
    const store = this.events;
    return (i: number) =>
      lanes[store.lane[i]] === 1 &&
      (bundle === -1 || store.bundle[i] === bundle) &&
      (action === -1 || store.action[i] === action) &&
      (platform === -1 || store.platform[i] === platform);
  }

  listEvents(filters: DemoFilters, from: number, to: number, limit: number): DeviceEvent[] {
    const store = this.events;
    const matches = this.matcher(filters);
    const out: DeviceEvent[] = [];
    const first = store.lowerBound(from);
    for (let i = store.lowerBound(to) - 1; i >= first && out.length < limit; i -= 1) {
      if (!matches(i)) continue;
      const lane = this.lanes[store.lane[i]];
      const action = EVENT_ACTIONS[store.action[i]];
      const release = store.release[i];
      out.push({
        id: `${this.id.slice(0, 8)}-${i}`,
        appId: this.id,
        action,
        platform: EVENT_PLATFORMS[store.platform[i]],
        bundleVersion: this.bundles[store.bundle[i]].version,
        channel: lane.channel,
        runtimeVersion: lane.runtimeVersion,
        releaseId: release >= 0 ? this.releases[release].id : null,
        detail: DETAILS[store.action[i]]?.[store.detail[i]] ?? null,
        createdAt: new Date(store.time[i]).toISOString(),
        nativeSdkVersion: lane.runtimeVersion === '4.0' ? '3.1.2' : '3.3.0',
        lifecycle: i % 5 === 0 ? 'background' : 'foreground',
      });
    }
    return out;
  }

  /** Event counts per bucket, action and split value: what the Tinybird endpoint returns. */
  activityPoints(
    filters: DemoFilters,
    from: number,
    to: number,
    bucketMs: number,
    shiftMs: number,
    splitBy: EventActivitySplit,
  ): ActivityPoint[] {
    const store = this.events;
    const matches = this.matcher(filters);
    // Segment of an event, as an index into `values`, by its bundle, lane or platform.
    const values: string[] = [];
    const indexOf = new Map<string, number>();
    const segmentId = (value: string) => {
      let id = indexOf.get(value);
      if (id === undefined) {
        id = values.length;
        values.push(value);
        indexOf.set(value, id);
      }
      return id;
    };
    const byBundle = this.bundles.map((bundle) =>
      segmentId(splitBy === 'bundle' ? bundle.version : ''),
    );
    const byLane = this.lanes.map((lane) =>
      segmentId(
        splitBy === 'channel'
          ? (lane.channel ?? '')
          : splitBy === 'runtime'
            ? lane.runtimeVersion
            : '',
      ),
    );
    const byPlatform = EVENT_PLATFORMS.map((platform) =>
      segmentId(splitBy === 'platform' ? platform : ''),
    );
    const segmentOf =
      splitBy === 'bundle'
        ? (i: number) => byBundle[store.bundle[i]]
        : splitBy === 'channel' || splitBy === 'runtime'
          ? (i: number) => byLane[store.lane[i]]
          : splitBy === 'platform'
            ? (i: number) => byPlatform[store.platform[i]]
            : () => 0;

    const first = this.events.lowerBound(from);
    const last = store.lowerBound(to);
    const base = Math.floor((from + shiftMs) / bucketMs);
    const actions = EVENT_ACTIONS.length;
    const segments = Math.max(1, values.length);
    const counts = new Map<number, number>();
    for (let i = first; i < last; i += 1) {
      if (!matches(i)) continue;
      const bucket = Math.floor((store.time[i] + shiftMs) / bucketMs) - base;
      const key = (bucket * actions + store.action[i]) * segments + segmentOf(i);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const points: ActivityPoint[] = [];
    for (const [key, count] of counts) {
      const segment = key % segments;
      const action = Math.floor(key / segments) % actions;
      const bucket = Math.floor(key / segments / actions);
      points.push({
        bucketStart: (base + bucket) * bucketMs - shiftMs,
        action: EVENT_ACTIONS[action],
        segment: values[segment] ?? '',
        count,
      });
    }
    return points;
  }

  activityMarkers(filters: DemoFilters, from: number, to: number): EventActivityMarker[] {
    const visible = (release: Release) => {
      const lane = this.lanes[release.lane];
      const bundle = this.bundles[release.bundle];
      return (
        (filters.channel === undefined || lane.channel === filters.channel) &&
        (filters.runtimeVersion === undefined ||
          bundle.runtimeVersion === filters.runtimeVersion) &&
        (!filters.bundleVersion || bundle.version === filters.bundleVersion)
      );
    };
    const toMarker = (release: Release): MarkerRelease => ({
      channel: this.lanes[release.lane].channel,
      promotedAt: new Date(release.promotedAt),
      revertedAt: release.revertedAt === null ? null : new Date(release.revertedAt),
      revertedBy: release.revertedBy,
      rolloutPercent: release.rolloutPercent,
      bundleVersion: this.bundles[release.bundle].version,
      runtimeVersion: this.bundles[release.bundle].runtimeVersion,
    });
    const inRange = (time: number | null) => time !== null && time >= from && time < to;
    return buildActivityMarkers({
      releases: this.releases
        .filter(
          (release) =>
            visible(release) && (inRange(release.promotedAt) || inRange(release.revertedAt)),
        )
        .map(toMarker),
      steps: this.steps.map((step) => {
        const release = this.releases[step.release];
        return {
          at: new Date(step.at),
          release: visible(release) ? toMarker(release) : undefined,
          fromPercent: step.fromPercent,
          toPercent: step.toPercent,
        };
      }),
      from,
      to,
    });
  }

  /** The bundle a lane's devices run outside a rollout, and the one it replaced. */
  laneBundles(channel: string | null, runtimeVersion: string) {
    const lane = this.lanes.find(
      (item) => item.channel === channel && item.runtimeVersion === runtimeVersion,
    );
    const current = lane ? this.currentRelease(lane) : null;
    if (!current) return null;
    const stable =
      current.rolloutPercent < 100 && current.previousBundle !== null
        ? current.previousBundle
        : current.bundle;
    return {
      bundle: this.bundles[stable],
      replaced: current.previousBundle === null ? null : this.bundles[current.previousBundle],
    };
  }

  bundleRecord(id: string) {
    return this.bundleById(id);
  }

  /** The upload before `bundle` with the same runtime, if any. */
  previousUpload(bundle: Bundle): Bundle | null {
    return (
      [...this.bundles]
        .filter(
          (item) =>
            item.runtimeVersion === bundle.runtimeVersion && item.createdAt < bundle.createdAt,
        )
        .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null
    );
  }
}
