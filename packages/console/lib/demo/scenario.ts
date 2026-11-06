/**
 * The dashboard demo's starting point: an organization with one app, its
 * lanes (who runs what) on the production and beta channels, bundles and 30
 * days of release history. Times are offsets before the moment the demo
 * opens. Auto-reverts are not scripted: the simulation reverts a release when
 * its rollbacks cross the threshold, exactly as it does for releases made in
 * the demo.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type DemoLaneSpec = {
  channel: string | null;
  runtimeVersion: string;
  devices: number;
  /** Share of the lane's devices on iOS; the rest are Android. */
  iosShare: number;
};

export type DemoBundleSpec = {
  version: string;
  runtimeVersion: string;
  uploadedAgo: number;
  /** Upload size in bytes. */
  size: number;
  /** Share of applies that roll back: a bundle with a bug on launch. */
  rollbackRate?: number;
};

export type DemoReleaseSpec = {
  version: string;
  channel: string | null;
  ago: number;
  by: string;
  /** Starting share of the lane; later steps raise it. */
  rolloutPercent?: number;
  steps?: Array<{ ago: number; percent: number }>;
  autoRevert?: { ratePercent: number; minSample: number };
  forceImmediate?: boolean;
  notes?: string;
};

export type DemoAppSpec = {
  id: string;
  slug: string;
  createdAgo: number;
  seed: number;
  lanes: DemoLaneSpec[];
  bundles: DemoBundleSpec[];
  releases: DemoReleaseSpec[];
};

export const DEMO_USER = {
  id: 'demo-user',
  name: 'You',
  email: 'you@acme.dev',
};

export const DEMO_ORGANIZATION = { id: 'demo-organization', name: 'Acme' };

const MAYA = 'maya@acme.dev';
const JONAS = 'jonas@acme.dev';
const CI = 'api-key:github-actions';

/** The bundle the demo guide asks visitors to release, and the one with a bug. */
export const DEMO_NEXT_VERSION = '2.4.0';
export const DEMO_BROKEN_VERSION = '2.4.1';

export const DEMO_APPS: DemoAppSpec[] = [
  {
    id: '7f3c2a10-5b1e-4c3d-9a7e-1d2c3b4a5f60',
    slug: 'com.acme.mobile',
    createdAgo: 120 * DAY,
    seed: 20261106,
    lanes: [
      { channel: 'production', runtimeVersion: '5.0', devices: 64_000, iosShare: 0.58 },
      { channel: 'production', runtimeVersion: '4.0', devices: 5_200, iosShare: 0.52 },
      { channel: 'beta', runtimeVersion: '5.0', devices: 2_600, iosShare: 0.66 },
    ],
    bundles: [
      {
        version: '1.9.6',
        runtimeVersion: '4.0',
        uploadedAgo: 52 * DAY + 2 * HOUR,
        size: 1_840_211,
      },
      {
        version: '2.0.3',
        runtimeVersion: '5.0',
        uploadedAgo: 41 * DAY + 3 * HOUR,
        size: 2_104_877,
      },
      {
        version: '2.1.0',
        runtimeVersion: '5.0',
        uploadedAgo: 31 * DAY + 3 * HOUR,
        size: 2_215_406,
      },
      {
        version: '2.1.1',
        runtimeVersion: '5.0',
        uploadedAgo: 23 * DAY + 2 * HOUR,
        size: 2_216_118,
      },
      {
        version: '2.2.0',
        runtimeVersion: '5.0',
        uploadedAgo: 18 * DAY + 5 * HOUR,
        size: 2_398_552,
        rollbackRate: 0.32,
      },
      {
        version: '2.2.1',
        runtimeVersion: '5.0',
        uploadedAgo: 14 * DAY + 3 * HOUR,
        size: 2_401_930,
      },
      { version: '2.3.0', runtimeVersion: '5.0', uploadedAgo: 8 * DAY + 4 * HOUR, size: 2_472_064 },
      { version: '1.9.7', runtimeVersion: '4.0', uploadedAgo: 9 * DAY + HOUR, size: 1_842_975 },
      {
        version: '2.4.0',
        runtimeVersion: '5.0',
        uploadedAgo: 26 * HOUR + 40 * MINUTE,
        size: 2_530_419,
      },
      {
        version: '2.4.1',
        runtimeVersion: '5.0',
        uploadedAgo: 25 * MINUTE,
        size: 2_533_806,
        rollbackRate: 0.36,
      },
    ],
    releases: [
      { version: '1.9.6', channel: 'production', ago: 52 * DAY, by: MAYA },
      { version: '2.0.3', channel: 'production', ago: 41 * DAY, by: CI },
      { version: '2.0.3', channel: 'beta', ago: 41 * DAY, by: CI },
      { version: '2.1.0', channel: 'beta', ago: 29 * DAY, by: MAYA },
      {
        version: '2.1.0',
        channel: 'production',
        ago: 27 * DAY,
        by: MAYA,
        rolloutPercent: 10,
        steps: [
          { ago: 26 * DAY, percent: 50 },
          { ago: 25 * DAY, percent: 100 },
        ],
        notes: 'New onboarding and faster workout sync.',
      },
      {
        version: '2.1.1',
        channel: 'production',
        ago: 23 * DAY,
        by: JONAS,
        forceImmediate: true,
        notes: 'Fixes a crash when opening a shared plan link.',
      },
      { version: '2.1.1', channel: 'beta', ago: 23 * DAY, by: JONAS },
      { version: '2.2.0', channel: 'beta', ago: 17 * DAY, by: CI },
      {
        version: '2.2.0',
        channel: 'production',
        ago: 15 * DAY,
        by: CI,
        rolloutPercent: 25,
        autoRevert: { ratePercent: 20, minSample: 50 },
        notes: 'Redesigned home screen.',
      },
      { version: '2.2.1', channel: 'beta', ago: 14 * DAY, by: MAYA },
      {
        version: '2.2.1',
        channel: 'production',
        ago: 13 * DAY,
        by: MAYA,
        rolloutPercent: 20,
        steps: [{ ago: 12 * DAY, percent: 100 }],
        autoRevert: { ratePercent: 20, minSample: 50 },
        notes: 'Redesigned home screen, with the Android 10 launch crash fixed.',
      },
      {
        version: '1.9.7',
        channel: 'production',
        ago: 9 * DAY,
        by: MAYA,
        notes: 'Fixes the sync banner.',
      },
      { version: '2.3.0', channel: 'beta', ago: 6 * DAY, by: JONAS },
      {
        version: '2.3.0',
        channel: 'production',
        ago: 22 * HOUR,
        by: MAYA,
        rolloutPercent: 10,
        steps: [
          { ago: 16 * HOUR, percent: 50 },
          { ago: 7 * HOUR, percent: 100 },
        ],
        autoRevert: { ratePercent: 20, minSample: 100 },
        notes: 'Weekly goals and offline workouts.',
      },
      {
        version: '2.4.0',
        channel: 'beta',
        ago: 3 * HOUR,
        by: JONAS,
        notes: 'Streaks and a new progress chart.',
      },
    ],
  },
];
