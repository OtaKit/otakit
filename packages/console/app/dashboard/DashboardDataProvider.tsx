'use client';

import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';

import type { DashboardInitialData } from '@/app/components/dashboard-types';

const DashboardDataContext = createContext<DashboardInitialData | null>(null);

export function DashboardDataProvider({
  initialData,
  children,
}: {
  initialData: DashboardInitialData;
  children: ReactNode;
}) {
  const searchParams = useSearchParams();
  const requested = searchParams.get('org');
  const switching =
    requested !== null &&
    requested !== initialData.activeOrganization.id &&
    initialData.memberships.some((membership) => membership.organizationId === requested);

  return (
    <DashboardDataContext.Provider value={initialData}>
      <WorkspaceFromUrl initialData={initialData} />
      {switching ? (
        <div className="flex min-h-screen items-center justify-center">
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        children
      )}
    </DashboardDataContext.Provider>
  );
}

/**
 * Links from notifications carry `?org=` so they open in the right workspace:
 * switch to it when it is another of the user's workspaces, then drop the
 * parameter so the URL stays clean.
 */
function WorkspaceFromUrl({ initialData }: { initialData: DashboardInitialData }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get('org');
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (requested === null) return;
    const withoutOrg = () => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete('org');
      const query = params.toString();
      return `${pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    };

    // Already there (also right after a switch refreshed the data): clean the URL.
    if (requested === initialData.activeOrganization.id) {
      router.replace(withoutOrg(), { scroll: false });
      return;
    }
    if (!initialData.memberships.some((membership) => membership.organizationId === requested)) {
      // The Toaster mounts after the page on a full load; a toast sent before
      // it subscribes is lost, so send it after this commit.
      setTimeout(() => toast.error('That link is for a workspace you are not a member of.'), 0);
      router.replace(withoutOrg(), { scroll: false });
      return;
    }
    if (handled.current === requested) return;
    handled.current = requested;
    // Refresh with `org` still in the URL, so the loader stays up until the new
    // workspace's data has arrived.
    void fetch('/api/v1/me/active-organization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: requested }),
    })
      .then((response) => {
        if (!response.ok) throw new Error('Could not switch workspace');
        router.refresh();
      })
      .catch(() => {
        setTimeout(
          () => toast.error('Could not open that workspace. Switch to it in Settings.'),
          0,
        );
        router.replace(withoutOrg(), { scroll: false });
      });
  }, [requested, initialData, pathname, router, searchParams]);

  return null;
}

export function useDashboardData(): DashboardInitialData {
  const data = useContext(DashboardDataContext);
  if (!data) {
    throw new Error('useDashboardData must be used within DashboardDataProvider');
  }
  return data;
}
