import Image from 'next/image';
import Link from 'next/link';

import { Separator } from '@/components/ui/separator';

import { DocsMobileNav, DocsSidebar } from './DocsSidebar';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="m-3 min-h-screen border border-border bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-2xl">
        <div className="mx-auto flex h-14 max-w-screen-xl items-center gap-4 px-6">
          <DocsMobileNav />
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold tracking-tight hover:opacity-80"
          >
            <Image
              src="/logo.svg"
              alt="OtaKit"
              width={28}
              height={28}
              className="size-7 rounded-lg"
            />
            OtaKit
          </Link>
          <Separator orientation="vertical" className="h-5" />
          <Link href="/docs" className="text-sm text-muted-foreground hover:text-foreground">
            Docs
          </Link>
          <div className="ml-auto">
            <Link
              href="/dashboard"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Dashboard →
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-screen-xl border-0 sm:border-x sm:border-border">
        <DocsSidebar />
        <main className="min-w-0 flex-1 py-10">
          <div className="px-6 [&>[role=none]]:-mx-6 [&>[role=none]]:w-[calc(100%+3rem)]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
