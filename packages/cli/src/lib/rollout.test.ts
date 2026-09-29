import { describe, expect, it } from 'vitest';

import { OtaKitApiError, type Release } from './api.js';
import { CliError } from './errors.js';
import { explainRolloutConflict, findRolloutConflict, rolloutSuffix } from './rollout.js';

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

describe('findRolloutConflict', () => {
  const noReplace = { rolloutPercent: undefined, replaceRollout: false };

  it('refuses to publish over an active rollout unless it is replaced', () => {
    const rolling = release({ bundleVersion: '1.4.2', rolloutPercent: 10 });

    expect(findRolloutConflict(rolling, noReplace)).toEqual({
      code: 'ROLLOUT_IN_PROGRESS',
      message: 'Release 1.4.2 is rolling out to 10% of this lane',
    });
    expect(findRolloutConflict(rolling, { ...noReplace, replaceRollout: true })).toBeNull();
  });

  it('refuses a rollout percentage for the first release on a lane', () => {
    expect(findRolloutConflict(null, { ...noReplace, rolloutPercent: 10 })).toMatchObject({
      code: 'ROLLOUT_NEEDS_STABLE',
    });
    expect(findRolloutConflict(null, noReplace)).toBeNull();
    expect(findRolloutConflict(null, { ...noReplace, rolloutPercent: 100 })).toBeNull();
  });

  it('allows a rollout on top of a completed release', () => {
    expect(
      findRolloutConflict(release({ rolloutPercent: 100 }), { ...noReplace, rolloutPercent: 10 }),
    ).toBeNull();
    expect(findRolloutConflict(release({}), { ...noReplace, rolloutPercent: 10 })).toBeNull();
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
});
