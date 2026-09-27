import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  GitCompare,
  KeyRound,
  RotateCcw,
  ScrollText,
  ShieldCheck,
  UserCheck,
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
  title: { absolute: 'Ship Capacitor Updates With AI Agents — OtaKit' },
  description:
    'Let Claude Code, Codex or VS Code ship your Capacitor OTA updates. The agent checks native compatibility, uploads the build, and waits for your approval before anything reaches a device.',
  alternates: { canonical: `${site.url}/ai-agents` },
};

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground">
      {children}
    </code>
  );
}

const SESSION = `you     Fix the checkout button label and ship it to production.

agent   Built the app. Checking native compatibility against what's live...
        compatible (12 packages unchanged)
        Uploaded bundle 1.5.0. Prepared the release:

        Publish  com.acme.shop
          lane       production · runtime 2026.04
          from       1.4.0  ->  1.5.0
          native     compatible (12 packages unchanged)
          immediate  no        auto-revert  on · 10% · min 100
        Approve? This goes live for every device on that lane.

you     Approve.

agent   Published. Devices pick it up on their next launch.`;

const VSCODE_CONFIG = `{
  "servers": {
    "otakit": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@otakit/cli@latest", "mcp", "--project-root", "\${workspaceFolder}"]
    }
  }
}`;

const PROMPTS = [
  'Check whether this change needs a new store build.',
  'Upload this build to staging but don’t publish it.',
  'Prepare this for production with auto-revert on, then wait for me.',
  'How is the current production release doing?',
  'Roll production back to the previous release.',
];

const FAQ_ITEMS: { q: string; a: React.ReactNode }[] = [
  {
    q: 'Can the agent release without me?',
    a: (
      <p>
        The OtaKit Skill tells your agent to stop for your approval before publishing, and publish
        and revert are flagged as destructive tools, so agent clients ask before running them.
        Remote connections also need the separate “Publish &amp; revert” scope. If you set your
        agent to approve every tool automatically, that is your choice; OtaKit still records who
        released what in the audit log.
      </p>
    ),
  },
  {
    q: 'Which agents work?',
    a: (
      <p>
        Claude Code, Codex, and VS Code with GitHub Copilot have one-command setup. Any client that
        supports MCP can run the local server or connect to the remote endpoint.
      </p>
    ),
  },
  {
    q: 'Does it cost extra?',
    a: <p>No. MCP and Agent Skills are included on every plan, including Free.</p>,
  },
  {
    q: 'What does the agent see?',
    a: (
      <p>
        Your apps, bundles, releases, and the update events devices report. Event counts are events,
        not users, and the tools tell the agent so.
      </p>
    ),
  },
  {
    q: 'Can I use it in CI?',
    a: (
      <p>
        Yes. Use an organization key in <Code>OTAKIT_TOKEN</Code> with the same CLI commands or MCP
        tools. Keep the key in your secret store, never in a project file.
      </p>
    ),
  },
];

export default function AiAgentsPage() {
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
              For AI coding agents
            </p>
            <h1 className="text-5xl font-bold sm:text-6xl xl:text-[4.25rem]">
              Let your agent ship the update. You approve the release.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground sm:text-xl xl:max-w-[39.5rem] xl:text-[1.375rem]">
              OtaKit gives Claude Code, Codex and VS Code a safe way to release Capacitor updates.
              The agent checks the build, uploads it, and waits for your OK before anything reaches
              a device.
            </p>
            <div className="mt-20 flex flex-col items-start gap-4 sm:flex-row">
              <div>
                <Link href="#setup">
                  <Button size="lg" className="group rounded-full px-8">
                    <span className="shimmer">Connect your agent</span>
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </Button>
                </Link>
                <p className="mt-1 text-xs text-muted-foreground/60 text-center hidden sm:block">
                  Included on every plan, including Free.
                </p>
              </div>
              <Link href={`${site.console}/login`}>
                <Button variant="outline" size="lg" className="rounded-full px-8">
                  Start releasing free
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Separator className="" />

      {/* Example session */}
      <section className="border-x border-border max-w-screen-xl mx-auto">
        <div className="border-b border-border px-8 pb-10 pt-30 sm:pb-14 sm:pt-36" data-blur-reveal>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Example session
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            From a sentence to a safe release
          </h2>
          <p className="mt-4 max-w-2xl text-muted-foreground">
            The agent does the work. The approval block is always the same, so you can read it at a
            glance.
          </p>
        </div>
        <div className="bg-muted/40 px-6 py-10 sm:px-12 sm:py-14">
          <pre className="mx-auto max-w-3xl overflow-x-auto rounded-xl border border-border bg-background px-5 py-5 font-mono text-[12px] leading-6 text-muted-foreground shadow-sm sm:text-[13px]">
            {SESSION}
          </pre>
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
              Check, prepare, approve
            </h2>
            <p className="mt-4 max-w-lg text-muted-foreground">
              Ask in plain language, or use the built-in prompts.
            </p>
          </div>
          <div className="grid gap-px bg-border sm:grid-cols-3">
            <StepCard
              number="01"
              title="Check"
              description="Reads your Capacitor project and compares native dependencies with what is live, so it knows whether this change can ship over the air."
              code="/check"
            />
            <StepCard
              number="02"
              title="Prepare"
              description="Builds, uploads the web bundle and prepares the exact release lane. Nothing is published yet."
              code="/release"
            />
            <StepCard
              number="03"
              title="Approve and watch"
              description="You approve the publish. Afterwards the agent reads rollout health and can prepare a revert for you to approve."
              code="/rollout"
            />
          </div>
        </div>
      </section>

      <Separator className="" />

      {/* Safety */}
      <section className="border-x border-border mx-auto max-w-screen-xl">
        <div className="overflow-hidden">
          <div
            className="border-b border-border px-8 pb-10 pt-30 sm:pb-14 sm:pt-36"
            data-blur-reveal
          >
            <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
              Built for safety
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Your agent can ship. It cannot surprise you.
            </h2>
          </div>
          <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={UserCheck}
              title="Approval before publish"
              description="The OtaKit Skill tells your agent to stop for your approval before publishing, and publish and revert are flagged as destructive actions, so agent clients ask before running them."
            />
            <FeatureCard
              icon={GitCompare}
              title="No stale overwrites"
              description="A publish carries the release state the agent reviewed. If a teammate released in between, it is rejected instead of overwriting their release."
            />
            <FeatureCard
              icon={ShieldCheck}
              title="Native compatibility check"
              description="If the change needs a new store build, the agent stops and says so instead of shipping a broken update."
            />
            <FeatureCard
              icon={RotateCcw}
              title="Automatic rollback"
              description="Devices that fail to start a new bundle roll back on their own, and auto-revert can pull a failing release for everyone."
            />
            <FeatureCard
              icon={ScrollText}
              title="Audit log"
              description="Every upload, publish and revert is attributed to the person or agent that made it."
            />
            <FeatureCard
              icon={KeyRound}
              title="Read-only when you want it"
              description="Remote connections ask for scopes. Grant read access only, and the agent can report but never release."
            />
          </div>
        </div>
      </section>

      <Separator className="" />

      {/* Setup */}
      <section id="setup" className="scroll-mt-20 border-x border-border mx-auto max-w-screen-xl">
        <div className="border-b border-border px-8 pb-10 pt-30 sm:pb-14 sm:pt-36" data-blur-reveal>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Set it up
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            One command from your project
          </h2>
          <p className="mt-4 max-w-2xl text-muted-foreground">
            It detects your agent, signs you in, and shows exactly what it will write before writing
            anything.
          </p>
        </div>
        <div className="grid gap-px bg-border lg:grid-cols-2">
          <SetupBlock title="Any supported agent">
            <Pre>{`npx -y @otakit/cli@latest connect`}</Pre>
          </SetupBlock>
          <SetupBlock title="Claude Code">
            <Pre>{`npx -y @otakit/cli@latest login

claude plugin marketplace add OtaKit/otakit
claude plugin install otakit@otakit`}</Pre>
          </SetupBlock>
          <SetupBlock title="Codex">
            <Pre>{`npx skills add https://github.com/OtaKit/otakit --skill otakit

npx -y @otakit/cli@latest login
codex mcp add otakit -- npx -y @otakit/cli@latest mcp`}</Pre>
          </SetupBlock>
          <SetupBlock title="VS Code and GitHub Copilot">
            <p className="text-sm text-muted-foreground">
              Create <Code>.vscode/mcp.json</Code>, then run <strong>MCP: List Servers</strong>.
            </p>
            <Pre>{VSCODE_CONFIG}</Pre>
          </SetupBlock>
        </div>
        <div className="border-t border-border px-8 py-8 text-sm text-muted-foreground">
          Other MCP clients can run the local server (<Code>npx -y @otakit/cli@latest mcp</Code>) or
          connect to <Code>https://console.otakit.app/mcp</Code> with OAuth.{' '}
          <Link
            href="/docs/agents"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Full setup guide
          </Link>
          .
        </div>
      </section>

      <Separator className="" />

      {/* Prompts */}
      <section className="border-x border-border mx-auto max-w-screen-xl">
        <div className="border-b border-border px-8 pb-10 pt-30 sm:pb-14 sm:pt-36" data-blur-reveal>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            What you can ask
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Plain language works
          </h2>
        </div>
        <ul className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
          {PROMPTS.map((prompt) => (
            <li key={prompt} className="bg-background p-8 text-[15px] leading-relaxed sm:p-10">
              “{prompt}”
            </li>
          ))}
        </ul>
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
            Ready to let your agent ship?
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Connect in one command. Free to start.
          </p>
          <div className="mt-20 flex flex-col gap-4 sm:flex-row">
            <Link href={`${site.console}/login`}>
              <Button size="lg" className="group rounded-full px-8">
                <span className="shimmer">Get started free</span>
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </Link>
            <Link href="/docs/agents">
              <Button variant="outline" size="lg" className="rounded-full px-8">
                <BookOpen className="size-4" />
                Read the agent docs
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
              { label: 'AI agents', href: '/ai-agents' },
              { label: 'Dashboard', href: `${site.console}/dashboard` },
              { label: 'Sign up', href: `${site.console}/login` },
              { label: 'Security', href: '/docs/security' },
            ]}
          />

          <FooterColumn
            title="Docs"
            titleHref="/docs"
            links={[
              { label: 'MCP & Agent Skills', href: '/docs/agents' },
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
                label: 'Ship updates with AI agents',
                href: '/blog/ship-capacitor-updates-with-ai-agents',
              },
              { label: 'How OTA updates work', href: '/blog/how-ota-works-for-capacitor-apps' },
              {
                label: 'App Store & Play rules',
                href: '/blog/ota-policies-for-app-store-and-google-play',
              },
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

function SetupBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 bg-background p-8 sm:p-12">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      <div className="mt-3">{children}</div>
    </div>
  );
}
