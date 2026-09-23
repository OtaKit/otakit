import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capacitor-performance-checklist')!;

export const metadata = blogPostMetadata(post.slug);

export default function CapacitorPerformancePage() {
  return (
    <BlogArticle post={post}>
      <p>
        &ldquo;It feels like a website&rdquo; is the most common complaint about Capacitor apps, and
        it is almost never Capacitor&apos;s fault. The WebView on a current iPhone or Android phone
        is fast. What makes an app feel slow is a large JavaScript bundle on startup, a splash screen
        that hides too early, scrolling that bounces the whole page, and taps that highlight like
        links.
      </p>
      <p>
        This checklist covers the fixes that make the biggest difference, grouped by where users
        notice them. Nearly all of them are web changes.
      </p>

      <h2>First, measure on a real device</h2>
      <p>
        Your laptop hides most performance problems. Test on a mid-range Android phone, which is
        what many of your users have.
      </p>
      <ul>
        <li>
          <strong>iOS:</strong> enable Web Inspector on the device, then use Safari&apos;s Develop
          menu to open the Timelines tab for your app.
        </li>
        <li>
          <strong>Android:</strong> open <Code>chrome://inspect</Code> in desktop Chrome with the
          phone connected and use the Performance panel.
        </li>
        <li>Always test a production build, never the dev server.</li>
      </ul>

      <h2>Startup</h2>
      <ol>
        <li>
          <strong>Hide the splash screen yourself.</strong> Set <Code>launchAutoHide: false</Code>{' '}
          and call <Code>SplashScreen.hide()</Code> after your first screen has rendered. Otherwise
          users see a blank white WebView between the splash and your UI.
        </li>
      </ol>
      <Pre>{`// capacitor.config.ts
plugins: {
  SplashScreen: { launchAutoHide: false },
},

// after the first screen renders
import { SplashScreen } from '@capacitor/splash-screen';
await SplashScreen.hide();`}</Pre>
      <ol start={2}>
        <li>
          <strong>Ship less JavaScript at startup.</strong> Split by route and lazy-load screens the
          user does not see first. Settings, onboarding and admin screens rarely belong in the main
          chunk.
        </li>
        <li>
          <strong>Do not wait for the network to show something.</strong> Render from cached data
          and refresh in the background. An app that shows yesterday&apos;s data instantly feels
          faster than one that shows a spinner.
        </li>
        <li>
          <strong>Move non-urgent work after first paint.</strong> Analytics, feature flag fetches,
          remote config and error reporting setup can wait until the UI is visible.
        </li>
        <li>
          <strong>Bundle your fonts.</strong> Load fonts from your app&apos;s assets, not a font
          CDN, and use <Code>font-display: swap</Code>. See{' '}
          <A href="/blog/reduce-capacitor-app-bundle-size">reducing bundle size</A>.
        </li>
      </ol>

      <h2>Touch and scrolling</h2>
      <p>These CSS rules remove most of the &ldquo;website&rdquo; feel in one go:</p>
      <Pre>{`html, body {
  overscroll-behavior: none;          /* no rubber-banding of the whole page */
  -webkit-tap-highlight-color: transparent;
  -webkit-touch-callout: none;        /* no long-press link preview */
}

body {
  user-select: none;                  /* allow it again on real text fields and content */
  -webkit-user-select: none;
}

input, textarea, [contenteditable], .selectable {
  user-select: text;
  -webkit-user-select: text;
}

button, a, [role="button"] {
  touch-action: manipulation;         /* no double-tap zoom delay */
}`}</Pre>
      <ol start={6}>
        <li>
          <strong>Scroll inside containers, not the body.</strong> Fix the header and tab bar and let
          the content area scroll. The app then behaves like a native screen instead of a page.
        </li>
        <li>
          <strong>Give feedback on press.</strong> A subtle <Code>:active</Code> style, or a light
          haptic via <Code>@capacitor/haptics</Code> for important actions, makes taps feel
          registered.
        </li>
        <li>
          <strong>Virtualize long lists.</strong> Rendering 2,000 rows kills scrolling on mid-range
          Android. Render only what is visible.
        </li>
      </ol>

      <h2>Animation and rendering</h2>
      <ol start={9}>
        <li>
          <strong>Animate only <Code>transform</Code> and <Code>opacity</Code>.</strong> Animating
          width, height, top or left forces layout on every frame.
        </li>
        <li>
          <strong>Avoid heavy blur and big shadows on scrolling content.</strong>{' '}
          <Code>backdrop-filter</Code> on a list is expensive, especially on Android.
        </li>
        <li>
          <strong>Keep the main thread free.</strong> Move parsing, sorting and crypto for large
          data into a Web Worker.
        </li>
        <li>
          <strong>Respect reduced motion.</strong> Use{' '}
          <Code>@media (prefers-reduced-motion: reduce)</Code> to shorten or remove transitions.
        </li>
      </ol>

      <h2>Images and memory</h2>
      <ol start={13}>
        <li>
          <strong>Serve images at display size.</strong> A 4000px photo in a 120px thumbnail wastes
          memory and decode time. Resize on the server or at upload.
        </li>
        <li>
          <strong>Use modern formats.</strong> WebP and AVIF are supported by current WebViews and
          are much smaller than JPEG and PNG.
        </li>
        <li>
          <strong>Lazy-load offscreen images</strong> with <Code>loading=&quot;lazy&quot;</Code>.
        </li>
        <li>
          <strong>Clean up.</strong> Remove event listeners, stop intervals and release object URLs
          when screens unmount. Leaks add up in an app that stays open for days. Google Play is
          adding memory usage thresholds to its quality requirements in February 2027, so this
          matters for Android visibility too.
        </li>
      </ol>

      <h2>Native details</h2>
      <ol start={17}>
        <li>
          <strong>Configure the keyboard.</strong> With <Code>@capacitor/keyboard</Code>, choose the
          resize mode that fits your layout, so inputs are not hidden and the page does not jump.
        </li>
        <li>
          <strong>Match the status bar and safe areas.</strong> A status bar that does not match
          your header is the fastest giveaway. See{' '}
          <A href="/blog/capacitor-edge-to-edge-display">edge-to-edge display</A>.
        </li>
        <li>
          <strong>Use native plugins where the web is weak.</strong> Haptics, share sheets, file
          pickers and biometrics feel wrong when imitated in HTML.
        </li>
        <li>
          <strong>Make it work offline.</strong> Cache the data users need most and show it without
          a network. See <A href="/blog/capacitor-offline-support">offline support</A>.
        </li>
      </ol>

      <Callout>
        <p>
          <strong>Most of these fixes are web changes.</strong> Only new native plugins and changes
          to plugin settings in <Code>capacitor.config.ts</Code> (which is copied into the native
          project at sync time) need a store build. Everything else can ship as a web update.
        </p>
      </Callout>

      <h2>Ship performance work continuously</h2>
      <p>
        Performance work goes best in small steps: change one thing, measure on a real device,
        ship, check real-user numbers, repeat. That loop breaks down when every step waits for App
        Review.
      </p>
      <p>
        With <A href="/">OtaKit</A>, each improvement goes to users as a web update, and delta
        updates mean devices download only the files that changed. Release to a small group first
        with a <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollout</A>,
        compare, and then release to everyone. Small, frequent improvements are how an app that
        feels like a website becomes one that feels native.
      </p>
    </BlogArticle>
  );
}
