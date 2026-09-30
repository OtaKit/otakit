import { describe, expect, it } from 'vitest';

import { rolloutChangeSummary, rolloutShareText, rolloutWarnings } from './rollouts';

describe('rolloutWarnings', () => {
  it('says nothing for a plain release', () => {
    expect(rolloutWarnings({ bundleVersion: '1.0.0', rolloutPercent: 100 }, {})).toEqual([]);
    expect(rolloutWarnings(null, {})).toEqual([]);
  });

  it('explains what publishing does to an active rollout', () => {
    const rolling = { bundleVersion: '1.4.2', rolloutPercent: 10 };
    expect(rolloutWarnings(rolling, {})).toEqual([
      expect.stringContaining('Publishing fails unless replaceRollout is true'),
    ]);
    expect(rolloutWarnings(rolling, { replaceRollout: true })).toEqual([
      expect.stringContaining('reverts the active rollout of 1.4.2 (10%)'),
    ]);
  });

  it('explains who receives a rollout and that a first release cannot roll out', () => {
    expect(rolloutWarnings({ bundleVersion: '1.0.0' }, { rolloutPercent: 25 })).toEqual([
      expect.stringContaining('About 25% of devices on OtaKit plugin 3.1 or later'),
    ]);
    expect(rolloutWarnings(null, { rolloutPercent: 25 })).toEqual([
      expect.stringContaining('first release on a lane goes to every device'),
    ]);
  });
});

describe('rollout summaries', () => {
  it('names the share only for a rollout', () => {
    expect(rolloutShareText(25)).toBe(' to 25% of devices');
    expect(rolloutShareText(100)).toBe('');
    expect(rolloutShareText(undefined)).toBe('');
  });

  it('describes a change, a completion, and a pending sync', () => {
    const change = {
      publicationStatus: 'published',
      previousPercent: 10,
      release: { bundleVersion: '1.4.2', rolloutPercent: 25 },
    };
    expect(rolloutChangeSummary(change)).toBe('Rollout of 1.4.2 changed from 10% to 25%.');
    expect(
      rolloutChangeSummary({ ...change, release: { ...change.release, rolloutPercent: 100 } }),
    ).toBe('Completed the rollout of 1.4.2; every device now receives it.');
    expect(rolloutChangeSummary({ ...change, publicationStatus: 'manifest_sync_pending' })).toMatch(
      /pending/,
    );
  });
});
