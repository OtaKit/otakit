import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capacitor-social-login-oauth')!;

export const metadata = blogPostMetadata(post.slug);

export default function SocialLoginPage() {
  return (
    <BlogArticle post={post}>
      <p>
        &ldquo;Sign in with Google&rdquo; and &ldquo;Sign in with Apple&rdquo; are the difference between
        a signup and an abandonment for a lot of users. Doing OAuth2 well in a Capacitor app means using
        the native flow &mdash; not a web popup stuffed in a WebView &mdash; and handling the redirect
        cleanly. This guide covers the setup with Supabase as the backend, and how <A href="/">OtaKit</A>
        {' '}lets you refine the flow after launch.
      </p>

      <Callout>
        <p>
          Apple requires that if you offer any third-party social login, you also offer Sign in with
          Apple. Build both from the start or you&apos;ll hit a review rejection.
        </p>
      </Callout>

      <h2>1. Use native OAuth, not an in-WebView popup</h2>
      <p>
        Providers increasingly block OAuth inside embedded WebViews. Use a Capacitor social-login plugin
        that invokes the native flow (ASWebAuthenticationSession on iOS, Custom Tabs on Android) so the
        provider sees a real, trusted browser context.
      </p>

      <h2>2. Wire it to Supabase</h2>
      <Pre>{`import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// after the native plugin returns an id token / provider token:
const { data, error } = await supabase.auth.signInWithIdToken({
  provider: 'apple',
  token: idToken,
});`}</Pre>

      <h2>3. Handle the redirect</h2>
      <p>
        OAuth returns to your app via a deep link. Register the redirect URL with the provider and handle
        it with <Code>appUrlOpen</Code> &mdash; the same mechanism as{' '}
        <A href="/blog/capacitor-deep-links-universal-links">deep links</A>:
      </p>
      <Pre>{`import { App } from '@capacitor/app';

App.addListener('appUrlOpen', ({ url }) => {
  if (url.includes('auth/callback')) completeSignIn(url);
});`}</Pre>

      <h2>4. Store the session securely</h2>
      <p>
        Persist the returned session in the platform keystore, not web storage &mdash; see{' '}
        <A href="/blog/secure-token-storage-capacitor">secure token storage</A>. Combine with{' '}
        <A href="/blog/biometric-auth-capacitor">biometric auth</A> to gate re-entry.
      </p>

      <Callout>
        <p>
          The sign-in <em>flow</em> &mdash; button order, error messages, which providers you show, the
          post-login routing &mdash; is web-layer code. When a provider changes requirements or you add a
          new one, ship it over the air with{' '}
          <Code>otakit upload --release production</Code> rather than a full store cycle.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/docs/security">Security</A> for the update-integrity side, and{' '}
        <A href="/blog/secure-token-storage-capacitor">secure token storage</A> to finish the auth story.
      </p>
    </BlogArticle>
  );
}
