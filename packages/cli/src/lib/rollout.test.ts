import { describe, expect, it, vi } from 'vitest';

import { OtaKitApiError, type Release } from './api.js';
import { findLaneState } from './compat-check.js';
import { CliError } from './errors.js';
import {
  explainRolloutConflict,
  findRolloutConflict,
  rolloutConflictError,
  rolloutSuffix,
} from './rollout.js';

function release(overrides: Partial<Release>): Release {
  return {
    id: 'release-1',
    channel: 'production',
    runtimeVersion: 'ios-1',
    bundleId: 'bundle-1',
    bundleVersion: '1.0.0',
    promotedAt: '2026-09-29T00:00:00.000Z',
    revertedAt: null,
    ...overrides,
  };
}

describe('findLaneState', () => {
  function apiWith(releases: Release[], total = releases.length) {
    return { listReleases: vi.fn().mockResolvedValue({ releases, total }) };
  }

  it('finds the current and stable release of the exact runtime lane', async () => {
    const lane = await findLaneState(
      apiWith([
        release({ id: 'other-runtime', runtimeVersion: 'ios-2', rolloutPercent: 5 }),
        release({ id: 'rolling', rolloutPercent: 10 }),
        release({ id: 'replaced', rolloutPercent: 20, revertedAt: '2026-09-29T01:00:00.000Z' }),
        release({ id: 'stable' }),
        release({ id: 'older' }),
      ]),
      'production',
      'ios-1',
    );

    expect(lane.current?.id).toBe('rolling');
    expect(lane.stable?.id).toBe('stable');
    expect(lane.complete).toBe(true);
  });

  it('uses the current release as stable when nothing rolls out', async () => {
    const lane = await findLaneState(apiWith([release({ id: 'current' })]), 'production', 'ios-1');
    expect(lane.stable?.id).toBe('current');
  });

  it('knows when the fetched history does not cover the whole channel', async () => {
    const lane = await findLaneState(apiWith([], 500), 'production', 'ios-1');
    expect(lane).toEqual({ current: null, stable: null, complete: false });
  });
});

describe('findRolloutConflict', () => {
  const noReplace = { rolloutPercent: undefined, replaceRollout: false };
  const empty = { current: null, complete: true };

  it('refuses to publish over an active rollout unless it is replaced', () => {
    const lane = {
      current: release({ id: 'rolling-1', bundleVersion: '1.4.2', rolloutPercent: 10 }),
      complete: true,
    };

    expect(findRolloutConflict(lane, noReplace)).toEqual({
      code: 'ROLLOUT_IN_PROGRESS',
      message: 'Release 1.4.2 is rolling out to 10% of this lane',
      releaseId: 'rolling-1',
    });
    expect(findRolloutConflict(lane, { ...noReplace, replaceRollout: true })).toBeNull();
  });

  it('refuses a rollout percentage for the first release on a lane', () => {
    expect(findRolloutConflict(empty, { ...noReplace, rolloutPercent: 10 })).toMatchObject({
      code: 'ROLLOUT_NEEDS_STABLE',
    });
    expect(findRolloutConflict(empty, noReplace)).toBeNull();
    expect(findRolloutConflict(empty, { ...noReplace, rolloutPercent: 100 })).toBeNull();
  });

  it('leaves an incompletely known lane to the server', () => {
    expect(
      findRolloutConflict({ current: null, complete: false }, { ...noReplace, rolloutPercent: 10 }),
    ).toBeNull();
  });

  it('allows a rollout on top of a completed release', () => {
    for (const current of [release({ rolloutPercent: 100 }), release({})]) {
      expect(
        findRolloutConflict({ current, complete: true }, { ...noReplace, rolloutPercent: 10 }),
      ).toBeNull();
    }
  });
});

describe('rollout messages', () => {
  it('names the share only for a rollout', () => {
    expect(rolloutSuffix(release({ rolloutPercent: 25 }))).toBe(' for 25% of devices');
    expect(rolloutSuffix(release({ rolloutPercent: 100 }))).toBe('');
    expect(rolloutSuffix(release({}))).toBe('');
  });

  it('explains a refused publish with the commands that resolve it', () => {
    const explained = explainRolloutConflict(
      new OtaKitApiError(
        409,
        'Release 1.4.2 is rolling out to 10% of this lane',
        'ROLLOUT_IN_PROGRESS',
      ),
      null,
    );
    expect(explained).toBeInstanceOf(CliError);
    expect((explained as CliError).message).toContain('rolling out to 10% on this channel.');
    expect((explained as CliError).message).toContain('otakit rollout --base --complete');
    expect((explained as CliError).message).toContain('--replace-rollout');

    const other = new OtaKitApiError(409, 'Stale', 'STALE_RELEASE_STATE');
    expect(explainRolloutConflict(other, 'production')).toBe(other);
  });

  it('names the exact rolling release when it is known', () => {
    const error = rolloutConflictError(
      {
        code: 'ROLLOUT_IN_PROGRESS',
        message: 'Release 1.4.2 is rolling out to 10% of this lane',
        releaseId: 'rolling-1',
      },
      'production',
    );
    expect(error.message).toContain('`otakit rollout rolling-1 --complete`');
    expect(error.message).toContain('`otakit rollout rolling-1 --cancel`');
  });
});
