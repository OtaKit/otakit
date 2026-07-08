import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('staging-environments-capacitor-channels')!;

export const metadata = blogPostMetadata(post.slug);

export default function StagingEnvPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Web teams take dev/staging/production for granted. Mobile teams often don&apos;t have it, because
        each environment historically meant a separate build and a separate store listing. With update
        channels you get real environments from a <strong>single app ID</strong> &mdash; one installed
        binary that can follow dev, staging, or production update streams. Here&apos;s how to set that up
        with <A href="/">OtaKit</A>.
      </p>

      <Callout>
        <p>
          The key idea: a channel is an environment. The same native binary points at whichever channel
          you tell it to, and each channel carries its own stream of bundles.
        </p>
      </Callout>

      <h2>Define your channels</h2>
      <p>
        A typical setup is three channels:
      </p>
      <ul>
        <li><Code>development</Code> &mdash; bleeding edge, your team&apos;s devices.</li>
        <li><Code>staging</Code> &mdash; release candidates, QA and internal testers.</li>
        <li><Code>production</Code> &mdash; everyone.</li>
      </ul>

      <h2>Point devices at the right channel</h2>
      <p>
        The configured channel is the default; apps override it at runtime. Give your internal builds a
        way to switch &mdash; a hidden settings toggle, a build flag, or an environment check:
      </p>
      <Pre>{`import { OtaKit } from '@otakit/capacitor-plugin';

// QA build follows staging; everyone else uses the configured default
if (isInternalBuild) {
  await OtaKit.setChannel({ channel: 'staging' });
}`}</Pre>
      <p>
        See <A href="/docs/channels">Channels &amp; runtime version</A> for the switching semantics
        &mdash; the override persists across launches until you clear it.
      </p>

      <h2>The promotion flow</h2>
      <p>
        This is where single-app-ID environments pay off. You release a candidate to staging, validate it
        on real devices, then promote the <em>exact same bundle</em> to production &mdash; no rebuild, so
        what QA approved is bit-for-bit what ships:
      </p>
      <Pre>{`otakit upload --release staging
# QA signs off on the staging build, then:
otakit upload --release production`}</Pre>

      <Callout>
        <p>
          Don&apos;t rebuild between staging and production. Rebuilding reintroduces risk &mdash; a
          dependency could resolve differently, a timestamp could change a hash. Promote the artifact you
          tested. See <A href="/blog/automate-channel-promotion-ota">channel promotion</A>.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        Combine this with <A href="/blog/how-to-test-capacitor-ota-updates">testing OTA updates</A> for
        the QA loop and <A href="/blog/npm-scripts-for-capacitor-ota">npm scripts</A> to make each
        environment a one-liner.
      </p>
    </BlogArticle>
  );
}
