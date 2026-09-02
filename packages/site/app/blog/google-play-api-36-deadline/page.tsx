import { BlogArticle, Callout, Code, Pre, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('google-play-api-36-deadline')!;

export const metadata = blogPostMetadata(post.slug);

export default function GooglePlayApi36Page() {
  return (
    <BlogArticle post={post}>
      <p>
        The deadline has passed. Since <strong>31 August 2026</strong>, Google Play requires new
        apps and app updates to target <strong>Android 16 (API level 36)</strong> or higher. Submit
        a build that targets anything lower and Play Console rejects it &mdash; not at review, at
        upload. If you have not shipped since the summer, the next release you try to push is the
        one that finds out.
      </p>

      <h2>What Google actually requires</h2>
      <p>
        Two separate rules are in play, and teams routinely confuse them. One governs what you may
        <em>submit</em>; the other governs whether an app you have already shipped stays
        installable.
      </p>

      <DataTable
        headers={[
          'App type',
          'New apps & updates',
          'Existing apps, to stay available to new users',
        ]}
        rows={[
          ['Phones & tablets', 'API 36 (Android 16)', 'API 35 (Android 15)'],
          [
            'Wear OS, Android Automotive',
            'API 35 (Android 15)',
            'API 33 or lower is already restricted',
          ],
          [
            'Android TV, Android XR',
            'API 34 (Android 14)',
            'API 33 or lower is already restricted',
          ],
        ]}
      />

      <p>
        An app that stops being updated is not removed. It becomes invisible to <em>new</em> users
        whose device runs a newer Android than the app targets. Everyone who already installed it
        keeps it. That is why this failure mode is quiet: installs taper off while nothing appears
        broken.
      </p>

      <Callout>
        <p>
          If you cannot make the change in time, Play Console offers a one-time extension to{' '}
          <strong>1 November 2026</strong>. It is a form, not a negotiation &mdash; request it
          before you need it. Permanently private apps distributed only inside an organisation are
          out of scope entirely.
        </p>
      </Callout>

      <h2>What this means for a Capacitor app</h2>
      <p>
        Less than you might fear. Capacitor&apos;s Android template already ships{' '}
        <Code>compileSdkVersion 36</Code> and <Code>targetSdkVersion 36</Code>, so a project
        generated on a current Capacitor version is compliant out of the box. The apps that get
        caught are the ones that pinned these values by hand, years ago, and never revisited them.
      </p>
      <p>
        Open <Code>android/variables.gradle</Code> and read what is actually there:
      </p>
      <Pre>{`ext {
    minSdkVersion = 24
    compileSdkVersion = 36
    targetSdkVersion = 36
    androidxActivityVersion = '1.9.2'
    // ...
}`}</Pre>
      <p>
        If <Code>targetSdkVersion</Code> is 34 or 35, raise it to 36 and rebuild. Then check the
        three places a stale value hides:
      </p>
      <ul>
        <li>
          <strong>Plugins with their own Gradle config.</strong> A community plugin that hard-codes
          an older <Code>compileSdk</Code> will hold your build back. Bump the plugin, or fork it.
        </li>
        <li>
          <strong>
            Your own <Code>build.gradle</Code> overrides.
          </strong>{' '}
          Values set directly in <Code>android/app/build.gradle</Code> win over{' '}
          <Code>variables.gradle</Code>.
        </li>
        <li>
          <strong>The Play Console warnings you have been dismissing.</strong> Billing, permissions
          and SDK notices surface there months before they become blocking.
        </li>
      </ul>

      <h2>Targeting 36 is not the same as running on 16</h2>
      <p>
        Raising <Code>targetSdkVersion</Code> tells Android to stop applying compatibility shims to
        your app. The behaviour changes come with it, whether or not you tested for them. The two
        that bite Capacitor apps hardest are edge-to-edge display and the 16 KB page size
        requirement &mdash; both native-side, both invisible until you run on a real Android 16
        device.
      </p>
      <p>
        See <A href="/blog/capacitor-edge-to-edge-display">edge-to-edge display in Capacitor</A> and{' '}
        <A href="/blog/android-16kb-page-size-capacitor">the 16 KB page size requirement</A> for the
        specifics, and{' '}
        <A href="/blog/fix-capacitor-android-build-errors">fixing Capacitor Android build errors</A>{' '}
        when the bump itself will not compile.
      </p>

      <h2>What an OTA update can and cannot do here</h2>
      <p>
        It cannot do this. <Code>targetSdkVersion</Code> lives in the native binary; changing it
        means a new store submission, full stop. Anyone who tells you otherwise is selling
        something.
      </p>
      <Callout>
        <p>
          What over-the-air updates <em>are</em> good for is the gap. Once the compliant native
          build is in review, every web-layer bug you find &mdash; and you will find some, because
          you just changed the platform contract &mdash; ships in minutes instead of waiting for the
          next binary. <A href="/">OtaKit</A> exists for exactly that window. See{' '}
          <A href="/blog/deploy-hotfixes-capacitor-ota">shipping hotfixes over the air</A>.
        </p>
      </Callout>

      <h2>A checklist for this week</h2>
      <ul>
        <li>
          Read <Code>android/variables.gradle</Code>; confirm <Code>targetSdkVersion = 36</Code>.
        </li>
        <li>
          Build and run on an Android 16 device or emulator &mdash; not just the CI green checkmark.
        </li>
        <li>Walk the app: insets and status bar, file pickers, notifications, background work.</li>
        <li>Check Play Console for policy warnings you have not read.</li>
        <li>If you will miss it, request the extension to 1 November 2026 today.</li>
        <li>Ship the native build, then keep the web layer moving over the air.</li>
      </ul>

      <h2>Where to go next</h2>
      <p>
        <A href="/blog/google-play-ota-compliance-checklist">
          The Google Play OTA compliance checklist
        </A>{' '}
        covers what Play allows once your app is current, and{' '}
        <A href="/docs/setup">the setup guide</A> gets live updates running alongside your store
        releases.
      </p>
    </BlogArticle>
  );
}
