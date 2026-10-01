import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  Bot,
  Filter,
  KeyRound,
  Link2,
  ShieldCheck,
  Trash2,
} from 'lucide-react';

import { Pre } from '@/app/docs/CodeBlock';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { CopyEmailLink } from '@/components/CopyEmailLink';
import { BlurRevealObserver } from '@/components/landing/BlurRevealObserver';
import { site } from '@/lib/site';

// Same skeleton as the homepage (app/page.tsx) and the /vs landing pages.

export const metadata = {
  title: { absolute: 'Free Push Notifications for Capacitor Apps — OtaKit' },
  description:
    'Send push notifications to your Capacitor app on iOS and Android for free. Use your own APNs key and Firebase project, the official Capacitor plugin, and send from the dashboard, CLI, API or an AI agent.',
  alternates: { canonical: `${site.url}/push` },
};

const SIGN_UP_URL = `${site.console}/login?addon=push`;

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground">
      {children}
    </code>
  );
}

const APP_CODE = `import { OtaKitPush } from '@otakit/push';

OtaKitPush.init({ appId: 'YOUR_APP_ID' });

PushNotifications.addListener('registration',
  ({ value }) => OtaKitPush.syncToken(value));

await PushNotifications.requestPermissions();
await PushNotifications.register();`;

const SEND_CODE = `otakit push send \\
  --title "Your order shipped" \\
  --body "Track it in the app" \\
  --url /orders --user user_42`;

const LIMITS: Array<[string, string, string]> = [
  ['Free', '10,000 devices', '100,000 / month'],
  ['Starter', '50,000 devices', '1,000,000 / month'],
  ['Pro', '250,000 devices', '5,000,000 / month'],
];

const FAQ_ITEMS: { q: string; a: React.ReactNode }[] = [
  {
    q: 'Is it really free?',
    a: (
      <p>
        Yes. Apple and Google do not charge for sending push notifications, so we don&apos;t either.
        The Free plan includes 10,000 devices and 100,000 notifications a month. Paid OtaKit plans
        raise the limits.
      </p>
    ),
  },
  {
    q: 'Do I need Firebase?',
    a: (
      <p>
        On Android, yes: Firebase Cloud Messaging is how Google delivers push, and it is free. On
        iOS, no: OtaKit sends straight to Apple with your APNs key, so your iOS app does not need
        the Firebase SDK.
      </p>
    ),
  },
  {
    q: 'Do I have to use OtaKit live updates?',
    a: (
      <p>
        No. Push works on its own. If you also use OtaKit live updates, devices report their OTA
        channel automatically, so you can message only your beta testers, for example.
      </p>
    ),
  },
  {
    q: 'Which plugin runs on the device?',
    a: (
      <p>
        The official <Code>@capacitor/push-notifications</Code> plugin. <Code>@otakit/push</Code> is
        a small JavaScript helper that registers the token with OtaKit. No extra native code.
      </p>
    ),
  },
  {
    q: 'Who holds my keys?',
    a: (
      <p>
        You create the APNs key and Firebase service account in your own accounts and upload them.
        They are encrypted at rest, only workspace owners and admins can change them, and you can
        remove them at any time.
      </p>
    ),
  },
  {
    q: 'Can I send from my backend?',
    a: (
      <p>
        Yes. Call the REST API with an organization key, target your own user IDs, and pass an
        idempotency key so a retry never sends twice. See the{' '}
        <Link href="/docs/push" className="underline underline-offset-4">
          push docs
        </Link>
        .
      </p>
    ),
  },
];

export default function PushLandingPage() {
  return (
    <div className="min-h-screen overflow-x-clip bg-background text-foreground m-3 border border-border">
      <BlurRevealObserver />
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/60 backdrop-blur-2xl">
        <div className="mx-auto flex h-16 max-w-screen-xl items-center gap-6 px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/logo.svg"
              alt="OtaKit"
              width={24}
              height={24}
              className="size-6 rounded-md"
            />
            <span className="text-[15px] font-semibold tracking-tight">OtaKit</span>
          </Link>
          <nav className="ml-auto flex items-center gap-1">
            <Link
              href="/#pricing"
              className="hidden rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
            >
              Pricing
            </Link>
            <Link
              href="/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Docs
            </Link>
            <Link
              href="/blog"
              className="hidden rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
            >
              Blog
            </Link>
            <div className="ml-3 flex items-center gap-2">
              <Link href={`${site.console}/dashboard`}>
                <Button variant="ghost" size="sm">
                  Dashboard
                </Button>
              </Link>
              <Link href={`${site.console}/login`}>
                <Button size="sm" className="rounded-full px-4">
                  Sign Up
                </Button>
              </Link>
            </div>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden pb-24 pt-32 sm:pb-32 sm:pt-44 border-x border-border max-w-screen-xl mx-auto">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,var(--color-border)_1.5px,transparent_1.5px)] bg-[size:28px_28px] opacity-60"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-background to-transparent"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent"
          aria-hidden="true"
        />

        <div className="relative mx-auto max-w-screen-xl p-10">
          <div className="max-w-3xl xl:max-w-4xl">
            <p className="mb-8 inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/[0.08] px-3 py-1.5 text-xs font-medium shadow-sm sm:text-sm">
              Free for Capacitor apps
            </p>
            <h1 className="text-5xl font-bold sm:text-6xl xl:text-[4.25rem]">
              Push notifications for your Capacitor app. Free.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground sm:text-xl xl:max-w-[39.5rem] xl:text-[1.375rem]">
              Use your own Apple and Firebase keys and the official Capacitor plugin. Send to iOS
              and Android from the dashboard, the CLI, your backend or an AI agent.
            </p>
            <div className="mt-20 flex flex-col items-start gap-4 sm:flex-row">
              <div>
                <Link href={SIGN_UP_URL}>
                  <Button size="lg" className="group rounded-full px-8">
                    <span className="shimmer">Start sending free</span>
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </Button>
                </Link>
                <p className="mt-1 text-xs text-muted-foreground/60 text-center hidden sm:block">
                  Free up to 100k a month.
                </p>
              </div>
              <Link href="/docs/push">
                <Button variant="outline" size="lg" className="rounded-full px-8">
                  <BookOpen className="size-4" />
                  Read the docs
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Separator className="" />

      {/* How it works */}
      <section className="border-x border-border max-w-screen-xl mx-auto">
        <div className="overflow-hidden">
          <div
            className="border-b border-border px-8 pb-10 pt-30 sm:pb-14 sm:pt-36"
            data-blur-reveal
          >
            <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
              How it works
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Set up once, send in seconds
            </h2>
            <p className="mt-4 max-w-lg text-muted-foreground">
              About fifteen minutes from zero to the first notification on a real device.
            </p>
          </div>
          <div className="grid gap-px bg-border sm:grid-cols-3">
            <StepCard
              number="01"
              title="Upload your keys"
              description="Your APNs key for iOS and your Firebase service account for Android. OtaKit tests them with Apple and Google right away."
              code="Push → Setup"
            />
            <StepCard
              number="02"
              title="Register devices"
              description="Add the official Capacitor plugin and a small helper that sends the device token to OtaKit, with your user ID and topics."
              code="npm i @otakit/push"
            />
            <StepCard
              number="03"
              title="Send"
              description="Pick an audience, check the device count, and send. Delivery counts and errors show up per campaign."
              code="otakit push send"
            />
          </div>
        </div>
      </section>

      <Separator className="" />

      {/* Code */}
      <section className="border-x border-border max-w-screen-xl mx-auto">
        <div className="border-b border-border px-8 pb-10 pt-30 sm:pb-14 sm:pt-36" data-blur-reveal>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            The code
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            A few lines in your app, one command to send
          </h2>
        </div>
        <div className="grid gap-px bg-border lg:grid-cols-2">
          <div className="min-w-0 bg-background p-8 sm:p-12">
            <h3 className="text-[15px] font-semibold">In your app</h3>
            <div className="mt-3">
              <Pre>{APP_CODE}</Pre>
            </div>
          </div>
          <div className="min-w-0 bg-background p-8 sm:p-12">
            <h3 className="text-[15px] font-semibold">From your terminal or CI</h3>
            <div className="mt-3">
              <Pre>{SEND_CODE}</Pre>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Or use the dashboard, the REST API from your backend, or ask your AI agent through the
              OtaKit CLI.
            </p>
          </div>
        </div>
      </section>

      <Separator className="" />

      {/* Features */}
      <section className="border-x border-border mx-auto max-w-screen-xl">
        <div className="overflow-hidden">
          <div
            className="border-b border-border px-8 pb-10 pt-30 sm:pb-14 sm:pt-36"
            data-blur-reveal
          >
            <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
              What you get
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              The parts you would otherwise build yourself
            </h2>
          </div>
          <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={Filter}
              title="Targeting"
              description="Send to everyone, one platform, topics your users subscribe to, your own user IDs, or the OTA channel a device is on."
            />
            <FeatureCard
              icon={Link2}
              title="Deep links"
              description="Attach a path like /orders/42. Your app opens the right screen when the user taps the notification."
            />
            <FeatureCard
              icon={Trash2}
              title="Token cleanup"
              description="Tokens Apple or Google report as invalid are removed automatically, so your device count stays honest."
            />
            <FeatureCard
              icon={ShieldCheck}
              title="Safe sending"
              description="You see the exact audience before sending, idempotency keys stop double sends, and every send is in the audit log."
            />
            <FeatureCard
              icon={KeyRound}
              title="Your keys, your projects"
              description="Delivery runs through your own Apple and Firebase accounts. Keys are encrypted at rest and removable at any time."
            />
            <FeatureCard
              icon={Bot}
              title="Agent and CLI ready"
              description="Send from the command line, from CI, or let an AI agent draft the message and ask you before it goes out."
            />
          </div>
        </div>
      </section>

      <Separator className="" />

      {/* Limits */}
      <section className="border-x border-border mx-auto max-w-screen-xl">
        <div className="border-b border-border px-8 pb-10 pt-30 sm:pb-14 sm:pt-36" data-blur-reveal>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Limits
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Generous on every plan
          </h2>
          <p className="mt-4 max-w-2xl text-muted-foreground">
            Push is included in every OtaKit plan at no extra cost.{' '}
            <Link
              href="/#pricing"
              className="font-medium text-foreground underline underline-offset-4"
            >
              See plans
            </Link>
            .
          </p>
        </div>
        <div className="grid gap-px bg-border sm:grid-cols-3">
          {LIMITS.map(([plan, devices, sends]) => (
            <div key={plan} className="bg-background p-8 sm:p-12">
              <h3 className="text-lg font-semibold">{plan}</h3>
              <p className="mt-3 text-sm text-muted-foreground">{devices}</p>
              <p className="mt-1 text-sm text-muted-foreground">{sends} notifications</p>
            </div>
          ))}
        </div>
      </section>

      <Separator className="" />

      {/* CTA */}
      <section className="relative overflow-hidden border-x border-border mx-auto max-w-screen-xl py-32 px-10 bg-muted sm:py-40">
        <div
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(var(--color-border)_1px,transparent_1px),linear-gradient(90deg,var(--color-border)_1px,transparent_1px)] bg-[size:40px_40px] opacity-50"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-background to-transparent"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent"
          aria-hidden="true"
        />
        <div className="relative" data-blur-reveal>
          <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">
            Send your first notification today
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">Free to start. No credit card.</p>
          <div className="mt-20 flex flex-col gap-4 sm:flex-row">
            <Link href={SIGN_UP_URL}>
              <Button size="lg" className="group rounded-full px-8">
                <span className="shimmer">Get started free</span>
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </Link>
            <Link href="/docs/push">
              <Button variant="outline" size="lg" className="rounded-full px-8">
                <BookOpen className="size-4" />
                Read the push docs
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <Separator className="" />

      {/* FAQ */}
      <section id="faq" className="border-x border-border mx-auto max-w-screen-xl">
        <div className="overflow-hidden">
          <div
            className="border-b border-border px-8 pb-10 pt-30 sm:pb-14 sm:pt-36"
            data-blur-reveal
          >
            <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
              FAQ
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Questions, answered
            </h2>
          </div>
          <div className="px-8 pb-10 pt-6 sm:pb-16">
            <Accordion type="single" collapsible className="w-full">
              {FAQ_ITEMS.map((item, i) => (
                <AccordionItem key={i} value={`faq-${i}`}>
                  <AccordionTrigger className="text-base font-semibold">{item.q}</AccordionTrigger>
                  <AccordionContent>
                    <div className="max-w-2xl space-y-3 text-[15px] leading-relaxed text-muted-foreground">
                      {item.a}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </section>

      <Separator className="" />

      {/* Footer */}
      <footer className="border-x border-t border-border mx-auto max-w-screen-xl">
        <div className="grid gap-10 px-8 py-14 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2.5">
              <Image
                src="/logo.svg"
                alt="OtaKit"
                width={24}
                height={24}
                className="size-6 rounded-md"
              />
              <span className="text-[15px] font-semibold tracking-tight text-foreground">
                OtaKit
              </span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              Instant over-the-air updates for Capacitor apps. Open source, CDN-delivered, and free
              to start.
            </p>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              Need a Mac for iOS builds?{' '}
              <a
                href="https://nomac.app/?utm_source=otakit&utm_medium=footer&utm_campaign=friends"
                target="_blank"
                rel="noopener"
                className="text-foreground underline underline-offset-4 transition-colors hover:text-muted-foreground"
              >
                Try NoMac
              </a>
            </p>
            <div className="mt-6 flex gap-5 text-sm text-muted-foreground">
              <a
                href={site.github}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-foreground"
              >
                GitHub
              </a>
              <a
                href="https://otakit.hyperping.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-foreground"
              >
                Status
              </a>
              <CopyEmailLink
                email={site.supportEmail}
                className="cursor-pointer transition-colors hover:text-foreground"
              >
                Contact
              </CopyEmailLink>
            </div>
          </div>

          <FooterColumn
            title="Product"
            links={[
              { label: 'Pricing', href: '/#pricing' },
              { label: 'Push notifications', href: '/push' },
              { label: 'Changelog', href: '/changelog' },
              { label: 'Dashboard', href: `${site.console}/dashboard` },
              { label: 'Sign up', href: `${site.console}/login` },
              { label: 'Security', href: '/docs/security' },
            ]}
          />

          <FooterColumn
            title="Docs"
            titleHref="/docs"
            links={[
              { label: 'Push notifications', href: '/docs/push' },
              { label: 'Getting started', href: '/docs/setup' },
              { label: 'CLI reference', href: '/docs/cli' },
              { label: 'CI automation', href: '/docs/ci' },
            ]}
          />

          <FooterColumn
            title="Blog"
            titleHref="/blog"
            links={[
              {
                label: 'OneSignal alternative for Capacitor',
                href: '/blog/onesignal-alternative-capacitor',
              },
              {
                label: 'Push setup with Firebase',
                href: '/blog/capacitor-push-notifications-firebase',
              },
              { label: 'How OTA updates work', href: '/blog/how-ota-works-for-capacitor-apps' },
            ]}
          />
        </div>

        <div className="flex flex-col gap-4 border-t border-border px-8 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} OtaKit. Open source under MIT.</span>
          <div className="flex gap-6">
            <Link href="/terms" className="transition-colors hover:text-foreground">
              Terms
            </Link>
            <Link href="/policy" className="transition-colors hover:text-foreground">
              Privacy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ─── Sub-components (same as homepage) ────────────────────────────── */

function FooterColumn({
  title,
  titleHref,
  links,
}: {
  title: string;
  titleHref?: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">
        {titleHref ? (
          <Link href={titleHref} className="transition-colors hover:text-muted-foreground">
            {title}
          </Link>
        ) : (
          title
        )}
      </h3>
      <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="transition-colors hover:text-foreground">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepCard({
  number,
  title,
  description,
  code,
}: {
  number: string;
  title: string;
  description: string;
  code: string;
}) {
  return (
    <div className="bg-background p-8 sm:p-12">
      <span className="font-mono text-sm text-muted-foreground/50">{number}</span>
      <h3 className="mt-3 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
      <pre className="mt-4 overflow-x-auto rounded-lg border border-border bg-background/50 px-4 py-3 font-mono text-[12px] text-muted-foreground bg-muted">
        {code}
      </pre>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="group bg-background p-8 transition-colors hover:bg-muted/95 sm:p-12">
      <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-muted">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}
