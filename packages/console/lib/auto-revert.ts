import { recordAuditLog, type AuditActor } from './audit-log';
import { db } from './db';
import { sendAutoRevertEmail } from './email';
import { revertCurrentRelease } from './releases';
import { getReleaseHealthWindowCounts } from './tinybird/events';

export const AUTO_REVERT_WINDOW_HOURS = 24;
export const AUTO_REVERT_ACTOR_LABEL = 'auto-revert';
export const AUTO_REVERT_REVERTED_BY = 'system:auto-revert';

const AUTO_REVERT_ACTOR: AuditActor = {
  actorType: 'system',
  actorLabel: AUTO_REVERT_ACTOR_LABEL,
};

export type AutoRevertStats = {
  appsChecked: number;
  releasesEvaluated: number;
  reverted: number;
  suppressed: number;
  skippedApps: number;
};

type CandidateRelease = {
  id: string;
  appId: string;
  channel: string | null;
  autoRevertRatePercent: number;
  autoRevertMinSample: number;
  bundle: { version: string; runtimeVersion: string | null };
  app: { slug: string; organizationId: string };
};

export function shouldAutoRevert(
  counts: { applied: number; rollbacks: number },
  thresholds: { ratePercent: number; minSample: number },
): boolean {
  // `applied` only fires on a successful trial, so the failure share of
  // devices that completed a trial is rollbacks / (applied + rollbacks) —
  // a fully broken bundle has ~zero applied events.
  const attempts = counts.applied + counts.rollbacks;
  if (attempts < thresholds.minSample) {
    return false;
  }
  return counts.rollbacks * 100 >= thresholds.ratePercent * attempts;
}

async function resolveAlertRecipients(organizationId: string): Promise<string[]> {
  const members = await db.organizationMember.findMany({
    where: {
      organizationId,
      role: { in: ['owner', 'admin'] },
    },
    select: {
      user: {
        select: { email: true },
      },
    },
  });
  return Array.from(new Set(members.map((member) => member.user.email)));
}

async function sendAlerts(
  candidate: CandidateRelease,
  counts: { applied: number; rollbacks: number },
  args: { revertedToVersion: string | null; suppressed: boolean },
): Promise<void> {
  const attempts = counts.applied + counts.rollbacks;
  const measuredRatePercent = attempts > 0 ? Math.round((counts.rollbacks / attempts) * 100) : 0;
  const recipients = await resolveAlertRecipients(candidate.app.organizationId);
  await Promise.all(
    recipients.map((email) =>
      sendAutoRevertEmail({
        to: email,
        appSlug: candidate.app.slug,
        channel: candidate.channel,
        runtimeVersion: candidate.bundle.runtimeVersion,
        bundleVersion: candidate.bundle.version,
        rollbacks: counts.rollbacks,
        attempts,
        measuredRatePercent,
        thresholdRatePercent: candidate.autoRevertRatePercent,
        minSample: candidate.autoRevertMinSample,
        revertedToVersion: args.revertedToVersion,
        suppressed: args.suppressed,
      }).catch((error) => {
        console.error('[AutoRevert] alert email failed', {
          appId: candidate.appId,
          releaseId: candidate.id,
          email,
          error,
        });
      }),
    ),
  );
}

/**
 * One auto-revert sweep: for every non-reverted release with the autoRevert
 * flag that is current on its (channel, runtimeVersion) lane, compare the
 * rolling-window rollback share against the release's own thresholds and
 * revert + alert when it trips.
 *
 * Fail-safe by construction: missing analytics data (Tinybird down or not
 * configured) skips the app and can never trigger a revert.
 */
export async function runAutoRevertSweep(now: Date = new Date()): Promise<AutoRevertStats> {
  const stats: AutoRevertStats = {
    appsChecked: 0,
    releasesEvaluated: 0,
    reverted: 0,
    suppressed: 0,
    skippedApps: 0,
  };

  const windowStart = new Date(now.getTime() - AUTO_REVERT_WINDOW_HOURS * 60 * 60 * 1000);

  const candidates = (await db.release.findMany({
    where: {
      autoRevert: true,
      revertedAt: null,
      app: { organization: { usageBlocked: false } },
    },
    select: {
      id: true,
      appId: true,
      channel: true,
      autoRevertRatePercent: true,
      autoRevertMinSample: true,
      bundle: { select: { version: true, runtimeVersion: true } },
      app: { select: { slug: true, organizationId: true } },
    },
  })) satisfies CandidateRelease[];

  const candidatesByApp = new Map<string, CandidateRelease[]>();
  for (const candidate of candidates) {
    const list = candidatesByApp.get(candidate.appId) ?? [];
    list.push(candidate);
    candidatesByApp.set(candidate.appId, list);
  }

  for (const [appId, appCandidates] of candidatesByApp) {
    stats.appsChecked += 1;

    // Only the current release of each lane is guarded; older flagged
    // releases that were superseded are inert.
    const currentCandidates: CandidateRelease[] = [];
    for (const candidate of appCandidates) {
      const laneCurrent = await db.release.findFirst({
        where: {
          appId,
          channel: candidate.channel,
          revertedAt: null,
          bundle: { is: { runtimeVersion: candidate.bundle.runtimeVersion } },
        },
        orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      if (laneCurrent?.id === candidate.id) {
        currentCandidates.push(candidate);
      }
    }
    if (currentCandidates.length === 0) {
      continue;
    }

    const countsByReleaseId = await getReleaseHealthWindowCounts(
      appId,
      currentCandidates.map((candidate) => candidate.id),
      windowStart,
    );
    if (countsByReleaseId === null) {
      stats.skippedApps += 1;
      continue;
    }

    for (const candidate of currentCandidates) {
      stats.releasesEvaluated += 1;
      const counts = countsByReleaseId.get(candidate.id) ?? { applied: 0, rollbacks: 0 };
      if (
        !shouldAutoRevert(counts, {
          ratePercent: candidate.autoRevertRatePercent,
          minSample: candidate.autoRevertMinSample,
        })
      ) {
        continue;
      }

      const attempts = counts.applied + counts.rollbacks;
      const measuredRatePercent = Math.round((counts.rollbacks / attempts) * 100);
      const healthMetadata = {
        appId,
        channel: candidate.channel,
        runtimeVersion: candidate.bundle.runtimeVersion,
        bundleVersion: candidate.bundle.version,
        rollbacks: counts.rollbacks,
        attempts,
        measuredRatePercent,
        ratePercent: candidate.autoRevertRatePercent,
        minSample: candidate.autoRevertMinSample,
        windowHours: AUTO_REVERT_WINDOW_HOURS,
      };

      // Cascade guard: at most one automatic step back per lane per window.
      // A shared-cause failure (e.g. a broken backend crashing every bundle)
      // must not walk the lane back release by release.
      const lastRevertedOnLane = await db.release.findFirst({
        where: {
          appId,
          channel: candidate.channel,
          revertedAt: { not: null },
          bundle: { is: { runtimeVersion: candidate.bundle.runtimeVersion } },
        },
        orderBy: { revertedAt: 'desc' },
        select: { revertedAt: true, revertedBy: true },
      });
      if (
        lastRevertedOnLane?.revertedBy === AUTO_REVERT_REVERTED_BY &&
        lastRevertedOnLane.revertedAt !== null &&
        lastRevertedOnLane.revertedAt >= windowStart
      ) {
        // Alert once per unhealthy release; the audit log is the dedup store.
        const alreadySuppressed = await db.auditLog.findFirst({
          where: {
            organizationId: candidate.app.organizationId,
            action: 'release.auto_revert_suppressed',
            targetId: candidate.id,
          },
          select: { id: true },
        });
        stats.suppressed += 1;
        if (alreadySuppressed) {
          continue;
        }
        await recordAuditLog({
          organizationId: candidate.app.organizationId,
          actor: AUTO_REVERT_ACTOR,
          action: 'release.auto_revert_suppressed',
          targetType: 'release',
          targetId: candidate.id,
          metadata: healthMetadata,
        });
        await sendAlerts(candidate, counts, { revertedToVersion: null, suppressed: true });
        continue;
      }

      const outcome = await revertCurrentRelease({
        appId,
        releaseId: candidate.id,
        revertedBy: AUTO_REVERT_REVERTED_BY,
        actor: AUTO_REVERT_ACTOR,
        organizationId: candidate.app.organizationId,
        auditAction: 'release.auto_reverted',
        auditMetadata: healthMetadata,
      });
      if (!outcome.ok) {
        // Lost a race (human revert / concurrent tick) — nothing to do.
        continue;
      }

      stats.reverted += 1;
      await sendAlerts(candidate, counts, {
        revertedToVersion: outcome.nextCurrentRelease?.bundle.version ?? null,
        suppressed: false,
      });
    }
  }

  return stats;
}
