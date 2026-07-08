import { BlogArticle, Callout, Code, Pre, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('semantic-versioning-for-ota-bundles')!;

export const metadata = blogPostMetadata(post.slug);

export default function SemverBundlesPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Versioning gets confusing with OTA because there are really two versions in play: the native
        app version that goes through the store, and the web bundle version that ships over the air.
        Keep them straight and releases stay predictable. Blur them and you get bundles reaching
        shells that can&apos;t run them. This guide lays out a simple, durable scheme for{' '}
        <A href="/">OtaKit</A>.
      </p>

      <Callout>
        <p>
          Mental model: the store version answers &ldquo;which native shell is this?&rdquo; The
          bundle version answers &ldquo;which web build is this?&rdquo; A third value &mdash; runtime
          version &mdash; connects them.
        </p>
      </Callout>

      <h2>The three numbers that matter</h2>
      <DataTable
        headers={['Value', 'What it identifies', 'Changes when']}
        rows={[
          ['App version (store)', 'The native binary users installed', 'You submit to the App Store / Play'],
          ['Bundle version', 'A specific web build', 'Every OTA release'],
          ['Runtime version', 'Which shells a bundle is compatible with', 'Native code changes'],
        ]}
      />

      <h2>Version bundles with semver</h2>
      <p>
        Treat each OTA bundle like a package release. A pragmatic reading of semver for web bundles:
      </p>
      <ul>
        <li>
          <strong>Patch</strong> (1.4.<strong>1</strong>) &mdash; bug fixes, copy, styling. Safe,
          frequent, background updates.
        </li>
        <li>
          <strong>Minor</strong> (1.<strong>5</strong>.0) &mdash; new features that don&apos;t need
          new native capabilities. Still OTA-able.
        </li>
        <li>
          <strong>Major</strong> (<strong>2</strong>.0.0) &mdash; usually paired with a native change,
          which means a store release and a runtime version bump.
        </li>
      </ul>

      <h2>Runtime version is the compatibility contract</h2>
      <p>
        This is the one that prevents crashes. When a store build changes native code &mdash; a new
        plugin, a permission, a Capacitor upgrade &mdash; bump <Code>runtimeVersion</Code>. Bundles
        are matched to compatible shells, so a bundle built for the new native surface never lands on
        an old install that can&apos;t run it.
      </p>
      <Pre>{`// capacitor.config.ts
const config: CapacitorConfig = {
  appId: "com.example.myapp",
  appName: "My App",
  webDir: "dist",
  plugins: {
    OtaKit: {
      appId: "YOUR_OTAKIT_APP_ID",
      runtimeVersion: "2", // bump when native code changes
    },
  },
};`}</Pre>
      <p>
        OtaKit also checks your bundle&apos;s dependencies at upload time and warns when it detects
        native code the target shells don&apos;t have &mdash; a safety net on top of the version you
        set.
      </p>

      <h2>A workable convention</h2>
      <ol>
        <li>Keep the native app version and runtime version in lockstep for store releases.</li>
        <li>Increment bundle patch/minor freely for OTA releases against the same runtime.</li>
        <li>
          When you cut a store release with native changes, bump runtime version and start the new
          bundle line there.
        </li>
      </ol>

      <Callout>
        <p>
          If a change forces a <Code>runtimeVersion</Code> bump, it&apos;s a store release &mdash; not
          an OTA update. That single rule keeps your versioning honest.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/docs/channels">channels &amp; runtime version</A> for the API, and{' '}
        <A href="/blog/common-capacitor-ota-mistakes">common OTA mistakes</A> for the versioning
        traps to avoid.
      </p>
    </BlogArticle>
  );
}
