import { escapeHtml } from '@/lib/email';
import type { ReleaseSummary } from '@/lib/services/releases';

import { appUrl } from './emit';
import { notificationEventLabel, type NotificationPayload } from './events';

/**
 * Human-readable notifications. describeEvent holds all copy; Slack, Discord and
 * email only lay it out. Webhooks send the raw payload instead.
 */

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical';

export type EventDescription = {
  title: string;
  lines: string[];
  severity: NotificationSeverity;
  url: string;
};

function lane(release: Pick<ReleaseSummary, 'channel' | 'runtimeVersion'>): string {
  return `${release.channel ?? 'base'}${release.runtimeVersion ? ` / runtime ${release.runtimeVersion}` : ''}`;
}

function byLine(payload: NotificationPayload): string[] {
  return payload.data.actor ? [`By ${payload.data.actor.label}.`] : [];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function healthStats(health: {
  rollbacks: number;
  attempts: number;
  measuredRatePercent: number;
  ratePercent: number;
  minSample: number;
  windowHours: number;
}): string {
  return `${health.rollbacks} of ${health.attempts} devices rolled back (${health.measuredRatePercent}%) in the last ${health.windowHours} hours (trigger: >=${health.ratePercent}% of >=${health.minSample}).`;
}

const NO_PREVIOUS_RELEASE =
  'No previous release on this lane — new installs receive the built-in bundle.';

export function describeEvent(payload: NotificationPayload): EventDescription {
  const slug = payload.data.app?.slug ?? '';
  const url = payload.data.url;
  switch (payload.type) {
    case 'release.published': {
      const { release, previousRelease, replacedRelease } = payload.data;
      const lines: string[] = [];
      if (release.rolloutPercent < 100) {
        lines.push(`Rolling out to ${release.rolloutPercent}% of devices.`);
      }
      lines.push(
        previousRelease
          ? `Previous release: ${previousRelease.bundleVersion}.`
          : 'First release on this lane.',
      );
      if (replacedRelease) {
        lines.push(`Replaced the rollout of ${replacedRelease.bundleVersion}.`);
      }
      return {
        title: `Released ${slug} ${release.bundleVersion} (${lane(release)})`,
        lines: [...lines, ...byLine(payload)],
        severity: 'success',
        url,
      };
    }
    case 'release.rollout_updated': {
      const { release, previousPercent } = payload.data;
      return {
        title:
          release.rolloutPercent === 100
            ? `Rollout complete: ${slug} ${release.bundleVersion} (${lane(release)})`
            : `Rollout of ${slug} ${release.bundleVersion} (${lane(release)}): ${previousPercent}% → ${release.rolloutPercent}%`,
        lines: [
          release.rolloutPercent === 100
            ? 'Every device on this lane now receives it.'
            : `${release.rolloutPercent}% of devices on this lane now receive it.`,
          ...byLine(payload),
        ],
        severity: 'info',
        url,
      };
    }
    case 'release.reverted': {
      const { release, currentRelease } = payload.data;
      const cancelled = release.rolloutPercent < 100;
      return {
        title: cancelled
          ? `Cancelled the rollout of ${slug} ${release.bundleVersion} (${lane(release)})`
          : `Reverted ${slug} ${release.bundleVersion} (${lane(release)})`,
        lines: [
          currentRelease
            ? `Devices now receive ${currentRelease.bundleVersion}.`
            : NO_PREVIOUS_RELEASE,
          ...byLine(payload),
        ],
        severity: 'warning',
        url,
      };
    }
    case 'release.auto_reverted': {
      const { release, currentRelease, health } = payload.data;
      return {
        title: `Auto-reverted ${slug} ${release.bundleVersion} (${lane(release)})`,
        lines: [
          `Release ${release.bundleVersion}: ${healthStats(health)}`,
          currentRelease
            ? `Reverted automatically. Devices now receive ${currentRelease.bundleVersion}.`
            : `Reverted automatically. ${NO_PREVIOUS_RELEASE}`,
        ],
        severity: 'critical',
        url,
      };
    }
    case 'release.auto_revert_suppressed': {
      const { release, health } = payload.data;
      return {
        title: `Auto-revert suppressed for ${slug} (${lane(release)})`,
        lines: [
          `Release ${release.bundleVersion}: ${healthStats(health)}`,
          'Not reverted automatically: the previous release on this lane was already auto-reverted within the last 24 hours. Manual action needed.',
        ],
        severity: 'critical',
        url,
      };
    }
    case 'bundle.uploaded': {
      const { bundle } = payload.data;
      return {
        title: `Uploaded ${slug} ${bundle.version}`,
        lines: [
          `${formatBytes(bundle.size)}${bundle.runtimeVersion ? `, runtime ${bundle.runtimeVersion}` : ''}.`,
          ...byLine(payload),
        ],
        severity: 'info',
        url,
      };
    }
    case 'usage.warning': {
      const { usage, organization } = payload.data;
      const period = new Intl.DateTimeFormat('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(usage.periodStart));
      return {
        title: `Usage reached ${usage.threshold}% for ${organization.name}`,
        lines: [
          `${usage.threshold}% threshold reached for ${period}.`,
          `Downloads: ${usage.downloadsCount.toLocaleString('en-US')} / ${usage.limit.toLocaleString('en-US')}`,
        ],
        severity: usage.threshold === 100 ? 'critical' : 'warning',
        url,
      };
    }
    case 'test.ping':
      return {
        title: 'Test notification from OtaKit',
        lines: [payload.data.message],
        severity: 'info',
        url,
      };
  }
}

// ── Slack ────────────────────────────────────────────────────────────

function slackEscape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Body for a Slack incoming webhook (Block Kit, with `text` as the fallback). */
export function slackMessage(payload: NotificationPayload): Record<string, unknown> {
  const event = describeEvent(payload);
  return {
    text: event.title,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [`*${slackEscape(event.title)}*`, ...event.lines.map(slackEscape)].join('\n'),
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `<${event.url}|Open in OtaKit> · ${slackEscape(payload.data.organization.name)}`,
          },
        ],
      },
    ],
  };
}

// ── Discord ──────────────────────────────────────────────────────────

const DISCORD_COLORS: Record<NotificationSeverity, number> = {
  info: 0x3b82f6,
  success: 0x22c55e,
  warning: 0xf59e0b,
  critical: 0xef4444,
};

/** Body for a Discord webhook: one embed, mentions disabled. */
export function discordMessage(payload: NotificationPayload): Record<string, unknown> {
  const event = describeEvent(payload);
  return {
    embeds: [
      {
        title: event.title.slice(0, 256),
        description: event.lines.join('\n').slice(0, 4096),
        url: event.url,
        color: DISCORD_COLORS[event.severity],
        timestamp: payload.timestamp,
        footer: { text: payload.data.organization.name.slice(0, 2048) },
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

// ── Email ────────────────────────────────────────────────────────────

function emailFooter(payload: NotificationPayload, destinationName: string): string {
  const organization = payload.data.organization.name;
  return payload.type === 'test.ping'
    ? `A test sent to "${destinationName}" in ${organization}.`
    : `You receive this because "${destinationName}" in ${organization} includes ${notificationEventLabel(payload.type).toLowerCase()} notifications.`;
}

export function emailMessage(
  payload: NotificationPayload,
  destinationName: string,
): { subject: string; html: string; text: string } {
  const event = describeEvent(payload);
  const settingsUrl = `${appUrl()}/dashboard/settings`;
  const footer = emailFooter(payload, destinationName);
  const html = `
<p><strong>${escapeHtml(event.title)}</strong></p>
${event.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n')}
<p><a href="${escapeHtml(event.url)}">Open in OtaKit</a></p>
<p style="color: #6b7280; font-size: 12px;">${escapeHtml(footer)} <a href="${escapeHtml(settingsUrl)}">Notification settings</a></p>
  `.trim();
  const text = [
    event.title,
    '',
    ...event.lines,
    '',
    `Open in OtaKit: ${event.url}`,
    '',
    footer,
    `Notification settings: ${settingsUrl}`,
  ].join('\n');
  return { subject: event.title, html, text };
}
