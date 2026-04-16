import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy - OtaKit',
  description:
    'Privacy Policy for OtaKit (otakit.app), including data collection, use, sharing, and rights.',
};

const LAST_UPDATED = 'February 12, 2026';

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-4xl px-6 py-16 sm:py-20">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Privacy Policy</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
        <p className="mt-4 text-sm text-muted-foreground">
          This Privacy Policy explains how OtaKit (&quot;we,&quot; &quot;our,&quot; or
          &quot;us&quot;) collects, uses, discloses, and protects personal data when you use{' '}
          <strong>otakit.app</strong> and related services.
        </p>

        <div className="mt-10 space-y-10 text-sm leading-7 text-muted-foreground">
          <Section title="1. Scope">
            <P>
              This policy applies to personal data processed through our website, dashboard, APIs,
              support channels, and billing workflows.
            </P>
          </Section>

          <Section title="2. Data Controller and Contact">
            <P>
              For questions or requests related to this policy, contact us at{' '}
              <a className="underline underline-offset-4" href="mailto:support@otakit.app">
                support@otakit.app
              </a>
              .
            </P>
          </Section>

          <Section title="3. Personal Data We Collect">
            <List
              items={[
                'Account data: name, email, organization and role information.',
                'Authentication data: one-time passcode events, session and security metadata.',
                'Billing data: subscription status, plan, invoices, and transaction references processed via Polar.',
                'Service usage data: app IDs, release/channel activity, API usage, event telemetry, and operational logs.',
                'Technical data: IP address, device/browser metadata, and diagnostic information for reliability and security.',
                'Support communications: messages and materials you send to support.',
              ]}
            />
          </Section>

          <Section title="4. How We Use Personal Data">
            <List
              items={[
                'Provide, maintain, and secure the Services.',
                'Authenticate users and manage accounts and organizations.',
                'Process billing, subscriptions, and credit usage.',
                'Operate update delivery, release workflows, and related analytics.',
                'Detect, prevent, and investigate abuse, fraud, and security incidents.',
                'Respond to support requests and communicate service updates.',
                'Comply with legal obligations and enforce our Terms of Use.',
              ]}
            />
          </Section>

          <Section title="5. Legal Bases (EEA/UK Users)">
            <P>
              Where GDPR or similar laws apply, our legal bases may include: contract performance,
              legitimate interests (such as service security and reliability), consent (where
              required), and legal compliance.
            </P>
          </Section>

          <Section title="6. Sharing and Disclosures">
            <P>We may share personal data with:</P>
            <List
              items={[
                'Service providers that support hosting, storage, email delivery, and operational tooling.',
                'Polar (polar.sh) and payment partners for subscription and payment processing.',
                'Professional advisers (legal, accounting, audit) when needed.',
                'Authorities or counterparties when required by law or to protect rights and security.',
                'A successor entity in connection with a merger, acquisition, financing, or asset sale.',
              ]}
            />
            <P>
              We do not sell personal information for money. We do not share personal information
              for cross-context behavioral advertising.
            </P>
          </Section>

          <Section title="7. Sub-processors">
            <P>
              The managed OtaKit service uses the following third-party providers to operate:
            </P>
            <List
              items={[
                'Cloudflare — CDN, edge delivery, R2 object storage, Workers compute.',
                'Neon — PostgreSQL database hosting.',
                'Tinybird — Device event analytics and aggregation.',
                'Resend — Transactional email delivery.',
                'Polar — Subscription billing and payment processing.',
                'Vercel — Dashboard and API hosting.',
              ]}
            />
            <P>
              Self-hosted deployments choose their own infrastructure providers.
            </P>
          </Section>

          <Section title="8. International Data Transfers">
            <P>
              Personal data may be processed in countries other than your own. We use appropriate
              safeguards where required by law for cross-border transfers.
            </P>
          </Section>

          <Section title="9. Data Retention">
            <P>
              We retain personal data for as long as needed to provide the Services, comply with
              legal obligations, resolve disputes, enforce agreements, and maintain security and
              business records.
            </P>
            <P>
              Retention periods vary by data type and purpose. You may request deletion as described
              below, subject to legal and operational exceptions.
            </P>
          </Section>

          <Section title="10. Security">
            <P>
              We use technical and organizational safeguards designed to protect personal data,
              including access controls, encrypted transport, and logging/monitoring practices. No
              method of transmission or storage is completely secure, and we cannot guarantee
              absolute security.
            </P>
          </Section>

          <Section title="11. Your Rights and Choices">
            <P>
              Depending on your location, you may have rights to access, correct, delete, restrict,
              object, or port your personal data, and to withdraw consent where processing relies on
              consent.
            </P>
            <P>
              California residents may have rights under applicable California privacy laws,
              including rights to know, delete, and correct personal information.
            </P>
            <P>
              To exercise rights, email{' '}
              <a className="underline underline-offset-4" href="mailto:support@otakit.app">
                support@otakit.app
              </a>
              . We may verify your identity before fulfilling requests.
            </P>
          </Section>

          <Section title="12. Cookies and Similar Technologies">
            <P>
              We may use cookies or similar technologies necessary for authentication, security,
              session management, and service functionality. Where required by law, we request
              consent before using non-essential cookies.
            </P>
          </Section>

          <Section title="13. Children's Privacy">
            <P>
              The Services are not directed to children under 13, and we do not knowingly collect
              personal data from children under 13.
            </P>
          </Section>

          <Section title="14. Changes to This Policy">
            <P>
              We may update this Privacy Policy from time to time. The latest version will be posted
              at <strong>otakit.app/policy</strong> with an updated effective date.
            </P>
          </Section>

          <Section title="15. Related Terms">
            <P>
              Use of the Services is also governed by our{' '}
              <Link className="underline underline-offset-4" href="/terms">
                Terms of Use
              </Link>
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

function List({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
