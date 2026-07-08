import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('self-hosted-capacitor-live-updates')!;

export const metadata = blogPostMetadata(post.slug);

export default function SelfHostedPage() {
  return (
    <BlogArticle post={post}>
      <p>
        For some teams, &ldquo;send your users&apos; update traffic through a vendor&rdquo; is a
        non-starter &mdash; compliance, data residency, or just a hard rule against critical
        infrastructure you don&apos;t control. The usual catch is that &ldquo;self-hosting&rdquo; turns
        out to be a gated enterprise SKU. With <A href="/">OtaKit</A> it isn&apos;t: the whole stack is
        MIT-licensed, and self-hosting is a first-class path, not a sales conversation.
      </p>

      <Callout>
        <p>
          What makes this practical is OtaKit&apos;s delivery model. Updates are served as a static,
          signed manifest from a CDN or object store per <Code>(app, channel, runtimeVersion)</Code>
          &mdash; there&apos;s no per-device dynamic endpoint to operate. That&apos;s the difference
          between hosting a web server and hosting a database-backed service under your users&apos;
          launch traffic.
        </p>
      </Callout>

      <h2>What &ldquo;self-hosted&rdquo; actually means here</h2>
      <p>
        Two independent pieces, and you can self-host either or both:
      </p>
      <ul>
        <li>
          <strong>Update delivery</strong> &mdash; the signed bundles and manifest. Because these are
          static files, hosting them is just object storage plus a CDN. Cheap, cacheable, and
          effectively unbreakable under load.
        </li>
        <li>
          <strong>The control plane</strong> &mdash; the API and console you use to cut releases and
          manage channels. Run it on your own infrastructure alongside your other services.
        </li>
      </ul>

      <h2>Why the static model matters</h2>
      <p>
        A lot of update services route every device check through a dynamic per-device endpoint that
        computes what to serve. That&apos;s powerful, but it means self-hosting is operating a
        request-per-launch backend &mdash; with all the scaling and reliability burden that implies.
        OtaKit precomputes the manifest per lane and serves it statically, so your self-hosted setup
        inherits the reliability of a CDN, not the fragility of a hot path.
      </p>

      <h2>The moving parts</h2>
      <ol>
        <li>Object storage (S3-compatible) plus a CDN in front of it for bundle delivery.</li>
        <li>The OtaKit control-plane service and its database, on your infrastructure.</li>
        <li>Your signing keys, generated and held by you:</li>
      </ol>
      <Pre>{`otakit generate-signing-key
otakit generate-encryption-key   # optional, for end-to-end encryption`}</Pre>
      <p>
        Because you hold the signing key, bundles are cryptographically yours end to end &mdash; the
        device only activates a bundle whose hash matches your signed manifest. See{' '}
        <A href="/blog/capacitor-ota-update-security">OTA update security</A> for the model.
      </p>

      <h2>Self-host vs managed: how to choose</h2>
      <ul>
        <li>
          <strong>Managed</strong> if you want zero infrastructure and are comfortable with
          CDN-direct delivery from OtaKit&apos;s hosting. Still no MAU/bandwidth metering.
        </li>
        <li>
          <strong>Self-hosted</strong> if you have data-residency, compliance, or control
          requirements &mdash; you own the storage, the CDN, and the keys.
        </li>
      </ul>
      <p>
        The comparison of both against a roll-your-own approach is in{' '}
        <A href="/blog/capacitor-ota-hosting-options-compared">hosting options compared</A>, and the
        licensing angle in{' '}
        <A href="/blog/open-source-vs-proprietary-ota-updates">open source vs proprietary</A>.
      </p>

      <Callout>
        <p>
          Self-hosting an open-source stack also means no lock-in: if you ever want to move delivery to
          a different CDN or bring the control plane fully in-house, nothing about the format stops
          you.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        The <A href="/docs/self-host">self-hosting docs</A> have the deployment specifics; start there,
        then <A href="/docs/security">Security</A> for key management.
      </p>
    </BlogArticle>
  );
}
