import type {
  BundleSummaryItem,
  DashboardInitialData,
  DashboardPreviewAppData,
  DashboardPreviewData,
  DeviceEvent,
  Platform,
  ReleaseHistoryItem,
} from '@/app/components/dashboard-types';

const PREVIEW_NOW = Date.now();

function atOffset(minutesAgo: number): string {
  return new Date(PREVIEW_NOW - minutesAgo * 60_000).toISOString();
}

function bundle(
  id: string,
  version: string,
  size: number,
  createdMinutesAgo: number,
  options: Partial<BundleSummaryItem>,
): BundleSummaryItem {
  return {
    id,
    version,
    size,
    createdAt: atOffset(createdMinutesAgo),
    isLive: false,
    currentChannels: [],
    deployedChannels: [],
    eventCounts: {
      downloads: 0,
      applied: 0,
      downloadErrors: 0,
      rollbacks: 0,
    },
    ...options,
  };
}

function release(
  id: string,
  bundleId: string,
  bundleVersion: string,
  channel: string | null,
  promotedMinutesAgo: number,
  promotedBy: string | null,
  options?: {
    previousBundleId?: string | null;
    previousBundleVersion?: string | null;
    revertedAt?: string | null;
    revertedBy?: string | null;
    eventCounts?: ReleaseHistoryItem['eventCounts'];
  },
): ReleaseHistoryItem {
  return {
    id,
    bundleId,
    bundleVersion,
    previousBundleId: options?.previousBundleId ?? null,
    previousBundleVersion: options?.previousBundleVersion ?? null,
    channel,
    promotedAt: atOffset(promotedMinutesAgo),
    promotedBy,
    revertedAt: options?.revertedAt ?? null,
    revertedBy: options?.revertedBy ?? null,
    eventCounts: options?.eventCounts ?? {
      downloads: 0,
      applied: 0,
      downloadErrors: 0,
      rollbacks: 0,
    },
  };
}

function event(
  id: string,
  appId: string,
  action: DeviceEvent['action'],
  platform: Platform,
  bundleVersion: string | null,
  channel: string | null,
  minutesAgo: number,
  errorMessage: string | null = null,
): DeviceEvent {
  return {
    id,
    appId,
    action,
    platform,
    bundleVersion,
    channel,
    errorMessage,
    createdAt: atOffset(minutesAgo),
  };
}

const focusFlowAppId = 'preview-app-focusflow';
const macroTrackAppId = 'preview-app-macrotrack';
const voiceNotesAppId = 'preview-app-voicenotes';

const focusFlowData: DashboardPreviewAppData = {
  bundles: [
    bundle('bundle-focus-0408-2', '2026.04.08-2', 2_481_664, 55, {
      isLive: true,
      currentChannels: [null, 'beta'],
      deployedChannels: [
        { channel: null, deployedAt: atOffset(35) },
        { channel: 'beta', deployedAt: atOffset(30) },
      ],
      eventCounts: {
        downloads: 18_420,
        applied: 17_982,
        downloadErrors: 214,
        rollbacks: 31,
      },
    }),
    bundle('bundle-focus-0407-6', '2026.04.07-6', 2_432_518, 1280, {
      currentChannels: ['pilot'],
      deployedChannels: [{ channel: 'pilot', deployedAt: atOffset(410) }],
      eventCounts: {
        downloads: 10_381,
        applied: 10_094,
        downloadErrors: 97,
        rollbacks: 18,
      },
    }),
    bundle('bundle-focus-0405-3', '2026.04.05-3', 2_371_200, 4220, {
      deployedChannels: [
        { channel: null, deployedAt: atOffset(2290) },
        { channel: 'beta', deployedAt: atOffset(1510) },
        { channel: 'pilot', deployedAt: atOffset(950) },
      ],
      eventCounts: {
        downloads: 76_204,
        applied: 74_986,
        downloadErrors: 482,
        rollbacks: 164,
      },
    }),
  ],
  releases: [
    release(
      'release-focus-beta-0408',
      'bundle-focus-0408-2',
      '2026.04.08-2',
      'beta',
      30,
      'api-key:github-actions',
      {
        previousBundleId: 'bundle-focus-0405-3',
        previousBundleVersion: '2026.04.05-3',
        eventCounts: { downloads: 3_184, applied: 3_092, downloadErrors: 41, rollbacks: 6 },
      },
    ),
    release(
      'release-focus-base-0408',
      'bundle-focus-0408-2',
      '2026.04.08-2',
      null,
      35,
      'api-key:github-actions',
      {
        previousBundleId: 'bundle-focus-0405-3',
        previousBundleVersion: '2026.04.05-3',
        eventCounts: { downloads: 12_418, applied: 12_102, downloadErrors: 123, rollbacks: 18 },
      },
    ),
    release(
      'release-focus-pilot-0407',
      'bundle-focus-0407-6',
      '2026.04.07-6',
      'pilot',
      410,
      'marina@northstar.studio',
      {
        previousBundleId: 'bundle-focus-0405-3',
        previousBundleVersion: '2026.04.05-3',
        eventCounts: { downloads: 5_421, applied: 5_304, downloadErrors: 56, rollbacks: 11 },
      },
    ),
  ],
  events: [
    event('ev-focus-01', focusFlowAppId, 'applied', 'ios', '2026.04.08-2', null, 12),
    event('ev-focus-02', focusFlowAppId, 'downloaded', 'android', '2026.04.08-2', 'beta', 18),
    event('ev-focus-03', focusFlowAppId, 'applied', 'android', '2026.04.08-2', 'beta', 20),
    event(
      'ev-focus-04',
      focusFlowAppId,
      'rollback',
      'android',
      '2026.04.08-2',
      'beta',
      24,
      'app_restarted_before_notify',
    ),
    event('ev-focus-05', focusFlowAppId, 'downloaded', 'ios', '2026.04.08-2', null, 35),
    event('ev-focus-06', focusFlowAppId, 'applied', 'ios', '2026.04.08-2', null, 36),
    event('ev-focus-07', focusFlowAppId, 'downloaded', 'android', '2026.04.08-2', null, 44),
    event('ev-focus-08', focusFlowAppId, 'applied', 'android', '2026.04.08-2', null, 46),
    event(
      'ev-focus-09',
      focusFlowAppId,
      'rollback',
      'ios',
      '2026.04.05-3',
      'beta',
      155,
      'notify_timeout',
    ),
    event('ev-focus-10', focusFlowAppId, 'downloaded', 'android', '2026.04.07-6', 'pilot', 210),
    event('ev-focus-11', focusFlowAppId, 'applied', 'android', '2026.04.07-6', 'pilot', 214),
    event('ev-focus-12', focusFlowAppId, 'downloaded', 'ios', '2026.04.08-2', 'beta', 420),
    event('ev-focus-13', focusFlowAppId, 'applied', 'ios', '2026.04.08-2', 'beta', 421),
    event(
      'ev-focus-14',
      focusFlowAppId,
      'rollback',
      'ios',
      '2026.04.08-2',
      null,
      438,
      'notify_timeout',
    ),
  ],
};

const macroTrackData: DashboardPreviewAppData = {
  bundles: [
    bundle('bundle-macro-0408-1', '2026.04.08-1', 1_986_412, 90, {
      deployedChannels: [],
      eventCounts: {
        downloads: 0,
        applied: 0,
        downloadErrors: 0,
        rollbacks: 0,
      },
    }),
    bundle('bundle-macro-0403-4', '2026.04.03-4', 1_935_772, 7120, {
      deployedChannels: [{ channel: null, deployedAt: atOffset(5380) }],
      eventCounts: {
        downloads: 54_221,
        applied: 53_108,
        downloadErrors: 338,
        rollbacks: 94,
      },
    }),
    bundle('bundle-macro-0327-2', '2026.03.27-2', 1_902_320, 18_940, {
      isLive: true,
      currentChannels: [null],
      deployedChannels: [{ channel: null, deployedAt: atOffset(13_640) }],
      eventCounts: {
        downloads: 91_448,
        applied: 89_910,
        downloadErrors: 271,
        rollbacks: 43,
      },
    }),
  ],
  releases: [
    release(
      'release-macro-base-0403',
      'bundle-macro-0403-4',
      '2026.04.03-4',
      null,
      5380,
      'api-key:github-actions',
      {
        previousBundleId: 'bundle-macro-0327-2',
        previousBundleVersion: '2026.03.27-2',
        revertedAt: atOffset(5200),
        revertedBy: 'marina@northstar.studio',
        eventCounts: { downloads: 19_842, applied: 19_011, downloadErrors: 126, rollbacks: 37 },
      },
    ),
    release(
      'release-macro-base-0327',
      'bundle-macro-0327-2',
      '2026.03.27-2',
      null,
      13_640,
      'marina@northstar.studio',
      {
        eventCounts: { downloads: 32_604, applied: 31_948, downloadErrors: 92, rollbacks: 11 },
      },
    ),
  ],
  events: [
    event('ev-macro-01', macroTrackAppId, 'downloaded', 'ios', '2026.03.27-2', null, 44),
    event('ev-macro-02', macroTrackAppId, 'applied', 'ios', '2026.03.27-2', null, 45),
    event('ev-macro-03', macroTrackAppId, 'downloaded', 'android', '2026.03.27-2', null, 51),
    event('ev-macro-04', macroTrackAppId, 'applied', 'android', '2026.03.27-2', null, 53),
    event(
      'ev-macro-05',
      macroTrackAppId,
      'rollback',
      'android',
      '2026.04.03-4',
      null,
      1460,
      'app_restarted_before_notify',
    ),
    event(
      'ev-macro-06',
      macroTrackAppId,
      'rollback',
      'ios',
      '2026.04.03-4',
      null,
      1498,
      'notify_timeout',
    ),
  ],
};

const voiceNotesData: DashboardPreviewAppData = {
  bundles: [
    bundle('bundle-voice-0407-1', '2026.04.07-1', 3_298_220, 180, {
      isLive: true,
      currentChannels: [null, 'beta'],
      deployedChannels: [
        { channel: null, deployedAt: atOffset(150) },
        { channel: 'beta', deployedAt: atOffset(120) },
      ],
      eventCounts: {
        downloads: 8_248,
        applied: 7_982,
        downloadErrors: 61,
        rollbacks: 9,
      },
    }),
    bundle('bundle-voice-0406-2', '2026.04.06-2', 3_284_018, 2920, {
      deployedChannels: [{ channel: null, deployedAt: atOffset(2810) }],
      eventCounts: {
        downloads: 6_382,
        applied: 6_114,
        downloadErrors: 44,
        rollbacks: 13,
      },
    }),
    bundle('bundle-voice-0329-7', '2026.03.29-7', 3_201_876, 15_100, {
      deployedChannels: [{ channel: 'beta', deployedAt: atOffset(10_820) }],
      eventCounts: {
        downloads: 48_660,
        applied: 47_024,
        downloadErrors: 308,
        rollbacks: 87,
      },
    }),
  ],
  releases: [
    release(
      'release-voice-beta-0407',
      'bundle-voice-0407-1',
      '2026.04.07-1',
      'beta',
      120,
      'marina@northstar.studio',
      {
        previousBundleId: 'bundle-voice-0329-7',
        previousBundleVersion: '2026.03.29-7',
        eventCounts: { downloads: 2_218, applied: 2_132, downloadErrors: 17, rollbacks: 4 },
      },
    ),
    release(
      'release-voice-base-0407',
      'bundle-voice-0407-1',
      '2026.04.07-1',
      null,
      150,
      'api-key:github-actions',
      {
        previousBundleId: 'bundle-voice-0406-2',
        previousBundleVersion: '2026.04.06-2',
        eventCounts: { downloads: 5_704, applied: 5_536, downloadErrors: 39, rollbacks: 6 },
      },
    ),
    release(
      'release-voice-base-0406',
      'bundle-voice-0406-2',
      '2026.04.06-2',
      null,
      2810,
      'api-key:github-actions',
      {
        previousBundleId: 'bundle-voice-0329-7',
        previousBundleVersion: '2026.03.29-7',
        eventCounts: { downloads: 11_908, applied: 11_344, downloadErrors: 83, rollbacks: 24 },
      },
    ),
  ],
  events: [
    event('ev-voice-01', voiceNotesAppId, 'downloaded', 'ios', '2026.04.07-1', 'beta', 105),
    event('ev-voice-02', voiceNotesAppId, 'applied', 'ios', '2026.04.07-1', 'beta', 104),
    event('ev-voice-03', voiceNotesAppId, 'downloaded', 'android', '2026.04.07-1', null, 92),
    event('ev-voice-04', voiceNotesAppId, 'applied', 'android', '2026.04.07-1', null, 90),
    event(
      'ev-voice-05',
      voiceNotesAppId,
      'rollback',
      'android',
      '2026.04.06-2',
      null,
      980,
      'notify_timeout',
    ),
    event(
      'ev-voice-06',
      voiceNotesAppId,
      'rollback',
      'ios',
      '2026.03.29-7',
      'beta',
      1220,
      'app_restarted_before_notify',
    ),
  ],
};

export const dashboardPreviewInitialData: DashboardInitialData = {
  user: {
    id: 'preview-user-marina',
    name: 'Marina Chen',
    email: 'marina@northstar.studio',
  },
  activeOrganization: {
    id: 'preview-org-northstar',
    name: 'Northstar Studio',
    role: 'owner',
  },
  memberships: [
    {
      id: 'membership-northstar',
      organizationId: 'preview-org-northstar',
      organizationName: 'Northstar Studio',
      role: 'owner',
    },
  ],
  apps: [
    {
      id: focusFlowAppId,
      slug: 'com.focusflow.mobile',
      createdAt: atOffset(82_000),
      bundleCount: focusFlowData.bundles.length,
    },
    {
      id: macroTrackAppId,
      slug: 'com.macrotrack.mobile',
      createdAt: atOffset(61_000),
      bundleCount: macroTrackData.bundles.length,
    },
    {
      id: voiceNotesAppId,
      slug: 'com.voicenotes.pro',
      createdAt: atOffset(58_000),
      bundleCount: voiceNotesData.bundles.length,
    },
  ],
  organizationApiKeys: [
    {
      id: 'preview-api-key-main',
      name: 'GitHub Actions',
      keyPrefix: 'otk_live_9f4b',
      createdAt: atOffset(30_000),
      lastUsedAt: atOffset(24),
      revokedAt: null,
    },
    {
      id: 'preview-api-key-release',
      name: 'Release bot',
      keyPrefix: 'otk_live_a12d',
      createdAt: atOffset(12_000),
      lastUsedAt: atOffset(64),
      revokedAt: null,
    },
  ],
};

export const dashboardPreviewData: DashboardPreviewData = {
  appsById: {
    [focusFlowAppId]: focusFlowData,
    [macroTrackAppId]: macroTrackData,
    [voiceNotesAppId]: voiceNotesData,
  },
};
