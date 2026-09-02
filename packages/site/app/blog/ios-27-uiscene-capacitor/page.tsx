import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('ios-27-uiscene-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function Ios27UiScenePage() {
  return (
    <BlogArticle post={post}>
      <p>There is a specific error waiting for iOS developers this autumn, and it is not subtle:</p>
      <Pre>{`Application failed to launch: UIScene life cycle is required
for apps built with this SDK`}</Pre>
      <p>
        Not a crash on a screen. Not a degraded feature. The app does not start. Apps built against
        the iOS 27 SDK must adopt the scene-based lifecycle, and one built without it terminates at
        launch on every device it reaches. Capacitor apps are not exempt &mdash; and neither is any
        other web-to-native framework, as{' '}
        <A href="https://github.com/expo/expo/issues/46663">Expo&apos;s own bug reports</A> from the
        Xcode 27 betas show.
      </p>

      <Callout>
        <p>
          <strong>Who is affected right now:</strong> only builds compiled with the iOS 27 SDK,
          which means Xcode 27. An app already on the App Store, built with Xcode 26, keeps running
          on iOS 27 devices exactly as before. This is a build-time cliff, not a device-side one
          &mdash; which is precisely why it catches teams the first time they open the new Xcode.
        </p>
      </Callout>

      <h2>Why Apple did this</h2>
      <p>
        <Code>UIApplicationDelegate</Code>-driven startup dates from single-window iPhones. Scenes,
        added in iOS 13, model an app as one or more UI instances the system can create, background
        and discard independently &mdash; the model iPadOS multitasking, Stage Manager, CarPlay and
        visionOS already assume. Apple has been asking for seven years; with the iOS 27 SDK it
        stopped asking. The migration reference is Apple&apos;s Technote{' '}
        <A href="https://developer.apple.com/documentation/technotes/tn3187-migrating-to-the-uikit-scene-based-life-cycle">
          TN3187
        </A>
        .
      </p>
      <p>
        The practical consequence people miss: an app that will not launch cannot receive a push
        notification, cannot run a background refresh, and cannot report a crash. Every telemetry
        signal you would normally use to notice a problem goes quiet at the same moment.
      </p>

      <h2>The Capacitor migration is two commands</h2>
      <p>
        Capacitor 8.5, released 31 July 2026, adopted UIScene. Ionic shipped it as a breaking minor
        specifically so the migration would land before the iOS 27 SDK became unavoidable. Update
        the CLI and run the migrator:
      </p>
      <Pre>{`npm i -D @capacitor/cli@latest
npx cap migrate`}</Pre>
      <p>
        What it changes on the iOS side is small and worth reading in the diff: a{' '}
        <Code>UIApplicationSceneManifest</Code> entry in <Code>Info.plist</Code>, a scene delegate
        wired to Capacitor&apos;s bridge, and the app delegate&apos;s window handling moved to the
        scene. The official notes are at{' '}
        <A href="https://capacitorjs.com/docs/updating/8-5">capacitorjs.com/docs/updating/8-5</A>,
        and Ionic also ships a <Code>capacitor-uiscene-migrator</Code> agent skill for projects the
        automated path does not fully handle.
      </p>

      <h2>Where it goes wrong</h2>
      <ul>
        <li>
          <strong>
            A custom <Code>AppDelegate</Code>.
          </strong>{' '}
          If you added push handling, deep-link routing or third-party SDK bootstrapping to{' '}
          <Code>AppDelegate.swift</Code>, the migrator will not always know which callbacks belong
          on the scene. Lifecycle callbacks (<Code>applicationDidBecomeActive</Code> and friends)
          move; process-level ones (<Code>didFinishLaunchingWithOptions</Code>) stay.
        </li>
        <li>
          <strong>Plugins that assume a key window.</strong> Anything reaching for{' '}
          <Code>UIApplication.shared.windows.first</Code> is on borrowed time. Update the plugin, or
          read the window from the connected scene.
        </li>
        <li>
          <strong>Deep links and universal links.</strong> Cold-start URL delivery arrives through
          the scene&apos;s connection options rather than the app delegate. Test the cold path, not
          just the warm one &mdash; see{' '}
          <A href="/blog/capacitor-deep-links-universal-links">deep links in Capacitor</A>.
        </li>
        <li>
          <strong>Push notification taps.</strong> Same story: the launch-from-notification path is
          the one that silently stops working, and it is the one nobody re-tests.
        </li>
      </ul>

      <h2>How much time do you actually have?</h2>
      <p>
        Apple&apos;s current floor, in force since <strong>28 April 2026</strong>, is the iOS 26 SDK
        or later for anything uploaded to App Store Connect. So you are not yet compelled onto Xcode
        27, and an app built with Xcode 26 can still be submitted today.
      </p>
      <p>
        That is the letter of it. In practice the timer is shorter than the letter suggests: Apple
        raises the floor roughly every spring, Xcode 27 is Apple-silicon only, and the day you need
        to debug something that only reproduces on iOS 27 you will need the new SDK anyway. Treat
        8.5 as work for this quarter rather than next. Do it while nothing is on fire and it is a
        routine merge; do it under a deadline and it is an outage.
      </p>

      <Callout>
        <p>
          <strong>This is the honest limit of over-the-air updates.</strong> A launch-time native
          failure cannot be repaired from the web layer &mdash; if the app terminates before the
          WebView exists, there is nothing to update. Ship the UIScene migration as a store build.{' '}
          <A href="/">OtaKit</A> covers what comes after: the web-layer fallout from a native
          upgrade, shipped the same day instead of the next review cycle. See{' '}
          <A href="/blog/capacitor-ota-rollback-strategies">rollback strategies</A> for the safety
          net.
        </p>
      </Callout>

      <h2>A migration order that works</h2>
      <ul>
        <li>
          Upgrade to Capacitor 8.5 or later and run <Code>npx cap migrate</Code> on a branch.
        </li>
        <li>
          Build with Xcode 27 and launch on an iOS 27 simulator. It either starts or it does not
          &mdash; a fast, binary signal.
        </li>
        <li>Re-test cold start from a push notification and from a universal link.</li>
        <li>
          Audit plugins for <Code>UIApplication.shared.windows</Code> usage.
        </li>
        <li>Ship it as a normal release, ahead of any deadline, with nothing else in the build.</li>
      </ul>

      <h2>Where to go next</h2>
      <p>
        <A href="/blog/xcode-26-capacitor-requirement">Apple&apos;s Xcode and SDK requirements</A>{' '}
        covers the submission floor and how CI trips over it, and{' '}
        <A href="/blog/capacitor-spm-migration">the SPM migration guide</A> covers the other iOS
        housekeeping worth clearing this year.
      </p>
    </BlogArticle>
  );
}
