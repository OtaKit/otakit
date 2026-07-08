import { BlogArticle, Callout, Code, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('react-native-vs-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function ReactNativeVsCapacitorPage() {
  return (
    <BlogArticle post={post}>
      <p>
        React Native and Capacitor both let you build iOS and Android apps with JavaScript, but they
        take opposite approaches. React Native renders your UI as native views — you write
        components, it draws real <Code>UIView</Code>s and <Code>android.view</Code>s. Capacitor
        renders your UI as a web app inside a native shell — the same HTML, CSS, and JavaScript your
        browser runs, wrapped so it can reach device APIs and ship to the stores.
      </p>
      <p>
        That single difference drives everything else. Here&apos;s an honest comparison to help you
        pick — including the part most comparisons skip: how you ship updates after launch.
      </p>

      <Callout>
        <p>
          One-line version: choose React Native when the native feel of every screen is the product;
          choose Capacitor when you have web skills and want to ship one codebase to web, iOS, and
          Android fast.
        </p>
      </Callout>

      <h2>The core tradeoff</h2>
      <DataTable
        headers={['', 'React Native', 'Capacitor']}
        rows={[
          ['UI rendering', 'Native components', 'Web view (your web UI as-is)'],
          ['Reuse existing web app', 'Rewrite the UI', 'Runs unchanged'],
          ['Learning curve', 'New paradigm + native quirks', 'You already know it'],
          ['Web + mobile from one codebase', 'Web is a separate target', 'Same build ships everywhere'],
          ['Access to any npm/web library', 'Native-compatible only', 'Full web ecosystem'],
          ['Peak UI performance', 'Higher ceiling', 'Excellent for most apps'],
        ]}
      />

      <h2>Where React Native wins</h2>
      <p>
        If your app lives or dies on native-grade interactions — complex gesture-driven animations,
        heavy lists with buttery scrolling, or a design that must feel indistinguishable from a
        first-party native app on every screen — React Native&apos;s native rendering gives you a
        higher ceiling. Games, rich media editors, and interaction-heavy consumer apps are its
        sweet spot. The cost is a separate codebase from your website and a real native learning
        curve for your team.
      </p>

      <h2>Where Capacitor wins</h2>
      <p>
        If you already have (or want) a web app, Capacitor is dramatically faster to ship. Your
        existing React, Vue, Angular, or Svelte app becomes a native app with no UI rewrite, you
        keep the entire web ecosystem, and the same codebase serves web, iOS, and Android. For most
        business apps, content apps, dashboards, and tools, the web view&apos;s performance is
        indistinguishable to users — and you ship in a fraction of the time. Our{' '}
        <A href="/blog/react-to-ios-android-with-capacitor">React</A>,{' '}
        <A href="/blog/vue-to-ios-android-with-capacitor">Vue</A>, and{' '}
        <A href="/blog/nextjs-to-ios-android-with-capacitor">Next.js</A> guides show the full path.
      </p>

      <h2>The part that&apos;s easy to overlook: shipping updates</h2>
      <p>
        Both approaches face the same reality — the App Store and Google Play take days to review a
        release. Both also support over-the-air updates to close that gap. But the update stories
        differ:
      </p>
      <ul>
        <li>
          <strong>React Native</strong> historically leaned on Microsoft CodePush, which has been
          retired, pushing teams to Expo&apos;s EAS Update — which only serves React Native apps.
        </li>
        <li>
          <strong>Capacitor</strong> has a healthy field of OTA tools because updating a web layer
          is a clean, well-defined problem: OtaKit, Capgo, Capawesome, and Appflow all do it.
        </li>
      </ul>
      <p>
        Because a Capacitor update is just your web build, OTA is fast, small (especially with{' '}
        <A href="/blog/common-capacitor-ota-mistakes">delta updates</A>), and{' '}
        <A href="/blog/app-store-compliant-ota-updates">compliant with both stores</A>. With OtaKit
        you push a fix with one command:
      </p>
      <Callout>
        <p>
          If your existing skills are on the web and time-to-market matters, Capacitor plus a good
          OTA pipeline is hard to beat. If you&apos;re weighing OTA tools, see the{' '}
          <A href="/blog/best-live-update-frameworks-for-capacitor-apps">2026 comparison</A>.
        </p>
      </Callout>

      <h2>How to decide</h2>
      <ul>
        <li>
          <strong>Have a web app or web team, want speed?</strong> Capacitor.
        </li>
        <li>
          <strong>Need maximum native feel on every screen, building from scratch?</strong> React
          Native.
        </li>
        <li>
          <strong>Want one codebase for web + mobile?</strong> Capacitor.
        </li>
        <li>
          <strong>Building a game or interaction-heavy consumer app?</strong> React Native (or
          native).
        </li>
      </ul>

      <h2>Where to go next</h2>
      <p>
        If Capacitor fits, start with the <A href="/docs/setup">setup guide</A> and see{' '}
        <A href="/blog/codepush-and-expo-updates-alternatives">OTA alternatives after CodePush</A>{' '}
        for how live updates work across ecosystems.
      </p>
    </BlogArticle>
  );
}
