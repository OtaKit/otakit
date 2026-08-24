import { BlogArticle, Callout, Code, Pre, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capacitor-ota-update-security')!;

export const metadata = blogPostMetadata(post.slug);

export default function OtaSecurityPage() {
  return (
    <BlogArticle post={post}>
      <p>
        An over-the-air update pipeline pushes executable code to production devices. That makes it
        one of the most sensitive parts of your stack: if an attacker can influence what a device
        installs, they own your app. The good news is that a well-built OTA system closes every step
        of that path — and once you understand the threat model, verifying that your setup is safe
        takes minutes.
      </p>
      <p>
        This guide walks the update path from your machine to the device, names what can go wrong at
        each hop, and shows how to shut it down — with <A href="/">OtaKit</A> as the concrete
        example.
      </p>

      <Callout>
        <p>
          Mental model: a device should never install &ldquo;whatever the server points at.&rdquo;
          It should install only a bundle it can cryptographically prove you published.
        </p>
      </Callout>

      <h2>The threat model in one table</h2>
      <DataTable
        headers={['Where', 'What could go wrong', 'The defense']}
        rows={[
          ['In transit', 'Man-in-the-middle swaps the bundle', 'HTTPS + signed manifest'],
          ['At the CDN / storage', 'Compromised host serves a tampered file', 'SHA-256 hash pinning'],
          ['At the control plane', 'Attacker publishes a malicious release', 'Signing key you hold, not the server'],
          ['On the device', 'A bad bundle bricks the app', 'Health handshake + auto-rollback'],
          ['Bundle contents', 'Sensitive JS/config readable at rest', 'End-to-end encryption'],
        ]}
      />

      <h2>1. Sign the manifest, verify on device</h2>
      <p>
        The single most important control is signature verification. Before downloading anything,
        the plugin fetches a manifest describing the release and verifies its signature against a
        public key pinned inside the app binary. OtaKit signs manifests with ES256; the private key
        lives with you, never on the device. A compromised server can point at a malicious file, but
        it can&apos;t forge a manifest the device will accept.
      </p>

      <h2>2. Pin the bundle hash</h2>
      <p>
        The verified manifest declares the exact SHA-256 hash of the bundle. After download, the
        device recomputes the hash and compares byte-for-byte. A tampered or truncated file fails
        the check and is discarded — the update simply doesn&apos;t apply. This is what makes CDN
        delivery safe: even if edge storage is compromised, an altered bundle can&apos;t match a
        hash your signing key vouched for.
      </p>

      <h2>3. Encrypt end to end when contents are sensitive</h2>
      <p>
        Signing proves <em>authenticity</em>; it doesn&apos;t hide contents. If your bundle embeds
        anything you&apos;d rather storage and CDN operators never see, turn on end-to-end
        encryption. OtaKit encrypts bundles with AES-256-GCM using a key only you hold, so the
        server stores ciphertext and the device decrypts locally. Read the mechanics in the{' '}
        <A href="/docs/security">security docs</A>.
      </p>

      <h2>4. Control who can publish</h2>
      <p>
        The control plane is a target too. Two habits matter: keep the signing key out of shared
        chat and generic CI logs, and scope release tokens. In CI, inject the OtaKit token as a
        masked secret and give it only the permissions the pipeline needs — see{' '}
        <A href="/blog/automate-capacitor-ota-releases-github-actions">the CI guide</A> for a safe
        setup. Rotate tokens when someone leaves the team.
      </p>

      <h2>5. Make a bad release non-fatal</h2>
      <p>
        Security isn&apos;t only about attackers — a buggy release you shipped yourself is the most
        common way to break production. OtaKit keeps three bundles on device (current, fallback,
        staged) and treats every freshly activated bundle as unproven. Your app confirms a
        successful boot with <Code>notifyAppReady()</Code>; if that call doesn&apos;t arrive within
        the ready window, the device rolls back to the last known-good bundle automatically.
      </p>
      <Pre>{`import { OtaKit } from "@otakit/capacitor-updater";

// call once your app has booted and rendered
await OtaKit.notifyAppReady();`}</Pre>
      <p>
        Pair that with <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollouts</A>{' '}
        so a mistake reaches 5% of users, not 100%, before you catch it.
      </p>

      <h2>6. Keep native compatibility explicit</h2>
      <p>
        A subtle safety issue: shipping a web bundle that calls native code the installed shell
        doesn&apos;t have. Bump <Code>runtimeVersion</Code> whenever you release a store build with
        new native capabilities, so old shells stay on bundles they can actually run. OtaKit also
        checks dependencies at upload time and warns before you release a mismatch.
      </p>

      <Callout>
        <p>
          Quick audit: signed manifest, hash-pinned bundle, HTTPS-only, scoped CI token, auto-
          rollback wired up, and runtimeVersion bumped on native changes. Six checks, and your OTA
          pipeline is boring in the best way.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/how-ota-works-for-capacitor-apps">how OTA works end to end</A> for the
        full delivery flow, and the <A href="/docs/security">security docs</A> for signing keys and
        encryption setup.
      </p>
    </BlogArticle>
  );
}
