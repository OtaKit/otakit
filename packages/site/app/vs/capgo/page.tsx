import Link from 'next/link';

import { ComparisonLanding, Code, type ComparisonCopy } from '../_components/ComparisonLanding';
import { site } from '@/lib/site';

export const metadata = {
  title: { absolute: 'Capgo Alternative — OtaKit | Live Updates for Capacitor' },
  description:
    'OtaKit is the Capgo alternative with full OTA feature parity — delta updates, channels, auto-rollback, E2E encryption — delivered from Cloudflare’s CDN at a fraction of the price. No MAU, bandwidth, or storage billing.',
  alternates: { canonical: `${site.url}/vs/capgo` },
};

function GuideLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-foreground underline underline-offset-4">
      {children}
    </Link>
  );
}

const copy: ComparisonCopy = {
  competitor: 'Capgo',
  heroTitle: 'Ship app updates instantly',
  heroSub: (
    <>
      Push over-the-air (OTA) updates directly to your Capacitor app without app store reviews —{' '}
      <mark className="rounded-sm bg-yellow-200 px-1 text-yellow-950">
        the simpler, cheaper Capgo alternative
      </mark>
      .
    </>
  ),
  migrationNote: (
    <>
      The APIs map almost one-to-one — most apps switch in an afternoon.{' '}
      <GuideLink href="/blog/migrate-from-capgo-and-capawesome">Migration guide →</GuideLink>
    </>
  ),
  featuresTitle: 'Full feature parity for OTA updates',
  featuresSub: 'Everything you use Capgo for, on every plan.',
  priceComparison: {
    rows: [
      ['2,000 users', '$0', '$12'],
      ['50,000 users', '$25', '$83'],
      ['250,000 users', '$25', '$208+'],
    ],
    href: '/blog/capgo-alternative',
  },
  ctaTitle: 'Ready to switch?',
  ctaSub: 'Same live updates, one simple bill — migration takes an afternoon.',
  faq: [
    {
      q: 'Why is OtaKit better than Capgo?',
      a: (
        <>
          <p>
            One fundamental, technical difference: OtaKit distributes every update over{' '}
            <strong>Cloudflare’s global CDN</strong>. Your users’ devices never touch OtaKit’s own
            servers — they pull bundles straight from Cloudflare’s edge, 100%.
          </p>
          <p>That has three consequences:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Reliability isn’t capped by our uptime.</strong> Delivery runs on Cloudflare’s
              edge — one of the most resilient networks on earth — not on a server we operate.
            </li>
            <li>
              <strong>Updates are fast everywhere.</strong> Every device downloads from the nearest
              edge node worldwide, not from a single origin region.
            </li>
            <li>
              <strong>It’s far cheaper.</strong> We don’t run or mark up bandwidth-heavy origin
              infrastructure, so we price at a fraction of the alternatives — billed on updates
              delivered, not seats, devices, bandwidth, or storage.
            </li>
          </ul>
        </>
      ),
    },
    {
      q: 'How does OtaKit pricing compare to Capgo?',
      a: (
        <>
          <p>
            Capgo bills on three meters — monthly active users, bandwidth, and storage — so every
            active device counts against your plan every month, even if you ship nothing. OtaKit
            bills on one meter: <strong>updates delivered</strong>. Free covers 5,000
            updates/month with unlimited apps; Starter is $10/mo for 100,000, and Pro starts at
            $25/mo for 1 million.
          </p>
          <p>
            In practice: 10,000 users at 2 releases/mo is $10 on OtaKit vs $33 on Capgo; 50,000
            users at 4 releases/mo is $25 vs $83; 500,000 users is $75 vs $208+. The{' '}
            <GuideLink href="/blog/capgo-alternative">full comparison</GuideLink> shows the math.
          </p>
        </>
      ),
    },
    {
      q: 'Does OtaKit match Capgo feature for feature?',
      a: (
        <>
          <p>
            For OTA updates, yes: delta updates, channel-based releases with runtime switching,
            automatic rollback via <Code>notifyAppReady()</Code>, emergency{' '}
            <Code>--force-immediate</Code> releases, and optional end-to-end encryption
            (AES-256-GCM, your key) are all included.
          </p>
          <p>
            One scope difference: Capgo also sells native builds and store publishing. OtaKit is
            deliberately OTA-only — if you already have CI, you already have the rest.
          </p>
        </>
      ),
    },
    {
      q: 'How do I migrate from Capgo?',
      a: (
        <>
          <p>
            The concepts map almost one-to-one — <Code>defaultChannel</Code> becomes{' '}
            <Code>channel</Code>, <Code>notifyAppReady()</Code> and <Code>setChannel()</Code> keep
            their names, and Capgo’s <Code>directUpdate</Code> timing options translate directly to
            OtaKit’s launch and resume policies. Swap the plugin, build, and upload.
          </p>
          <p>
            The <GuideLink href="/blog/migrate-from-capgo-and-capawesome">migration guide</GuideLink>{' '}
            covers the exact config translation, the API mapping table, and a production cutover
            plan that keeps your existing install base updating safely.
          </p>
        </>
      ),
    },
    {
      q: 'Are OTA updates allowed?',
      a: (
        <p>
          Yes. Updating the web layer of a Capacitor app is explicitly permitted — Apple’s
          Developer Program License Agreement <strong>§3.3.1(B)</strong> allows downloaded
          JavaScript that runs in the system web view, and Google Play permits the same. OtaKit
          never touches native binaries, so your releases stay compliant.
        </p>
      ),
    },
    {
      q: 'What happens if I ship a broken update?',
      a: (
        <p>
          Every device calls <Code>notifyAppReady()</Code> once the new bundle has booted
          successfully. If it doesn’t confirm within the launch window, OtaKit automatically rolls
          that device back to the last known-good bundle. You can also revert any channel instantly
          from the dashboard, and the CLI warns at upload time if your bundle depends on native
          code the installed app doesn’t have.
        </p>
      ),
    },
    {
      q: 'What do you track about my end users?',
      a: (
        <p>
          Nothing about the users themselves. Because devices download directly from Cloudflare’s
          CDN, OtaKit doesn’t fingerprint devices or track individuals — MAU-billed platforms have
          to identify every device to meter it. We collect anonymous update events for release
          analytics — that’s it.
        </p>
      ),
    },
    {
      q: 'Is OtaKit open source?',
      a: (
        <p>
          Yes — the entire stack (plugin, CLI, dashboard, server) is MIT-licensed and
          self-hostable. Run it on our hosted platform, or host the whole thing yourself.
        </p>
      ),
    },
  ],
};

export default function CapgoComparisonPage() {
  return <ComparisonLanding copy={copy} />;
}
