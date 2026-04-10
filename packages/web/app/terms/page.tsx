import Link from 'next/link';

export const metadata = {
  title: 'Terms of Use - OtaKit',
  description:
    'Terms of Use for OtaKit (otakit.app), including service usage, billing, and legal terms.',
};

const LAST_UPDATED = 'February 12, 2026';

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-4xl px-6 py-16 sm:py-20">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Terms of Use</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
        <p className="mt-4 text-sm text-muted-foreground">
          These Terms of Use (&quot;Terms&quot;) govern access to and use of OtaKit services at{' '}
          <strong>otakit.app</strong> (the &quot;Services&quot;). By accessing or using the
          Services, you agree to these Terms.
        </p>

        <div className="mt-10 space-y-10 text-sm leading-7 text-muted-foreground">
          <Section title="1. Eligibility and Account Responsibility">
            <P>
              You must be at least 18 years old and authorized to accept these Terms for yourself or
              the organization you represent.
            </P>
            <P>
              You are responsible for account credentials, API keys, team member access, and all
              activity under your account. Notify us promptly at{' '}
              <a className="underline underline-offset-4" href="mailto:support@otakit.app">
                support@otakit.app
              </a>{' '}
              if you suspect unauthorized access.
            </P>
          </Section>

          <Section title="2. Service Description">
            <P>
              OtaKit provides tooling and infrastructure for over-the-air updates of application web
              assets, including hosting, delivery, release channels, and related analytics and
              operational APIs.
            </P>
            <P>
              You are responsible for your app code, release decisions, regulatory obligations,
              end-user disclosures, and app-store compliance for your own products.
            </P>
          </Section>

          <Section title="3. Acceptable Use">
            <P>You agree not to:</P>
            <List
              items={[
                'Use the Services for unlawful, harmful, or fraudulent activity.',
                'Interfere with or disrupt the integrity, security, or performance of the Services.',
                'Bypass or attempt to bypass service limits, authentication, or access controls.',
                'Upload malware or content designed to compromise users or systems.',
                'Reverse engineer, copy, or resell the Services except as permitted by law.',
              ]}
            />
          </Section>

          <Section title="4. API Keys and Security">
            <P>
              API keys, tokens, and signing material must be stored securely and treated as
              confidential. You are responsible for key rotation, revocation, and implementing
              appropriate access controls.
            </P>
            <P>
              We may suspend compromised credentials or abusive traffic to protect the platform and
              users.
            </P>
          </Section>

          <Section title="5. Billing, Credits, and Payments">
            <P>
              Paid plans, credit allocations, and add-ons are listed on our pricing and checkout
              pages. Billing is handled by Polar (polar.sh) and may include recurring subscriptions
              and usage-based charges.
            </P>
            <P>
              You authorize us and our payment processor to charge your selected payment method for
              subscriptions, add-ons, and applicable taxes. Except where required by law, fees are
              non-refundable.
            </P>
            <P>
              If a payment fails, we may retry charges, suspend paid features, or downgrade your
              account until payment is resolved.
            </P>
          </Section>

          <Section title="6. Customer Data and Privacy">
            <P>
              As between the parties, you retain ownership of your app content and data you submit
              to the Services. You grant us a limited license to host, process, transmit, and
              display that data solely to provide and secure the Services.
            </P>
            <P>
              Our collection and use of personal data is described in our{' '}
              <Link className="underline underline-offset-4" href="/policy">
                Privacy Policy
              </Link>
              .
            </P>
          </Section>

          <Section title="7. Intellectual Property">
            <P>
              The Services, software, documentation, and branding are owned by OtaKit or its
              licensors and protected by intellectual property laws.
            </P>
            <P>
              Subject to these Terms, we grant you a limited, non-exclusive, non-transferable right
              to use the Services during your subscription.
            </P>
          </Section>

          <Section title="8. Feedback">
            <P>
              If you provide feedback or suggestions, you grant us a perpetual, irrevocable,
              worldwide, royalty-free license to use and incorporate that feedback without
              restriction or compensation.
            </P>
          </Section>

          <Section title="9. Confidentiality">
            <P>
              Each party may receive non-public information from the other party. The receiving
              party will protect confidential information with reasonable care and use it only to
              perform under these Terms.
            </P>
            <P>
              This obligation does not apply to information that is public through no fault of the
              receiving party, independently developed, or lawfully obtained from a third party.
            </P>
          </Section>

          <Section title="10. Third-Party Services">
            <P>
              The Services may integrate with third-party providers (for example, cloud
              infrastructure, payment processors, and email providers). Their services are governed
              by their own terms and policies.
            </P>
          </Section>

          <Section title="11. Service Changes and Availability">
            <P>
              We may update, improve, or discontinue features from time to time. We aim for high
              availability but do not guarantee uninterrupted or error-free operation.
            </P>
          </Section>

          <Section title="12. Suspension and Termination">
            <P>
              We may suspend or terminate access if you materially breach these Terms, pose security
              risk, or use the Services unlawfully.
            </P>
            <P>
              You may stop using the Services at any time. On termination, rights granted to you
              under these Terms end immediately, except sections that by their nature survive
              (including billing obligations, disclaimers, liability limits, and dispute terms).
            </P>
          </Section>

          <Section title="13. Disclaimers">
            <P>
              THE SERVICES ARE PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE.&quot; TO THE
              MAXIMUM EXTENT PERMITTED BY LAW, OTAKIT DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED,
              INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
              NON-INFRINGEMENT.
            </P>
          </Section>

          <Section title="14. Limitation of Liability">
            <P>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, OTAKIT WILL NOT BE LIABLE FOR INDIRECT,
              INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR LOSS OF PROFITS, REVENUE,
              DATA, OR GOODWILL.
            </P>
            <P>
              OTAKIT&apos;S TOTAL LIABILITY FOR ANY CLAIM ARISING OUT OF OR RELATED TO THESE TERMS
              OR THE SERVICES WILL NOT EXCEED THE AMOUNT PAID BY YOU TO OTAKIT FOR THE SERVICES IN
              THE TWELVE (12) MONTHS BEFORE THE EVENT GIVING RISE TO LIABILITY.
            </P>
          </Section>

          <Section title="15. Indemnification">
            <P>
              You will defend and indemnify OtaKit and its affiliates, officers, employees, and
              agents from third-party claims arising out of your use of the Services in violation of
              these Terms or applicable law.
            </P>
          </Section>

          <Section title="16. Governing Law and Venue">
            <P>
              These Terms are governed by the laws of the State of Delaware, excluding
              conflict-of-law principles. Any legal action arising from these Terms will be brought
              in the state or federal courts located in Delaware, and each party consents to that
              jurisdiction and venue.
            </P>
          </Section>

          <Section title="17. Changes to These Terms">
            <P>
              We may update these Terms from time to time. The updated version will be posted at{' '}
              <strong>otakit.app/terms</strong> with a revised &quot;Last updated&quot; date.
              Continued use of the Services after changes become effective means you accept the
              updated Terms.
            </P>
          </Section>

          <Section title="18. Contact">
            <P>
              Questions about these Terms can be sent to{' '}
              <a className="underline underline-offset-4" href="mailto:support@otakit.app">
                support@otakit.app
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

function List({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
