import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('biometric-auth-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function BiometricAuthPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Face ID, Touch ID, and Android biometric prompts turn a clunky password re-entry into a
        half-second glance. Adding them to a Capacitor app is straightforward &mdash; the trick is doing
        it securely, which means pairing the biometric check with proper secret storage rather than
        treating the prompt as the whole security story. This guide covers both, with <A href="/">OtaKit</A>
        {' '}for iterating the flow.
      </p>

      <Callout>
        <p>
          Key mental model: a biometric prompt is a <em>gate</em>, not a <em>vault</em>. The real security
          comes from storing the secret it unlocks in the platform keystore. A biometric check with the
          token sitting in <Code>localStorage</Code> is theater.
        </p>
      </Callout>

      <h2>1. Add a biometric plugin</h2>
      <p>
        Use a maintained Capacitor biometric plugin (several community options exist). After installing:
      </p>
      <Pre>{`npx cap sync`}</Pre>
      <p>
        The native pieces &mdash; <Code>NSFaceIDUsageDescription</Code> on iOS, the biometric permission
        on Android &mdash; belong in your store build.
      </p>

      <h2>2. Gate a sensitive action</h2>
      <Pre>{`async function unlockWithBiometrics() {
  const available = await Biometric.isAvailable();
  if (!available.isAvailable) return fallbackToPassword();

  try {
    await Biometric.authenticate({ reason: 'Unlock your account' });
    return loadSessionFromSecureStorage();
  } catch {
    return fallbackToPassword();
  }
}`}</Pre>

      <h2>3. Store the secret in the keystore</h2>
      <p>
        Behind the biometric gate, keep the actual token in the iOS Keychain or Android Keystore &mdash;
        never in web storage. This is the part that makes biometric auth meaningful. See{' '}
        <A href="/blog/secure-token-storage-capacitor">secure token storage in Capacitor</A> for the how.
      </p>

      <h2>4. Always have a fallback</h2>
      <p>
        Biometrics fail: a wet fingerprint, a mask, a device without a sensor, a user who declined the
        permission. Every biometric flow needs a password or PIN fallback, or you&apos;ll lock people out
        of their own accounts.
      </p>

      <Callout>
        <p>
          The UX of the prompt &mdash; when to ask, what the fallback looks like, copy on the screen
          &mdash; is web-layer code. Ship refinements over the air with{' '}
          <Code>otakit upload --release production</Code> instead of waiting on a store review.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        Pair this with <A href="/blog/capacitor-social-login-oauth">social login</A> for the sign-in
        side, and read <A href="/docs/security">Security</A> for OtaKit&apos;s own update-integrity model.
      </p>
    </BlogArticle>
  );
}
