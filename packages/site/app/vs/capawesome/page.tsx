import Link from 'next/link';

import { ComparisonLanding, Code, type ComparisonCopy } from '../_components/ComparisonLanding';
import { site } from '@/lib/site';

export const metadata = {
  title: { absolute: 'Capawesome Alternative — OtaKit | Live Updates for Capacitor' },
  description:
    'OtaKit is the Capawesome Live Update alternative with a fully MIT-licensed stack, CDN-direct delivery, MCP, and Agent Skills. No MAU caps or user tracking.',
  alternates: { canonical: `${site.url}/vs/capawesome` },
};

function GuideLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-foreground underline underline-offset-4">
      {children}
    </Link>
  );
}

const copy: ComparisonCopy = {
  competitor: 'Capawesome',
  heroTitle: 'Ship app updates instantly',
  heroSub: (
    <>
      Push over-the-air (OTA) updates directly to your Capacitor app without app store reviews —{' '}
      <mark className="rounded-sm bg-yellow-200 px-1 text-yellow-950">
        the cheaper, open-source Capawesome alternative
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
  featuresSub: 'Everything you use Capawesome Live Update for, on every plan.',
  priceComparison: {
    rows: [
      ['1,000 users', '$0', '$9'],
      ['50,000 users', '$25', '$79'],
      ['250,000 users', '$25', '$249'],
    ],
    href: '/blog/capawesome-alternative',
  },
  ctaTitle: 'Ready to switch?',
  ctaSub: 'Same live updates, one simple bill — migration takes an afternoon.',
  faq: [
    {
      q: 'Why is OtaKit better than Capawesome?',
      a: (
        <>
          <p>
            The reasons are concrete: no MAU caps, a fully open stack, CDN-direct delivery, and a
            bill that doesn’t grow just because your app does.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Delivery runs on Cloudflare’s edge.</strong> Devices pull bundles from the
              nearest edge node worldwide — vendor servers are never in the device path.
            </li>
            <li>
              <strong>It’s far cheaper.</strong> Billing is one meter — updates delivered — not
              monthly active users, so quiet months cost you nothing.
            </li>
            <li>
              <strong>The whole stack is open.</strong> Capawesome open-sources the plugin; the
              cloud behind it is closed. OtaKit’s plugin, CLI, dashboard, and server are all
              MIT-licensed.
            </li>
          </ul>
        </>
      ),
    },
    {
      q: 'How does OtaKit pricing compare to Capawesome?',
      a: (
        <>
          <p>
            Capawesome’s live-update plans are gated by monthly active users — $9/mo covers just
            1,000 MAU, then $29 (10K), $79 (50K), $249 (250K) — and every active device counts every
            month, whether you release or not. OtaKit meters <strong>updates delivered</strong>,
            nothing else: Free covers 5,000 updates/month with unlimited apps; Starter is $10/mo for
            100,000, and Pro starts at $25/mo for 1 million.
          </p>
          <p>
            At 250,000 users the difference is $25 vs $249 — ten to one, every month, for the same
            job. The <GuideLink href="/blog/capawesome-alternative">full comparison</GuideLink>{' '}
            shows the math.
          </p>
        </>
      ),
    },
    {
      q: 'Does OtaKit match Capawesome feature for feature?',
      a: (
        <>
          <p>
            For live updates, yes — and then some: delta updates, channels with runtime switching,
            automatic rollback via <Code>notifyAppReady()</Code>, emergency{' '}
            <Code>--force-immediate</Code> releases, optional end-to-end encryption, and a
            native-compatibility check at upload time that no one else in the category does.
          </p>
          <p>
            Scope note: Capawesome also sells cloud native builds and its Insider plugin SDKs.
            OtaKit focuses purely on the update platform.
          </p>
        </>
      ),
    },
    {
      q: 'Can I manage OtaKit from an AI coding agent?',
      a: (
        <>
          <p>
            Yes. OtaKit&apos;s <GuideLink href="/docs/agents">MCP and Agent Skills</GuideLink>{' '}
            combine a local server for project inspection, compatibility checks, packaging, and
            uploads; a remote OAuth server for account and release operations; and an open Skill
            with the full release and revert workflow.
          </p>
          <p>
            Capawesome also publishes a remote MCP server and open Agent Skills, so this is not an
            “AI versus no AI” comparison. OtaKit&apos;s distinction is the combination of a
            project-aware local MCP server, a remote server with scoped OAuth, and one Skill that
            preserves its exact release options, approval points, client-reported event detail, and
            audit trail.
          </p>
        </>
      ),
    },
    {
      q: 'How do I migrate from Capawesome?',
      a: (
        <>
          <p>
            The APIs map almost one-to-one: <Code>ready()</Code> becomes{' '}
            <Code>notifyAppReady()</Code>, <Code>sync()</Code> becomes <Code>update()</Code>,{' '}
            <Code>defaultChannel</Code> becomes <Code>channel</Code>, and the background auto-update
            strategy is OtaKit’s default behavior out of the box. Swap the plugin, build, and
            upload.
          </p>
          <p>
            The{' '}
            <GuideLink href="/blog/migrate-from-capgo-and-capawesome">migration guide</GuideLink>{' '}
            has the complete config and API translation tables plus a safe production cutover plan.
          </p>
        </>
      ),
    },
    {
      q: 'Are OTA updates allowed?',
      a: (
        <p>
          Yes. Updating the web layer of a Capacitor app is explicitly permitted — Apple’s Developer
          Program License Agreement <strong>§3.3.1(B)</strong> allows downloaded JavaScript that
          runs in the system web view, and Google Play permits the same. OtaKit never touches native
          binaries, so your releases stay compliant.
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
          from the dashboard, and the CLI warns at upload time if your bundle depends on native code
          the installed app doesn’t have.
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
      q: 'Is OtaKit really fully open source?',
      a: (
        <p>
          Yes — the entire stack (Capacitor plugin, CLI, dashboard, server) is MIT-licensed in one
          repository, and the self-hosted deployment is the same code we run hosted. You can audit
          every line that executes on your users’ devices, and if we ever stop deserving your
          business, you take the stack and go.
        </p>
      ),
    },
  ],
};

export default function CapawesomeComparisonPage() {
  return <ComparisonLanding copy={copy} />;
}
