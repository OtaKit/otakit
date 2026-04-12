export type MemberRole = 'owner' | 'admin' | 'member';
export type Platform = 'ios' | 'android';
export type DeviceEventAction = 'downloaded' | 'applied' | 'download_error' | 'rollback';

export type OrganizationMembership = {
  id: string;
  organizationId: string;
  organizationName: string;
  role: MemberRole;
};

export type AppSummary = {
  id: string;
  slug: string;
  createdAt: string;
  bundleCount: number;
};

export type OrganizationApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type OrganizationMember = {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: MemberRole;
  createdAt: string;
};

export type OrganizationInvite = {
  id: string;
  email: string;
  role: MemberRole;
  createdAt: string;
};

export type DeviceEvent = {
  id: string;
  appId: string;
  action: DeviceEventAction;
  platform: Platform;
  bundleVersion: string | null;
  channel: string | null;
  runtimeVersion: string | null;
  releaseId?: string | null;
  detail: string | null;
  createdAt: string;
};

export type EventCountSummary = {
  downloads: number;
  applied: number;
  downloadErrors: number;
  rollbacks: number;
};

export type BundleSummaryItem = {
  version: string;
  id: string;
  size: number;
  createdAt: string;
  runtimeVersion: string | null;
  isLive: boolean;
  currentTargets: Array<{
    channel: string | null;
    runtimeVersion: string | null;
  }>;
  deployedTargets: Array<{
    channel: string | null;
    runtimeVersion: string | null;
    deployedAt: string;
  }>;
  eventCounts: EventCountSummary;
};

export type ReleaseHistoryItem = {
  id: string;
  channel: string | null;
  runtimeVersion: string | null;
  bundleId: string;
  bundleVersion: string;
  previousBundleId: string | null;
  previousBundleVersion: string | null;
  promotedAt: string;
  promotedBy: string | null;
  revertedAt: string | null;
  revertedBy: string | null;
  eventCounts: EventCountSummary;
};

export type DashboardInitialData = {
  user: { id: string; name: string; email: string };
  activeOrganization: { id: string; name: string; role: MemberRole };
  memberships: OrganizationMembership[];
  apps: AppSummary[];
  organizationApiKeys: OrganizationApiKey[];
};

export type DashboardPreviewAppData = {
  bundles: BundleSummaryItem[];
  releases: ReleaseHistoryItem[];
  events: DeviceEvent[];
};

export type DashboardPreviewData = {
  appsById: Record<string, DashboardPreviewAppData>;
};

export type ApiError = { error?: string };
