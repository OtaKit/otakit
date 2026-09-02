import { db } from '@/lib/db';
import { listRecentAppEventsWithStatus } from '@/lib/tinybird/events';
import { isTinybirdConfigured } from '@/lib/tinybird/client';
import type { DeviceEvent } from '@/app/components/dashboard-types';

/**
 * A device only becomes observable once it acts on a release: the manifest is a
 * static CDN object, so an update check never reaches this origin. Give a fresh
 * release this long to be picked up before calling the silence a problem.
 */
const DEVICE_CONTACT_GRACE_MS = 3 * 60 * 1000;

export type SetupStepStatus = 'todo' | 'active' | 'done' | 'blocked' | 'unknown';

export type SetupDiagnosisCode =
  | 'waiting_for_device'
  | 'no_device_contact'
  | 'download_error'
  | 'notify_timeout'
  | 'bundle_unreadable'
  | 'rolled_back'
  | 'downloaded_not_applied'
  | 'analytics_unavailable';

export type SetupDiagnosis = {
  code: SetupDiagnosisCode;
  tone: 'waiting' | 'warning' | 'error';
  title: string;
  body: string;
  /** Ranked causes, most likely first. Rendered as a short list. */
  causes?: string[];
  /** Pasteable prompt that puts the user's agent onto the fix. */
  fixPrompt?: string;
  /** Whatever the device actually reported, shown verbatim. */
  detail?: string | null;
};

/**
 * Only checkpoints this server can actually prove.
 *
 * Connecting the CLI or an agent is deliberately not one of them. `otakit
 * login` stores a user session token, so its requests arrive as actorType
 * 'user' — identical to somebody clicking in the console. Claiming to verify
 * that would either mark the step for people who never installed anything, or
 * leave it unmarked forever for people who did.
 */
export type OnboardingSnapshot = {
  complete: boolean;
  completedCount: number;
  totalCount: number;
  app: { id: string; slug: string } | null;
  analyticsAvailable: boolean;
  steps: {
    app: { status: SetupStepStatus; slug: string | null; createdAt: string | null };
    bundle: { status: SetupStepStatus; version: string | null; uploadedAt: string | null };
    release: {
      status: SetupStepStatus;
      releaseId: string | null;
      channel: string | null;
      runtimeVersion: string | null;
      publishedAt: string | null;
    };
    device: {
      status: SetupStepStatus;
      contactedAt: string | null;
      appliedAt: string | null;
      platform: string | null;
      bundleVersion: string | null;
      diagnosis: SetupDiagnosis | null;
    };
  };
};

function diagnose(args: {
  analyticsAvailable: boolean;
  publishedAt: Date | null;
  events: DeviceEvent[];
  now: Date;
}): SetupDiagnosis | null {
  if (!args.analyticsAvailable) {
    return {
      code: 'analytics_unavailable',
      tone: 'waiting',
      title: 'Event verification is unavailable',
      body: 'This deployment has no analytics backend configured, so OtaKit cannot confirm what your devices did. Everything up to the release is verified.',
    };
  }
  if (!args.publishedAt) return null;

  const applied = args.events.find((event) => event.action === 'applied');
  if (applied) return null;

  const rollback = args.events.find((event) => event.action === 'rollback');
  if (rollback) {
    if (rollback.detail === 'notify_timeout') {
      return {
        code: 'notify_timeout',
        tone: 'error',
        detail: rollback.detail,
        title: 'Your app never called notifyAppReady()',
        body: 'The update launched but never reported itself healthy, so OtaKit restored the previous bundle. Call notifyAppReady() once your app has finished booting.',
        fixPrompt:
          'My OtaKit update rolled back with notify_timeout. Find where my app finishes booting and add the OtaKit notifyAppReady() call there.',
      };
    }
    if (rollback.detail === 'extract_failed' || rollback.detail === 'download_failed') {
      return {
        code: 'bundle_unreadable',
        tone: 'error',
        detail: rollback.detail,
        title: 'The bundle arrived incomplete',
        body: 'The device could not unpack the update and restored the previous bundle. Re-upload and publish again.',
        fixPrompt: 'My OtaKit bundle failed to extract on device. Rebuild and re-upload it.',
      };
    }
    return {
      code: 'rolled_back',
      tone: 'error',
      detail: rollback.detail,
      title: 'The update rolled back',
      body: 'A device restored the previous bundle after applying this release.',
      fixPrompt: 'Check my OtaKit rollout health and explain why the release rolled back.',
    };
  }

  const downloadError = args.events.find((event) => event.action === 'download_error');
  if (downloadError) {
    return {
      code: 'download_error',
      tone: 'error',
      detail: downloadError.detail,
      title: 'A device could not download the update',
      body: 'Your plugin is configured correctly — it reached OtaKit and read the manifest. The download itself failed.',
      causes: [
        'The CDN is unreachable from the device network',
        'The bundle is encrypted and the device has no matching key',
      ],
      fixPrompt:
        'My OtaKit update failed to download on device. Read the rollout events and diagnose it.',
    };
  }

  if (args.events.some((event) => event.action === 'downloaded')) {
    return {
      code: 'downloaded_not_applied',
      tone: 'waiting',
      title: 'Downloaded — applies on the next launch',
      body: 'A device has the update. Relaunch the app to see it applied.',
    };
  }

  const waitedMs = args.now.getTime() - args.publishedAt.getTime();
  if (waitedMs < DEVICE_CONTACT_GRACE_MS) {
    return {
      code: 'waiting_for_device',
      tone: 'waiting',
      title: 'Waiting for a device',
      body: 'Rebuild the native app and launch it. This updates the moment a device reports in.',
    };
  }
  return {
    code: 'no_device_contact',
    tone: 'warning',
    title: 'No device has reported in',
    body: 'The release is live, but nothing has contacted OtaKit. That almost always means the app on the device is not the one you configured.',
    causes: [
      'plugins.OtaKit.appId does not match this app',
      'The native app has not been rebuilt since the plugin was installed',
      'The device has not launched the app, or is offline',
    ],
    fixPrompt:
      'Check my OtaKit setup in this project: confirm plugins.OtaKit.appId matches the app in my organization and that the plugin is installed correctly.',
  };
}

export async function getOnboardingSnapshot(input: {
  organizationId: string;
  appId?: string;
  now?: Date;
}): Promise<OnboardingSnapshot> {
  const now = input.now ?? new Date();

  // Target the app the user is actually setting up: an explicit one, else the
  // newest, so a returning user is not diagnosed against a stale project.
  const app = input.appId
    ? await db.app.findFirst({
        where: { id: input.appId, organizationId: input.organizationId },
        select: { id: true, slug: true, createdAt: true },
      })
    : await db.app.findFirst({
        where: { organizationId: input.organizationId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, slug: true, createdAt: true },
      });

  const [bundle, release] = app
    ? await Promise.all([
        db.bundle.findFirst({
          where: { appId: app.id },
          orderBy: { createdAt: 'desc' },
          select: { version: true, createdAt: true },
        }),
        db.release.findFirst({
          where: { appId: app.id, revertedAt: null },
          orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            channel: true,
            promotedAt: true,
            bundle: { select: { runtimeVersion: true } },
          },
        }),
      ])
    : [null, null];

  const analyticsConfigured = isTinybirdConfigured();
  const events =
    app && release && analyticsConfigured
      ? await listRecentAppEventsWithStatus({
          appId: app.id,
          releaseId: release.id,
          // Only this release matters, so start at the moment it was published.
          // The margin absorbs clock skew between the device and this database.
          from: new Date((release.promotedAt ?? app.createdAt).getTime() - 60_000),
          limit: 50,
        })
      : { data: [] as DeviceEvent[], available: false };

  const analyticsAvailable = analyticsConfigured && (events.available || !release);
  const applied = events.data.find((event) => event.action === 'applied') ?? null;
  const firstContact = events.data.length > 0 ? events.data[events.data.length - 1] : null;
  const diagnosis = diagnose({
    analyticsAvailable,
    publishedAt: release?.promotedAt ?? null,
    events: events.data,
    now,
  });

  const deviceStatus: SetupStepStatus = applied
    ? 'done'
    : !release
      ? 'todo'
      : !analyticsAvailable
        ? 'unknown'
        : diagnosis?.tone === 'error' || diagnosis?.tone === 'warning'
          ? 'blocked'
          : 'active';

  const steps: OnboardingSnapshot['steps'] = {
    app: {
      status: app ? 'done' : 'active',
      slug: app?.slug ?? null,
      createdAt: app?.createdAt.toISOString() ?? null,
    },
    bundle: {
      status: bundle ? 'done' : app ? 'active' : 'todo',
      version: bundle?.version ?? null,
      uploadedAt: bundle?.createdAt.toISOString() ?? null,
    },
    release: {
      status: release ? 'done' : bundle ? 'active' : 'todo',
      releaseId: release?.id ?? null,
      channel: release?.channel ?? null,
      runtimeVersion: release?.bundle.runtimeVersion ?? null,
      publishedAt: release?.promotedAt?.toISOString() ?? null,
    },
    device: {
      status: deviceStatus,
      contactedAt: firstContact?.createdAt ?? null,
      appliedAt: applied?.createdAt ?? null,
      platform: applied?.platform ?? firstContact?.platform ?? null,
      bundleVersion: applied?.bundleVersion ?? firstContact?.bundleVersion ?? null,
      diagnosis,
    },
  };

  // 'unknown' counts as settled: a self-hosted deployment without analytics must
  // still be able to finish setup rather than stalling on the last step forever.
  const completedCount = Object.values(steps).filter(
    (step) => step.status === 'done' || step.status === 'unknown',
  ).length;

  return {
    complete: completedCount === 4,
    completedCount,
    totalCount: 4,
    app: app ? { id: app.id, slug: app.slug } : null,
    analyticsAvailable,
    steps,
  };
}
