import { escapeHtml } from '@/lib/email';
import type { ReleaseSummary } from '@/lib/services/releases';

import { appUrl } from './emit';
import {
  notificationEventLabel,
  type AutoRevertHealth,
  type NotificationErrorIssue,
  type NotificationPayload,
} from './events';

/**
 * Human-readable notifications. describeEvent holds all copy; Slack, Discord and
 * email only lay it out. Webhooks send the raw payload instead.
 */

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical';

export type EventDescription = {
  title: string;
  /**
   * Device-reported text (error titles and frames), shown verbatim as inline
   * code after the title: never markup, never a link.
   */
  code?: string[];
  lines: string[];
  /** Release notes, shown as their own block. Plain text written by the team. */
  notes: string | null;
  severity: NotificationSeverity;
  url: string;
};

function lane(release: Pick<ReleaseSummary, 'channel' | 'runtimeVersion'>): string {
  return `${release.channel ?? 'base'}${release.runtimeVersion ? ` / runtime ${release.runtimeVersion}` : ''}`;
}

function byLine(payload: NotificationPayload): string[] {
  const actor = payload.data.actor;
  if (!actor) return [];
  if (actor.type === 'api_key') return [`By API key "${actor.label}".`];
  return [`By ${actor.label}.`];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function healthStats(health: AutoRevertHealth): string {
  return `${health.rollbacks} of ${health.attempts} update attempts rolled back (${health.rollbackSharePercent}%) in the last ${health.windowHours} hours. Threshold: ≥${health.thresholdPercent}% of ≥${health.thresholdMinSample}.`;
}

function formatUtc(iso: string): string {
  return `${new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  }).format(new Date(iso))} UTC`;
}

/** Error events per 1,000 applies, e.g. "1.8" or "<0.1". */
function formatRate(rate: number): string {
  if (rate > 0 && rate < 0.1) return '<0.1';
  return rate >= 10 ? rate.toFixed(0) : rate.toFixed(1);
}

function issueCode(issue: NotificationErrorIssue): string[] {
  return [issue.title, ...(issue.topFrame ? [`at ${issue.topFrame}`] : [])];
}

const NO_PREVIOUS_RELEASE =
  'No previous release on this lane — new installs receive the built-in bundle.';

export function describeEvent(payload: NotificationPayload): EventDescription {
  const slug = payload.data.app?.slug ?? '';
  const url = payload.data.dashboardUrl;
  switch (payload.type) {
    case 'release.published': {
      const { release, previousRelease, replacedRelease } = payload.data;
      const rolling = release.rolloutPercent < 100;
      const lines: string[] = [];
      if (rolling) {
        lines.push(
          `${release.rolloutPercent}% of devices on this lane receive it; the rest stay on ${previousRelease?.bundleVersion ?? 'the previous release'}.`,
        );
      } else {
        lines.push(
          previousRelease
            ? `Previous release: ${previousRelease.bundleVersion}.`
            : 'First release on this lane.',
        );
      }
      if (replacedRelease) {
        lines.push(`Replaced the rollout of ${replacedRelease.bundleVersion}.`);
      }
      return {
        title: rolling
          ? `Started rollout of ${slug} ${release.bundleVersion} to ${release.rolloutPercent}% (${lane(release)})`
          : `Released ${slug} ${release.bundleVersion} (${lane(release)})`,
        lines: [...lines, ...byLine(payload)],
        notes: release.notes?.trim() ? release.notes.trim() : null,
        severity: 'success',
        url,
      };
    }
    case 'release.rollout_updated': {
      const { release, previousRolloutPercent } = payload.data;
      return {
        title:
          release.rolloutPercent === 100
            ? `Rollout complete: ${slug} ${release.bundleVersion} (${lane(release)})`
            : `Rollout of ${slug} ${release.bundleVersion} (${lane(release)}): ${previousRolloutPercent}% → ${release.rolloutPercent}%`,
        lines: [
          release.rolloutPercent === 100
            ? 'Every device on this lane now receives it.'
            : `${release.rolloutPercent}% of devices on this lane now receive it.`,
          ...byLine(payload),
        ],
        notes: null,
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
        notes: null,
        severity: 'warning',
        url,
      };
    }
    case 'release.auto_reverted': {
      const { release, currentRelease, health } = payload.data;
      return {
        title: `Auto-reverted ${slug} ${release.bundleVersion} (${lane(release)})`,
        lines: [
          healthStats(health),
          currentRelease
            ? `Reverted automatically. Devices now receive ${currentRelease.bundleVersion}.`
            : `Reverted automatically. ${NO_PREVIOUS_RELEASE}`,
        ],
        notes: null,
        severity: 'critical',
        url,
      };
    }
    case 'release.auto_revert_suppressed': {
      const { release, health } = payload.data;
      return {
        title: `Action needed: ${slug} ${release.bundleVersion} is unhealthy and was not auto-reverted (${lane(release)})`,
        lines: [
          healthStats(health),
          'Not reverted automatically, because the previous release on this lane was already auto-reverted in the last 24 hours. Review it and revert if needed.',
        ],
        notes: null,
        severity: 'critical',
        url,
      };
    }
    case 'config.updated': {
      const { config } = payload.data;
      const where = `${slug} (${config.channel ?? 'base'})`;
      const said = config.message ? [`“${config.message}”`] : [];
      if (config.deleted) {
        return {
          title: `Config deleted: ${where}`,
          lines: [
            config.channel
              ? `Devices on ${config.channel} now use the base channel's config.`
              : 'Apps now use their code defaults.',
            ...said,
            ...byLine(payload),
          ],
          notes: null,
          severity: 'warning',
          url,
        };
      }
      const { added, changed, removed } = config.changedKeys;
      const keyList = (keys: string[]) =>
        keys.length > 10
          ? `${keys.slice(0, 10).join(', ')} and ${keys.length - 10} more`
          : keys.join(', ');
      const changes = [
        changed.length > 0 ? `Changed: ${keyList(changed)}.` : null,
        added.length > 0 ? `Added: ${keyList(added)}.` : null,
        removed.length > 0 ? `Removed: ${keyList(removed)}.` : null,
      ].filter((line): line is string => line !== null);
      return {
        title: `Config v${config.version} published: ${where}`,
        lines: [
          ...(changes.length > 0 ? changes : ['Same values as before.']),
          ...said,
          ...byLine(payload),
        ],
        notes: null,
        severity: 'info',
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
        notes: null,
        severity: 'info',
        url,
      };
    }
    case 'errors.new_issue': {
      const { issue } = payload.data;
      return {
        title: `New error in ${slug}`,
        code: issueCode(issue),
        lines: [
          `${issue.events.toLocaleString('en-US')} events since ${formatUtc(issue.firstSeenAt)}.`,
        ],
        notes: null,
        severity: 'warning',
        url,
      };
    }
    case 'errors.regression': {
      const { issue, previouslyResolvedAt, release } = payload.data;
      const where = release ? ` in ${release.bundleVersion} (${lane(release)})` : '';
      return {
        title: `Error came back in ${slug}`,
        code: issueCode(issue),
        lines: [
          `Resolved ${formatUtc(previouslyResolvedAt)}, seen again${where} ${formatUtc(issue.lastSeenAt)}. The issue is open again.`,
        ],
        notes: null,
        severity: 'warning',
        url,
      };
    }
    case 'errors.spike': {
      const { release, previousRelease, errors } = payload.data;
      // From the counts: the rounded rates in the payload can be 0.0 for a few errors.
      const rate = errors.applies > 0 ? (errors.events / errors.applies) * 1000 : 0;
      const previousRate =
        errors.previousApplies > 0 ? (errors.previousEvents / errors.previousApplies) * 1000 : 0;
      const comparison =
        previousRate > 0
          ? `${(rate / previousRate).toFixed(1)}× the rate of ${previousRelease.bundleVersion} (${formatRate(previousRate)})`
          : `${previousRelease.bundleVersion} had no errors`;
      return {
        title: `Error spike: ${slug} ${release.bundleVersion} (${lane(release)})`,
        lines: [
          `${formatRate(rate)} error events per 1,000 applies on plugin 3.4+; ${comparison}.`,
          `${errors.events.toLocaleString('en-US')} error events in ${errors.issues.toLocaleString('en-US')} ${errors.issues === 1 ? 'issue' : 'issues'}, ${errors.applies.toLocaleString('en-US')} applies.`,
        ],
        notes: null,
        severity: 'critical',
        url,
      };
    }
    case 'errors.paused': {
      const { errorUsage, organization } = payload.data;
      const until = new Intl.DateTimeFormat('en-US', {
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(errorUsage.pausedUntil));
      return {
        title: `Error tracking paused for ${organization.name}`,
        lines: [
          `${errorUsage.events.toLocaleString('en-US')} of ${errorUsage.limit.toLocaleString('en-US')} error events this month. New errors are not recorded until ${until}.`,
          'Upgrade the plan to resume now.',
        ],
        notes: null,
        severity: 'warning',
        url,
      };
    }
    case 'analytics.paused': {
      const { eventUsage, organization } = payload.data;
      const until = new Intl.DateTimeFormat('en-US', {
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(eventUsage.pausedUntil));
      return {
        title: `Analytics paused for ${organization.name}`,
        lines: [
          `${eventUsage.events.toLocaleString('en-US')} of ${eventUsage.limit.toLocaleString('en-US')} custom events this month. New events are not recorded until ${until}.`,
          'Upgrade the plan to resume now.',
        ],
        notes: null,
        severity: 'warning',
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
          `${usage.threshold}% of the plan's downloads used in ${period}.`,
          `Downloads: ${usage.downloadsCount.toLocaleString('en-US')} of ${usage.downloadsLimit.toLocaleString('en-US')}.`,
        ],
        notes: null,
        severity: usage.threshold === 100 ? 'critical' : 'warning',
        url,
      };
    }
    case 'test.ping':
      return {
        title: 'Test notification from OtaKit',
        lines: [
          payload.data.message,
          ...byLine(payload).map((line) => line.replace(/^By /, 'Sent by ')),
        ],
        notes: null,
        severity: 'info',
        url,
      };
  }
}

// ── Slack ────────────────────────────────────────────────────────────

function slackEscape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** One line of device text, without backticks or line breaks, so it cannot leave its code span. */
function codeLine(value: string): string {
  return value.replaceAll('`', "'").replace(/\s+/g, ' ').trim().slice(0, 300);
}

const SLACK_COLORS: Record<NotificationSeverity, string> = {
  info: '#3b82f6',
  success: '#22c55e',
  warning: '#f59e0b',
  critical: '#ef4444',
};

/** Slack section text is limited to 3,000 characters. */
const SLACK_TEXT_LIMIT = 3000;

/**
 * Body for a Slack incoming webhook: Block Kit inside a colored attachment (the
 * bar shows severity), with an escaped `text` fallback for notifications.
 */
export function slackMessage(payload: NotificationPayload): Record<string, unknown> {
  const event = describeEvent(payload);
  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*${slackEscape(event.title)}*`,
          ...(event.code ?? []).map((line) => `\`${slackEscape(codeLine(line))}\``),
          ...event.lines.map(slackEscape),
        ]
          .join('\n')
          .slice(0, SLACK_TEXT_LIMIT),
      },
    },
  ];
  if (event.notes) {
    // plain_text: the team's own words are shown as written, never as markup.
    blocks.push({
      type: 'section',
      text: {
        type: 'plain_text',
        text: `Release notes:\n${event.notes}`.slice(0, SLACK_TEXT_LIMIT),
        emoji: false,
      },
    });
  }
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `<${event.url}|Open in OtaKit> · ${slackEscape(payload.data.organization.name)}`,
      },
    ],
  });
  return {
    text: slackEscape(event.title),
    attachments: [{ color: SLACK_COLORS[event.severity], blocks }],
  };
}

// ── Discord ──────────────────────────────────────────────────────────

const DISCORD_COLORS: Record<NotificationSeverity, number> = {
  info: 0x3b82f6,
  success: 0x22c55e,
  warning: 0xf59e0b,
  critical: 0xef4444,
};

/**
 * Embed descriptions render Markdown, so text from versions, names and notes
 * is escaped: a version like `[x](https://evil)` must not become a link
 * (breaking the brackets is enough) or a heading, quote or spoiler. Titles
 * are sent as they are: they never render links.
 */
function discordEscape(value: string): string {
  return value.replace(/([\\*_~`|>[\]#])/g, '\\$1');
}

/** Body for a Discord webhook: one embed, mentions disabled. */
export function discordMessage(payload: NotificationPayload): Record<string, unknown> {
  const event = describeEvent(payload);
  const description = [
    ...(event.code ?? []).map((line) => `\`${codeLine(line)}\``),
    ...event.lines.map(discordEscape),
    ...(event.notes ? ['', '**Release notes**', discordEscape(event.notes)] : []),
  ].join('\n');
  return {
    embeds: [
      {
        title: event.title.slice(0, 256),
        description: description.slice(0, 4096),
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
    ? `A test sent to the "${destinationName}" destination in ${organization}.`
    : `You get this email because the "${destinationName}" destination in ${organization} includes "${notificationEventLabel(payload.type)}". Owners and admins can change this in Settings → Notifications.`;
}

export function emailMessage(
  payload: NotificationPayload,
  destinationName: string,
): { subject: string; html: string; text: string } {
  const event = describeEvent(payload);
  const settingsUrl = `${appUrl()}/dashboard/settings?org=${encodeURIComponent(payload.data.organization.id)}#notifications`;
  const footer = emailFooter(payload, destinationName);
  const notesHtml = event.notes
    ? `<p><strong>Release notes</strong></p>\n<p style="white-space: pre-line;">${escapeHtml(event.notes)}</p>\n`
    : '';
  const html = `
<p><strong>${escapeHtml(event.title)}</strong></p>
${(event.code ?? []).map((line) => `<p><code>${escapeHtml(codeLine(line))}</code></p>\n`).join('')}${event.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n')}
${notesHtml}<p><a href="${escapeHtml(event.url)}">Open in OtaKit</a></p>
<p style="color: #6b7280; font-size: 12px;">${escapeHtml(footer)} <a href="${escapeHtml(settingsUrl)}">Notification settings</a></p>
  `.trim();
  const text = [
    event.title,
    '',
    ...(event.code ?? []).map(codeLine),
    ...event.lines,
    ...(event.notes ? ['', 'Release notes:', event.notes] : []),
    '',
    `Open in OtaKit: ${event.url}`,
    '',
    footer,
    `Notification settings: ${settingsUrl}`,
  ].join('\n');
  return { subject: event.title, html, text };
}
