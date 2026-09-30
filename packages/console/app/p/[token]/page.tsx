import type { Metadata } from 'next';
import Image from 'next/image';

import { Button } from '@/components/ui/button';
import { getPublicPreview } from '@/lib/services/previews';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Preview · OtaKit',
  robots: { index: false, follow: false },
};

function formatExpiry(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(value));
}

/**
 * Public page behind a preview link and its QR code. The token in the URL is
 * the capability, so nothing here is guessable, and the page shows no more
 * than the app, the bundle version and when the link expires.
 */
export default async function PreviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = await getPublicPreview(token);
  const active = preview?.status === 'active';

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,var(--color-border)_1.5px,transparent_1.5px)] bg-[size:28px_28px] opacity-60"
        aria-hidden="true"
      />
      <main className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
        <div className="mb-6 flex items-center gap-2">
          <Image
            src="/logo.svg"
            alt="OtaKit"
            width={28}
            height={28}
            className="size-7 rounded-lg"
          />
          <span className="text-sm font-semibold tracking-tight">OtaKit preview</span>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          {preview && active ? (
            <>
              <h1 className="text-lg font-semibold tracking-tight">{preview.appSlug}</h1>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Bundle</dt>
                <dd className="font-mono">{preview.bundleVersion}</dd>
                {preview.runtimeVersion ? (
                  <>
                    <dt className="text-muted-foreground">Runtime</dt>
                    <dd className="font-mono">{preview.runtimeVersion}</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Expires</dt>
                <dd>{formatExpiry(preview.expiresAt)}</dd>
              </dl>

              <div className="mt-6 hidden flex-col items-center gap-2 sm:flex">
                {/* eslint-disable-next-line @next/next/no-img-element -- generated per link */}
                <img
                  src={`/p/${token}/qr.png`}
                  alt="QR code for this preview"
                  width={224}
                  height={224}
                  className="size-56 rounded-lg border border-border bg-white p-2"
                />
                <p className="text-xs text-muted-foreground">Scan with your phone&apos;s camera.</p>
              </div>

              {preview.deepLink ? (
                <div className="mt-6 flex flex-col gap-2">
                  <Button asChild size="lg">
                    <a href={preview.deepLink}>Open in the app</a>
                  </Button>
                  {preview.exitLink ? (
                    <Button asChild variant="outline" size="lg">
                      <a href={preview.exitLink}>Exit preview</a>
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p className="mt-6 text-sm text-muted-foreground">
                  Opening previews is not set up for this app yet. Add the app&apos;s URL scheme
                  when you create a preview link.
                </p>
              )}

              <p className="mt-6 text-xs text-muted-foreground">
                Opens in builds of the app with OtaKit plugin 3.2 or later and preview links
                enabled. Only web code changes. The app returns to its normal release when you exit
                or the link expires.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold tracking-tight">
                This preview link has expired or was revoked
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">Ask for a new link.</p>
              {preview?.exitLink ? (
                <Button asChild variant="outline" size="lg" className="mt-6 w-full">
                  <a href={preview.exitLink}>Exit preview</a>
                </Button>
              ) : null}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
