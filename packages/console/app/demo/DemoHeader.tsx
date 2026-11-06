import Image from 'next/image';
import Link from 'next/link';
import { BookOpen } from 'lucide-react';

import { Button } from '@/components/ui/button';

/** The console header for the demo: no workspace navigation, a way to start. */
export function DemoHeader({ siteUrl }: { siteUrl: string }) {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-2xl">
      <div className="mx-auto flex h-14 max-w-screen-xl items-center gap-3 px-6">
        <Link href={siteUrl} className="flex items-center gap-2">
          <Image
            src="/logo.svg"
            alt="OtaKit"
            width={28}
            height={28}
            className="size-7 rounded-lg"
          />
          <span className="text-sm font-semibold tracking-tight">OtaKit</span>
        </Link>
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          Live demo
        </span>
        <div className="ml-auto flex items-center gap-4">
          <Link
            href={`${siteUrl}/docs`}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:flex"
          >
            <BookOpen className="size-3.5" />
            Docs
          </Link>
          <Button asChild size="sm" className="rounded-full px-4">
            <Link href="/login">Start free</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
