import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capacitor-splash-screen-guide')!;

export const metadata = blogPostMetadata(post.slug);

export default function SplashScreenPage() {
  return (
    <BlogArticle post={post}>
      <p>
        The splash screen is the first frame of your app and the last thing most teams polish. Done well,
        it hides load time and feels intentional; done poorly, it flashes, lingers, or shows a white gap.
        This guide covers configuring a native splash screen in Capacitor on iOS and Android &mdash; and
        using that moment to check for an <A href="/">OTA update</A> before the user sees stale content.
      </p>

      <h2>1. Install and configure</h2>
      <Pre>{`npm install @capacitor/splash-screen
npx cap sync`}</Pre>
      <p>
        Configure it in <Code>capacitor.config.ts</Code> &mdash; disable auto-hide so you control exactly
        when it disappears:
      </p>
      <Pre>{`plugins: {
  SplashScreen: {
    launchAutoHide: false,
    backgroundColor: '#ffffff',
  },
}`}</Pre>

      <h2>2. Generate the assets</h2>
      <p>
        Use <Code>@capacitor/assets</Code> to generate the platform-specific splash and icon sets from a
        single source image, so you&apos;re not hand-cropping for every density.
      </p>

      <h2>3. Hide it when you&apos;re actually ready</h2>
      <p>
        The point of <Code>launchAutoHide: false</Code> is to hide the splash only once your app has
        booted and rendered its first real screen &mdash; no white flash:
      </p>
      <Pre>{`import { SplashScreen } from '@capacitor/splash-screen';

// after your app shell has mounted and data is ready
await SplashScreen.hide();`}</Pre>

      <h2>4. Check for an update behind the splash</h2>
      <p>
        This is the OTA-native trick: the splash is the perfect cover for an update check. If an update is
        already downloaded and ready, applying it before you hide the splash means the user boots straight
        into the newest bundle &mdash; no visible reload:
      </p>
      <Pre>{`import { OtaKit } from '@otakit/capacitor-plugin';

const state = await OtaKit.getState();
// let a ready update apply, then reveal the app
await SplashScreen.hide();`}</Pre>
      <p>
        See <A href="/blog/background-vs-foreground-app-updates">background vs foreground updates</A> for
        how apply-on-launch fits your update UX.
      </p>

      <Callout>
        <p>
          Don&apos;t hold the splash hostage to a slow network. Set a sensible timeout &mdash; if the
          update check or first data load stalls, hide the splash and show the app anyway. A splash that
          never leaves reads as a crash.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/capacitor-edge-to-edge-display">edge-to-edge display</A> for the rest of the
        first-launch polish, and <A href="/docs/update-strategies">update strategies</A> for apply timing.
      </p>
    </BlogArticle>
  );
}
