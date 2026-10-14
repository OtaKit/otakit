import { describe, expect, it } from 'vitest';

import { releaseTimeseriesEnvelopeParts } from './release-timeseries';

const timeseries = {
  release: { bundleVersion: '1.4.2', channel: 'production' },
  range: '24h',
  platform: null,
  analyticsAvailable: true,
  totals: {
    downloads: 53,
    applied: 48,
    downloadErrors: 0,
    rollbacks: 1,
    rollbackSharePercent: 2.04,
  },
};

describe('releaseTimeseriesEnvelopeParts', () => {
  it('summarizes the totals as events', () => {
    expect(releaseTimeseriesEnvelopeParts(timeseries)).toEqual({
      summary:
        '1.4.2 on production, the last 24 hours: 48 applies, 1 rollback (2.04% rollback share), 0 download errors, 53 downloads.',
      warnings: [
        'Event counts are client-reported and are not unique devices, adoption, or authenticated installations.',
      ],
    });
    expect(
      releaseTimeseriesEnvelopeParts({
        ...timeseries,
        release: { bundleVersion: '1.4.2', channel: null },
        range: '7d',
        platform: 'ios',
        totals: { ...timeseries.totals, rollbackSharePercent: null },
      }).summary,
    ).toBe(
      '1.4.2 on the base channel on iOS, the last 7 days: 48 applies, 1 rollback, 0 download errors, 53 downloads.',
    );
  });

  it('never lets unavailable analytics read as zero', () => {
    const parts = releaseTimeseriesEnvelopeParts({
      ...timeseries,
      analyticsAvailable: false,
      totals: {
        downloads: 0,
        applied: 0,
        downloadErrors: 0,
        rollbacks: 0,
        rollbackSharePercent: null,
      },
    });
    expect(parts.summary).toBe(
      'Analytics are unavailable, so the events of 1.4.2 on production are unknown, not zero.',
    );
    expect(parts.warnings).toEqual([
      'Analytics are unavailable: the counts in this result are unknown, not zero.',
    ]);
  });
});
