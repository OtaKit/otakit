import Link from 'next/link';

export const metadata = {
  title: 'Support',
  description:
    'Get help with OtaKit: contact support, report a security issue, and find the docs for setup, releases, and AI agent connections.',
};

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-4xl px-6 py-16 sm:py-20">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Support</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Questions about OtaKit, your account, billing, or a release? We are here to help.
        </p>

        <div className="mt-10 space-y-10 text-sm leading-7 text-muted-foreground">
          <Section title="Contact support">
            <P>
              Email{' '}
              <a className="underline underline-offset-4" href="mailto:support@otakit.app">
                support@otakit.app
              </a>
              . Include your organization name, the app ID, and the release or bundle involved so we
              can look into it quickly.
            </P>
          </Section>

          <Section title="Report a security issue">
            <P>
              Email{' '}
              <a className="underline underline-offset-4" href="mailto:security@otakit.app">
                security@otakit.app
              </a>{' '}
              or use{' '}
              <a
                className="underline underline-offset-4"
                href="https://github.com/OtaKit/otakit/security/advisories"
              >
                private vulnerability reporting
              </a>{' '}
              on GitHub. Please don&apos;t open public issues for security problems.
            </P>
          </Section>

          <Section title="Documentation">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <DocLink href="/docs/setup">Setup</DocLink>: add the plugin to a Capacitor app and
                ship the first update.
              </li>
              <li>
                <DocLink href="/docs/rollouts">Rollouts</DocLink> and{' '}
                <DocLink href="/docs/events">events</DocLink>: release gradually and read rollout
                health.
              </li>
              <li>
                <DocLink href="/docs/agents">AI agents</DocLink>: connect ChatGPT, Claude, Codex,
                Cursor, or VS Code to OtaKit.
              </li>
              <li>
                <DocLink href="/docs/self-host">Self-hosting</DocLink>: run OtaKit on your own
                infrastructure.
              </li>
            </ul>
          </Section>

          <Section title="Account, billing, and connections">
            <P>
              Manage your plan, usage, and team in the{' '}
              <a className="underline underline-offset-4" href="https://console.otakit.app">
                OtaKit console
              </a>
              . AI agent connections are listed under <strong>Settings → Agents</strong>, where you
              can revoke each one at any time.
            </P>
          </Section>

          <Section title="Bugs and feature requests">
            <P>
              OtaKit is open source. You can report bugs and suggest features in{' '}
              <a
                className="underline underline-offset-4"
                href="https://github.com/OtaKit/otakit/issues"
              >
                GitHub issues
              </a>
              .
            </P>
          </Section>
        </div>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}

function DocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link className="underline underline-offset-4" href={href}>
      {children}
    </Link>
  );
}
