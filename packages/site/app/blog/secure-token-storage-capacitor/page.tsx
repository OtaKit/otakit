import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('secure-token-storage-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function SecureTokenStoragePage() {
  return (
    <BlogArticle post={post}>
      <p>
        Where you keep auth tokens decides how secure your app actually is. It&apos;s tempting to drop a
        JWT in <Code>localStorage</Code> because it&apos;s one line &mdash; but on a mobile device that
        storage is readable in ways it isn&apos;t on a locked-down web origin. This guide covers doing it
        right in Capacitor with the iOS Keychain and Android Keystore, and why it matters for the whole
        app, including <A href="/">OTA</A>.
      </p>

      <Callout>
        <p>
          Rule: secrets &mdash; access tokens, refresh tokens, encryption keys &mdash; go in the platform
          secure storage. Non-sensitive state can live in web storage. If leaking it would compromise an
          account, it doesn&apos;t belong in <Code>localStorage</Code>.
        </p>
      </Callout>

      <h2>Why localStorage is the wrong home</h2>
      <ul>
        <li>It&apos;s plain text in the WebView&apos;s storage, not hardware-backed.</li>
        <li>It persists indefinitely and isn&apos;t tied to device unlock or biometrics.</li>
        <li>On a compromised or rooted device it&apos;s trivially readable.</li>
      </ul>

      <h2>Use the platform keystore</h2>
      <p>
        The iOS Keychain and Android Keystore are purpose-built for this: OS-level, often
        hardware-backed, and able to require device unlock or biometrics before releasing a value. Use a
        Capacitor secure-storage plugin that wraps them:
      </p>
      <Pre>{`// store on login
await SecureStorage.set({ key: 'refresh_token', value: token });

// read when you need it
const { value } = await SecureStorage.get({ key: 'refresh_token' });`}</Pre>

      <h2>Gate access with biometrics</h2>
      <p>
        For extra-sensitive tokens, require a biometric check before the keystore releases the value
        &mdash; combining the two gives you &ldquo;encrypted at rest and unlocked only by the user.&rdquo;
        See <A href="/blog/biometric-auth-capacitor">biometric authentication</A>.
      </p>

      <h2>The connection to OTA security</h2>
      <p>
        Token storage and update integrity are two halves of the same posture: don&apos;t trust the client
        blindly. OtaKit signs and verifies every bundle before it activates, so an attacker can&apos;t push
        code that exfiltrates your tokens; you store the tokens where that code &mdash; or any other
        &mdash; can&apos;t read them casually. Neither alone is enough. See{' '}
        <A href="/blog/capacitor-ota-update-security">OTA update security</A>.
      </p>

      <Callout>
        <p>
          When a token leaks or a session must end, you want to revoke server-side and clear the keystore
          client-side. Build a &ldquo;sign out everywhere&rdquo; path that does both &mdash; and you can
          ship improvements to that path over the air.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/docs/security">Security</A> for OtaKit&apos;s model, and{' '}
        <A href="/blog/capacitor-social-login-oauth">social login</A> for where these tokens come from.
      </p>
    </BlogArticle>
  );
}
