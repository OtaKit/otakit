'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

const NAV = [
  {
    title: 'Getting Started',
    links: [
      { label: 'Overview', href: '/docs' },
      { label: 'Setup', href: '/docs/setup' },
    ],
  },
  {
    title: 'Reference',
    links: [
      { label: 'CLI Reference', href: '/docs/cli' },
      { label: 'Plugin API', href: '/docs/plugin' },
      { label: 'REST API', href: '/docs/api' },
    ],
  },
  {
    title: 'Guides',
    links: [
      { label: 'Next.js Guide', href: '/docs/guide' },
      { label: 'React Guide', href: '/docs/react' },
      { label: 'Loading Screen', href: '/docs/loading-screen' },
      { label: 'Channels & Runtime Version', href: '/docs/channels' },
      { label: 'CI automation', href: '/docs/ci' },
      { label: 'Self-hosting', href: '/docs/self-host' },
    ],
  },
];

function NavLinks({ onClick }: { onClick?: () => void }) {
  const pathname = usePathname();
  const isLlms = pathname === '/docs/llms.txt';

  return (
    <div className="text-sm">
      {NAV.map((section, index) => (
        <div key={section.title}>
          {index > 0 && <Separator className="my-4" />}
          <div className="px-5">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {section.title}
            </h4>
            <ul className="space-y-1">
              {section.links.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      onClick={onClick}
                      className={`block rounded-md px-2 py-1.5 text-sm transition-colors ${
                        isActive
                          ? 'bg-muted font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      {link.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ))}
      <Separator className="my-4" />
      <div className="px-5">
        <Link
          href="/docs/security"
          onClick={onClick}
          className={`mb-1 block rounded-md px-2 py-1.5 text-sm transition-colors ${
            pathname === '/docs/security'
              ? 'bg-muted font-medium text-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          Security
        </Link>
        <Link
          href="/contact"
          onClick={onClick}
          className="mb-1 block rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Contact support
        </Link>
        <Link
          href="https://github.com/OtaKit/otakit"
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClick}
          className="mb-1 block rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          GitHub
        </Link>
        <Link
          href="/docs/llms.txt"
          onClick={onClick}
          className={`block rounded-md px-2 py-1.5 text-sm transition-colors ${
            isLlms
              ? 'bg-muted font-medium text-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          llms.txt
        </Link>
      </div>
    </div>
  );
}

/** Desktop sidebar — hidden below lg */
export function DocsSidebar() {
  return (
    <nav className="hidden w-56 shrink-0 border-r border-border lg:block">
      <div className="sticky top-14 py-8">
        <NavLinks />
      </div>
    </nav>
  );
}

/** Mobile trigger + sheet — visible below lg */
export function DocsMobileNav() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="lg:hidden">
          <Menu className="size-4" />
          <span className="sr-only">Navigation</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-64 overflow-y-auto p-6">
        <SheetTitle className="sr-only">Documentation navigation</SheetTitle>
        <NavLinks />
      </SheetContent>
    </Sheet>
  );
}
