import Image from 'next/image';
import Link from 'next/link';

import { Separator } from '@/components/ui/separator';

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="m-3 min-h-screen border border-border bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-2xl">
        <div className="mx-auto flex h-14 max-w-screen-xl items-center gap-4 px-6">
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
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/docs" className="text-muted-foreground hover:text-foreground">
              Docs
            </Link>
            <Link href="/blog" className="text-foreground">
              Blog
            </Link>
          </nav>
          <div className="ml-auto">
            <Link
              href="https://console.otakit.app/dashboard"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Dashboard →
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-screen-xl border-x border-border">{children}</main>
    </div>
  );
}
