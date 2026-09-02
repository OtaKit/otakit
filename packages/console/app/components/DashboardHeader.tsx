import Image from 'next/image';
import Link from 'next/link';

import { BookOpen, LayoutDashboard, Settings } from 'lucide-react';

type DashboardSection = 'dashboard' | 'settings';

export function DashboardHeader({
  activeSection,
  brandHref = '/dashboard',
  dashboardHref = '/dashboard',
  settingsHref = '/dashboard/settings',
  docsHref = 'https://otakit.app/docs',
}: {
  activeSection: DashboardSection;
  brandHref?: string;
  dashboardHref?: string;
  settingsHref?: string;
  docsHref?: string;
}) {
  const navItems = [
    {
      section: 'dashboard' as const,
      label: 'Dashboard',
      href: dashboardHref,
      icon: LayoutDashboard,
    },
    { section: 'settings' as const, label: 'Settings', href: settingsHref, icon: Settings },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-2xl">
      <div className="mx-auto flex h-14 max-w-screen-xl items-center gap-4 px-6">
        {/* Brand */}
        <Link href={brandHref} className="flex items-center gap-2">
          <Image
            src="/logo.svg"
            alt="OtaKit"
            width={28}
            height={28}
            className="size-7 rounded-lg"
          />
          <span className="text-sm font-semibold tracking-tight">OtaKit</span>
        </Link>

        {/* Nav */}
        <nav className="ml-auto flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.section;
            return (
              <Link
                key={item.section}
                href={item.href}
                className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors sm:px-3 ${
                  isActive
                    ? 'bg-accent font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                }`}
              >
                <Icon className="size-3.5" />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Docs */}
        <Link
          href={docsHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <BookOpen className="size-3.5" />
          <span className="hidden sm:inline">Docs</span>
        </Link>
      </div>
    </header>
  );
}
