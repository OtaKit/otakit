import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('sign-in-with-apple-private-icloud-domain')!;

export const metadata = blogPostMetadata(post.slug);

export default function SignInWithAppleDomainPage() {
  return (
    <BlogArticle post={post}>
      <p>
        When a user picks &ldquo;Hide My Email&rdquo; in Sign in with Apple, your app receives a
        relay address instead of their real one. For years those addresses ended in{' '}
        <Code>@privaterelay.appleid.com</Code>. Apple has now started issuing new ones on a
        different domain: <Code>@private.icloud.com</Code>.
      </p>
      <p>From Apple&apos;s developer news update:</p>
      <ul>
        <li>
          <strong>New</strong> Sign in with Apple relay addresses are issued on{' '}
          <Code>private.icloud.com</Code>.
        </li>
        <li>
          <strong>Existing</strong> <Code>privaterelay.appleid.com</Code> addresses keep working.
        </li>
        <li>
          iCloud+ Hide My Email addresses created outside Sign in with Apple stay on{' '}
          <Code>icloud.com</Code>.
        </li>
        <li>Your systems must accept both relay domains.</li>
      </ul>
      <p>
        If you never look at the email domain, nothing changes. Many apps do, often without anyone
        remembering it.
      </p>

      <h2>Where this breaks</h2>
      <ul>
        <li>
          <strong>&ldquo;Is this a relay address?&rdquo; checks.</strong> Code that detects relay
          users to prompt for a real email, skip marketing, or merge accounts. New users will not
          match the old domain.
        </li>
        <li>
          <strong>Allowlists and blocklists.</strong> Sign-up validation or fraud rules that allow
          known domains, or flag unknown ones, may reject or flag new Apple users.
        </li>
        <li>
          <strong>Disposable email filters.</strong> Some block lists treat unfamiliar relay domains
          as throwaway addresses.
        </li>
        <li>
          <strong>Analytics and CRM segments</strong> built on the email domain will quietly stop
          counting new Apple users.
        </li>
        <li>
          <strong>Email delivery.</strong> Mail to relay addresses is forwarded only from sources you
          registered with Apple&apos;s private email relay service. Check that your transactional
          mail still reaches new relay users, and review your configuration in your Apple Developer
          account.
        </li>
      </ul>

      <h2>The fix</h2>
      <p>
        Centralise the check in one function and include both domains. Search your frontend and
        backend for the old domain first:
      </p>
      <Pre>{`grep -rn "privaterelay.appleid.com" --include=*.{ts,tsx,js,jsx,py,rb,go,sql} .`}</Pre>
      <p>Then replace every hit with a shared helper:</p>
      <Pre>{`const APPLE_RELAY_DOMAINS = ['privaterelay.appleid.com', 'private.icloud.com'];

export function isAppleRelayEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@').pop() ?? '';
  return APPLE_RELAY_DOMAINS.includes(domain);
}`}</Pre>
      <p>
        Do not match on <Code>icloud.com</Code> alone, and do not use a loose{' '}
        <Code>endsWith(&apos;icloud.com&apos;)</Code>. A regular <Code>@icloud.com</Code> address
        is a real mailbox that belongs to the user, not a relay.
      </p>
      <p>
        If you use Supabase, Firebase Auth or another provider, the provider stores the address as
        given. The domain checks to worry about are the ones in your own code: sign-up forms,
        onboarding flows, admin tools and database queries.
      </p>

      <Callout>
        <p>
          <strong>Also check the other direction:</strong> if you ever show a user their account
          email and explain that it is a relay address, update that copy and logic too, so new
          users do not see a confusing &ldquo;your email&rdquo; screen.
        </p>
      </Callout>

      <h2>Shipping the fix in a Capacitor app</h2>
      <p>
        Backend fixes deploy as usual. The frontend half is often the part teams forget: the check
        that decides whether to show &ldquo;add your real email&rdquo; during onboarding usually
        lives in the app&apos;s web code.
      </p>
      <p>
        In a Capacitor app that code is part of the web bundle, so it does not need App Review. With{' '}
        <A href="/">OtaKit</A> you build and release it the same afternoon:
      </p>
      <Pre>{`npm run build
npx @otakit/cli upload --release`}</Pre>
      <p>
        Users get the fix on their next app launch. The native Sign in with Apple plugin is
        unaffected; it passes through whatever email Apple returns. For the full sign-in setup, see{' '}
        <A href="/blog/capacitor-social-login-oauth">social login and OAuth in Capacitor</A>.
      </p>
    </BlogArticle>
  );
}
