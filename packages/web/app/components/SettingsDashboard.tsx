'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  ArrowUpRight,
  Building2,
  CreditCard,
  LogOut,
  Mail,
  MessageSquare,
  Pencil,
  Plus,
  LoaderCircle,
  Send,
  Shield,
  Trash2,
  UserPlus,
  Users,
  Lock,
} from 'lucide-react';
import { toast } from 'sonner';

import { DashboardHeader } from '@/app/components/DashboardHeader';
import {
  PricingDialog,
  type PlanKey,
  type PricingDialogBillingData,
} from '@/app/components/PricingDialog';
import { OrganizationKeyAdmin } from '@/app/components/OrganizationKeyAdmin';
import { authClient } from '@/lib/auth-client';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/support';
import type {
  ApiError,
  DashboardInitialData,
  MemberRole,
  OrganizationInvite,
  OrganizationMember,
} from '@/app/components/dashboard-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

type UsagePayload = {
  usage: {
    periodStart: string;
    downloadsCount: number;
    limit: number;
    percentage: number;
    usageBlocked: boolean;
    overageEnabled: boolean;
    warningSent: 'none' | 'at90' | 'at100';
  };
};

export function SettingsDashboard({ initialData }: { initialData: DashboardInitialData }) {
  const router = useRouter();
  const canManageTeam =
    initialData.activeOrganization.role === 'owner' ||
    initialData.activeOrganization.role === 'admin';
  const canRenameActiveOrg = canManageTeam;

  const [teamMembers, setTeamMembers] = useState<OrganizationMember[]>([]);
  const [pendingInvites, setPendingInvites] = useState<OrganizationInvite[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(false);

  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<MemberRole>('member');
  const [submittingInvite, setSubmittingInvite] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [removingInviteId, setRemovingInviteId] = useState<string | null>(null);

  // Billing
  const [billingData, setBillingData] = useState<{
    billing: {
      planKey: PlanKey;
      isActive?: boolean;
      polarCustomerId: string | null;
    };
  } | null>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [usageData, setUsageData] = useState<UsagePayload | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [savingOverage, setSavingOverage] = useState(false);
  const [pricingDialogOpen, setPricingDialogOpen] = useState(false);

  const [newOrgDialogOpen, setNewOrgDialogOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [renameOrgDialogOpen, setRenameOrgDialogOpen] = useState(false);
  const [renameOrganizationId, setRenameOrganizationId] = useState<string | null>(null);
  const [renameOrgName, setRenameOrgName] = useState('');
  const [renamingOrg, setRenamingOrg] = useState(false);
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [switchingOrganizationId, setSwitchingOrganizationId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const isSwitchingOrganization = switchingOrganizationId !== null;
  const pricingDialogBillingData = useMemo<PricingDialogBillingData | null>(() => {
    if (!billingData) return null;
    return {
      billing: {
        planKey: billingData.billing.planKey,
        polarCustomerId: billingData.billing.polarCustomerId,
      },
    };
  }, [billingData?.billing.planKey, billingData?.billing.polarCustomerId]);

  const loadTeamData = useCallback(async () => {
    setLoadingTeam(true);
    try {
      const [membersResponse, invitesResponse] = await Promise.all([
        fetch('/api/v1/organization/members'),
        fetch('/api/v1/organization/invites'),
      ]);
      const membersData = await parseJson<{ members?: OrganizationMember[] } & ApiError>(
        membersResponse,
      );
      const invitesData = await parseJson<{ invites?: OrganizationInvite[] } & ApiError>(
        invitesResponse,
      );
      if (!membersResponse.ok) throw new Error(membersData.error ?? 'Failed to load members');
      if (!invitesResponse.ok) throw new Error(invitesData.error ?? 'Failed to load invites');
      setTeamMembers(membersData.members ?? []);
      setPendingInvites(invitesData.invites ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load team');
    } finally {
      setLoadingTeam(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function syncOrganizationData() {
      await loadTeamData();
      if (cancelled) return;
      setSwitchingOrganizationId((current) =>
        current === initialData.activeOrganization.id ? null : current,
      );
    }

    void syncOrganizationData();

    return () => {
      cancelled = true;
    };
  }, [loadTeamData, initialData.activeOrganization.id]);

  // Load billing summary for the settings subscription row.
  useEffect(() => {
    async function loadBilling() {
      try {
        const [billingRes, usageRes] = await Promise.all([
          fetch('/api/v1/organization/billing/refresh', { method: 'POST' }),
          fetch('/api/v1/organization/billing/usage'),
        ]);
        if (billingRes.ok) {
          const data = await billingRes.json();
          setBillingData(data);
        }
        if (usageRes.ok) {
          const data = await usageRes.json();
          setUsageData(data);
        }
      } catch {
        // Billing unavailable — show section without data
      } finally {
        setBillingLoading(false);
        setUsageLoading(false);
      }
    }
    void loadBilling();
  }, [initialData.activeOrganization.id]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('pricing') === '1' || params.get('checkout') === 'success') {
      setPricingDialogOpen(true);
    }
  }, [initialData.activeOrganization.id]);

  async function inviteMember() {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return toast.error('Email is required');
    setSubmittingInvite(true);
    toast.dismiss();
    try {
      const response = await fetch('/api/v1/organization/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      const data = await parseJson<ApiError & { invite?: { accepted?: boolean } }>(response);
      if (!response.ok) throw new Error(data.error ?? 'Failed to invite');
      setInviteEmail('');
      setInviteRole('member');
      setInviteDialogOpen(false);
      toast.success(data.invite?.accepted ? 'Member added' : 'Invite sent');
      await loadTeamData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to invite');
    } finally {
      setSubmittingInvite(false);
    }
  }

  async function removeMember(memberId: string) {
    setRemovingMemberId(memberId);
    toast.dismiss();
    try {
      const response = await fetch(`/api/v1/organization/members/${memberId}/remove`, {
        method: 'POST',
      });
      const data = await parseJson<ApiError>(response);
      if (!response.ok) throw new Error(data.error ?? 'Failed to remove');
      toast.success('Member removed');
      await loadTeamData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove');
    } finally {
      setRemovingMemberId(null);
    }
  }

  async function removeInvite(inviteId: string) {
    setRemovingInviteId(inviteId);
    toast.dismiss();
    try {
      const response = await fetch(`/api/v1/organization/invites/${inviteId}`, {
        method: 'DELETE',
      });
      const data = await parseJson<ApiError>(response);
      if (!response.ok) throw new Error(data.error ?? 'Failed to remove invite');
      toast.success('Invite removed');
      await loadTeamData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove invite');
    } finally {
      setRemovingInviteId(null);
    }
  }

  async function switchOrganization(organizationId: string) {
    if (!organizationId || organizationId === initialData.activeOrganization.id) return;
    setSwitchingOrganizationId(organizationId);
    toast.dismiss();
    try {
      const response = await fetch('/api/v1/me/active-organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      const data = await parseJson<ApiError>(response);
      if (!response.ok) throw new Error(data.error ?? 'Failed to switch');
      router.refresh();
    } catch (error) {
      setSwitchingOrganizationId(null);
      toast.error(error instanceof Error ? error.message : 'Failed to switch');
    }
  }

  async function createOrg() {
    const name = newOrgName.trim();
    if (!name) return toast.error('Name is required');
    setCreatingOrg(true);
    toast.dismiss();
    try {
      const response = await fetch('/api/v1/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await parseJson<ApiError>(response);
      if (!response.ok) throw new Error(data.error ?? 'Failed to create');
      setNewOrgName('');
      setNewOrgDialogOpen(false);
      toast.success('Organization created');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create organization');
    } finally {
      setCreatingOrg(false);
    }
  }

  function openRenameOrgDialog(organizationId: string, organizationName: string) {
    setRenameOrganizationId(organizationId);
    setRenameOrgName(organizationName);
    setRenameOrgDialogOpen(true);
  }

  async function renameOrg() {
    if (!renameOrganizationId) return;

    const name = renameOrgName.trim();
    if (!name) return toast.error('Name is required');

    setRenamingOrg(true);
    toast.dismiss();
    try {
      const response = await fetch(
        `/api/v1/organizations/${encodeURIComponent(renameOrganizationId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        },
      );
      const data = await parseJson<ApiError>(response);
      if (!response.ok) throw new Error(data.error ?? 'Failed to rename organization');
      setRenameOrgDialogOpen(false);
      setRenameOrganizationId(null);
      setRenameOrgName('');
      toast.success('Organization renamed');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to rename organization');
    } finally {
      setRenamingOrg(false);
    }
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await authClient.signOut();
      router.push('/login');
    } finally {
      setSigningOut(false);
    }
  }

  async function toggleOverage(checked: boolean) {
    if (!canManageTeam) return;
    setSavingOverage(true);
    try {
      const response = await fetch('/api/v1/organization/billing/usage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overageEnabled: checked }),
      });
      const data = await parseJson<ApiError & Partial<UsagePayload>>(response);
      if (!response.ok || !data.usage) {
        throw new Error(data.error ?? 'Failed to update usage settings');
      }
      setUsageData({ usage: data.usage });
      toast.success(checked ? 'Additional usage enabled' : 'Additional usage disabled');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update usage settings');
    } finally {
      setSavingOverage(false);
    }
  }

  async function sendFeedback() {
    const message = feedbackMessage.trim();
    if (message.length < 10) {
      toast.error('Feedback must be at least 10 characters');
      return;
    }

    setSendingFeedback(true);
    toast.dismiss();
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: initialData.user.name,
          email: initialData.user.email,
          subject: `Dashboard feedback — ${initialData.activeOrganization.name}`,
          message: `${message}

---
Page: dashboard/settings
Organization: ${initialData.activeOrganization.name} (${initialData.activeOrganization.id})
User: ${initialData.user.name} <${initialData.user.email}>
User ID: ${initialData.user.id}`,
        }),
      });

      const data = await parseJson<ApiError & { ok?: boolean }>(response);
      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to send feedback');
      }

      setFeedbackMessage('');
      setFeedbackDialogOpen(false);
      toast.success('Feedback sent');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to send feedback');
    } finally {
      setSendingFeedback(false);
    }
  }

  const membershipRows = useMemo(() => initialData.memberships, [initialData.memberships]);
  return (
    <div className="m-3 min-h-screen border border-border bg-background">
      <DashboardHeader activeSection="settings" />

      <main className="relative flex min-h-[calc(100vh-3.5rem)] flex-col">
        <div className="pointer-events-none absolute inset-0 hidden justify-center sm:flex">
          <div className="h-full w-full max-w-3xl border-x border-border" />
        </div>
        <div className="relative flex min-h-[calc(100vh-3.5rem)] flex-col">
          <section className="">
            <div className="mx-auto max-w-3xl">
              <div className="border-b border-border p-5">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Mail className="size-4 text-muted-foreground" />
                  Profile
                </h2>
              </div>
              <div className="flex items-center gap-4 p-5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{initialData.user.email}</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-8 shrink-0"
                  onClick={() => void signOut()}
                  disabled={signingOut}
                >
                  <LogOut className="size-3.5" />
                  {signingOut ? 'Signing out...' : 'Sign out'}
                </Button>
              </div>
            </div>
          </section>

          <Separator />

          <section className="">
            <div className="mx-auto max-w-3xl">
              <div className="flex items-center justify-between border-b border-border p-5">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Building2 className="size-4 text-muted-foreground" />
                  Organization
                </h2>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-16 justify-center"
                  onClick={() => setNewOrgDialogOpen(true)}
                >
                  <Plus className="size-3.5" />
                  New
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2 p-5 pl-4">
                <Select
                  value={initialData.activeOrganization.id}
                  onValueChange={(value) => void switchOrganization(value)}
                  disabled={isSwitchingOrganization}
                >
                  <SelectTrigger className="h-8 w-56 border-0 bg-transparent px-2 font-semibold shadow-none hover:bg-accent">
                    <SelectValue placeholder="Select organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {membershipRows.map((membership) => (
                      <SelectItem key={membership.organizationId} value={membership.organizationId}>
                        {membership.organizationName} ({membership.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {canRenameActiveOrg ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-7 p-0 ml-auto"
                    title="Rename current organization"
                    onClick={() =>
                      openRenameOrgDialog(
                        initialData.activeOrganization.id,
                        initialData.activeOrganization.name,
                      )
                    }
                    disabled={isSwitchingOrganization}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            </div>
          </section>

          <Separator />

          {isSwitchingOrganization || loadingTeam || billingLoading || usageLoading ? (
            <div className="flex items-center justify-center py-24">
              <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <section className="">
                <div className="mx-auto max-w-3xl">
                  <div className="border-b border-border p-5">
                    <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                      <CreditCard className="size-4 text-muted-foreground" />
                      Subscription
                    </h2>
                  </div>
                  <div className="p-5">
                    <div className="flex items-center justify-between gap-4 py-3">
                      <div>
                        <div className="text-sm font-medium">
                          {billingData?.billing.planKey === 'pro'
                            ? 'Pro'
                            : billingData?.billing.planKey === 'scale'
                              ? 'Scale'
                              : 'Starter (Free)'}
                        </div>
                      </div>
                      {canManageTeam ? (
                        <div className="flex shrink-0 gap-2">
                          <Button
                            size="sm"
                            className="h-8"
                            onClick={() => setPricingDialogOpen(true)}
                          >
                            <ArrowUpRight className="size-3.5" />
                            Upgrade subscription
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    <Separator />
                    <div className="py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">Usage this month</div>
                          <div className="text-xs text-muted-foreground">
                            {usageData
                              ? `${usageData.usage.downloadsCount.toLocaleString()} / ${usageData.usage.limit.toLocaleString()} downloads`
                              : 'No usage data'}
                          </div>
                        </div>
                        {usageData ? (
                          <Badge variant="secondary" className="text-xs">
                            {Math.max(0, usageData.usage.percentage)}%
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-3 h-2 rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-foreground/80"
                          style={{
                            width: `${Math.min(100, Math.max(0, usageData?.usage.percentage ?? 0))}%`,
                          }}
                        />
                      </div>
                      {billingData?.billing.planKey === 'scale' ? (
                        <div className="mt-3 flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium">Enable additional usage</div>
                            <div className="text-xs text-muted-foreground">
                              Continue delivering updates after included monthly usage is exhausted.
                            </div>
                          </div>
                          <Switch
                            checked={usageData?.usage.overageEnabled ?? false}
                            onCheckedChange={(checked) => void toggleOverage(checked)}
                            disabled={!canManageTeam || savingOverage}
                          />
                        </div>
                      ) : null}
                      {usageData?.usage.usageBlocked ? (
                        <p className="mt-3 text-xs text-destructive">
                          Downloads are currently blocked because usage exceeded your plan limit.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </section>

              <Separator />

              <section className="">
                <div className="mx-auto max-w-3xl">
                  <div className="flex items-center justify-between border-b border-border p-5">
                    <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                      <Users className="size-4 text-muted-foreground" />
                      Members
                    </h2>
                    {canManageTeam ? (
                      billingData?.billing.planKey === 'starter' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs justify-center hidden sm:flex"
                          disabled
                        >
                          <Lock className="size-3.5" />
                          Upgrade subscription to invite team members
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 w-40 justify-center"
                          onClick={() => setInviteDialogOpen(true)}
                        >
                          <UserPlus className="size-3.5" />
                          Invite member
                        </Button>
                      )
                    ) : null}
                  </div>

                  {teamMembers.length === 0 ? (
                    <div className="m-5 rounded-lg border border-dashed py-12 text-center">
                      <Users className="mx-auto size-6 text-muted-foreground/40" />
                      <p className="mt-3 text-sm font-medium">No members yet</p>
                      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                        Invite team members to collaborate on your apps.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-hidden">
                      <Table>
                        <TableBody>
                          {teamMembers.map((member) => (
                            <TableRow key={member.id} className="h-12">
                              <TableCell>
                                <div className="min-w-0 pl-5">
                                  <div className="truncate text-sm">{member.email}</div>
                                </div>
                              </TableCell>
                              <TableCell className="w-24">
                                <Badge
                                  variant={member.role === 'owner' ? 'secondary' : 'secondary'}
                                  className="text-xs font-normal"
                                >
                                  {member.role === 'owner' ? (
                                    <Shield className="mr-0.5 size-2.5" />
                                  ) : null}
                                  {member.role}
                                </Badge>
                              </TableCell>
                              <TableCell className="hidden w-32 text-right text-xs text-muted-foreground sm:table-cell">
                                {formatDate(member.createdAt)}
                              </TableCell>
                              {canManageTeam ? (
                                <TableCell className="w-10 text-right">
                                  {member.role !== 'owner' ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="size-7 p-0 text-muted-foreground hover:text-destructive"
                                      onClick={() => {
                                        if (confirm(`Remove ${member.email}?`))
                                          void removeMember(member.id);
                                      }}
                                      disabled={removingMemberId === member.id}
                                      title="Remove member"
                                    >
                                      {removingMemberId === member.id ? (
                                        <LoaderCircle className="size-3.5 animate-spin" />
                                      ) : (
                                        <Trash2 className="size-3.5" />
                                      )}
                                    </Button>
                                  ) : null}
                                </TableCell>
                              ) : null}
                            </TableRow>
                          ))}

                          {pendingInvites.map((invite) => (
                            <TableRow key={invite.id} className="h-12 opacity-60">
                              <TableCell>
                                <div className="min-w-0">
                                  <div className="truncate text-sm">{invite.email}</div>
                                </div>
                              </TableCell>
                              <TableCell className="w-24">
                                <Badge variant="outline" className="text-xs font-normal">
                                  {invite.role}
                                </Badge>
                              </TableCell>
                              <TableCell className="hidden w-32 text-right text-xs text-muted-foreground sm:table-cell">
                                Invited {formatDate(invite.createdAt)}
                              </TableCell>
                              {canManageTeam ? (
                                <TableCell className="w-10 text-right">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="size-7 p-0 text-muted-foreground hover:text-destructive"
                                    disabled={removingInviteId === invite.id}
                                    onClick={() => {
                                      if (confirm(`Remove invite for ${invite.email}?`))
                                        void removeInvite(invite.id);
                                    }}
                                  >
                                    {removingInviteId === invite.id ? (
                                      <LoaderCircle className="size-3.5 animate-spin" />
                                    ) : (
                                      <Trash2 className="size-3.5" />
                                    )}
                                  </Button>
                                </TableCell>
                              ) : null}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </section>

              <Separator />

              <section className="h-full">
                <div className="mx-auto max-w-3xl h-full">
                  <OrganizationKeyAdmin
                    key={initialData.activeOrganization.id}
                    initialKeys={initialData.organizationApiKeys}
                  />
                </div>
              </section>

              <Separator />

              <section className="flex-1">
                <div className="mx-auto h-full max-w-3xl" />
              </section>
            </>
          )}
        </div>
      </main>

      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="size-4" />
              Invite member
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="teammate@example.com"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void inviteMember();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select
                value={inviteRole}
                onValueChange={(value) => setInviteRole(value as MemberRole)}
              >
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  {initialData.activeOrganization.role === 'owner' ? (
                    <SelectItem value="owner">Owner</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void inviteMember()}
              disabled={submittingInvite || !inviteEmail.trim()}
            >
              {submittingInvite ? (
                <>
                  <LoaderCircle className="size-3.5 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <UserPlus className="size-3.5" />
                  Invite
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOrgDialogOpen} onOpenChange={setRenameOrgDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="size-4" />
              Rename organization
            </DialogTitle>
            <DialogDescription>Update the organization name for all members.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-org-name">Organization name</Label>
            <Input
              id="rename-org-name"
              value={renameOrgName}
              onChange={(event) => setRenameOrgName(event.target.value)}
              placeholder="My team"
              onKeyDown={(event) => {
                if (event.key === 'Enter') void renameOrg();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (renamingOrg) return;
                setRenameOrgDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void renameOrg()}
              disabled={renamingOrg || !renameOrgName.trim()}
            >
              {renamingOrg ? (
                <>
                  <LoaderCircle className="size-3.5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Pencil className="size-3.5" />
                  Save name
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newOrgDialogOpen} onOpenChange={setNewOrgDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="size-4" />
              Create organization
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-org-name">Organization name</Label>
            <Input
              id="new-org-name"
              value={newOrgName}
              onChange={(event) => setNewOrgName(event.target.value)}
              placeholder="My team"
              onKeyDown={(event) => {
                if (event.key === 'Enter') void createOrg();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOrgDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void createOrg()} disabled={creatingOrg || !newOrgName.trim()}>
              {creatingOrg ? (
                <>
                  <LoaderCircle className="size-3.5 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="size-3.5" />
                  Create
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PricingDialog
        open={pricingDialogOpen}
        onOpenChange={setPricingDialogOpen}
        canManageBilling={canManageTeam}
        initialBillingData={pricingDialogBillingData}
        onBillingDataChange={(nextBillingData) => {
          setBillingData((current) => {
            if (!current) {
              return {
                billing: {
                  ...nextBillingData.billing,
                  isActive: nextBillingData.billing.planKey !== 'starter',
                },
              };
            }
            return {
              billing: {
                ...current.billing,
                ...nextBillingData.billing,
              },
            };
          });
        }}
      />

      <Button
        type="button"
        size="sm"
        className="fixed bottom-6 right-6 z-40 rounded-full px-4 shadow-lg"
        onClick={() => setFeedbackDialogOpen(true)}
      >
        <MessageSquare className="size-4" />
        Send feedback
      </Button>

      <Dialog
        open={feedbackDialogOpen}
        onOpenChange={(open) => {
          if (!sendingFeedback) {
            setFeedbackDialogOpen(open);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="size-4" />
              Send feedback
            </DialogTitle>
            <DialogDescription>
              Or email us at{' '}
              <a
                href={SUPPORT_MAILTO}
                className="underline underline-offset-4 hover:text-foreground"
              >
                {SUPPORT_EMAIL}
              </a>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="settings-feedback">Message</Label>
            <Textarea
              id="settings-feedback"
              value={feedbackMessage}
              onChange={(event) => setFeedbackMessage(event.target.value)}
              placeholder="What should be improved, changed, or clarified?"
              className="min-h-36 resize-y"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFeedbackDialogOpen(false)}
              disabled={sendingFeedback}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void sendFeedback()}
              disabled={sendingFeedback || feedbackMessage.trim().length < 10}
            >
              {sendingFeedback ? (
                <>
                  <LoaderCircle className="size-3.5 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="size-3.5" />
                  Send feedback
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
