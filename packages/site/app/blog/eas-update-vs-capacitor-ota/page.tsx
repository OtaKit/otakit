import { BlogArticle, Callout, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('eas-update-vs-capacitor-ota')!;

export const metadata = blogPostMetadata(post.slug);

export default function EasVsCapacitorPage() {
  return (
    <BlogArticle post={post}>
      <p>
        &ldquo;EAS Update vs Capacitor OTA&rdquo; is really a question about two different app
        architectures. Expo&apos;s EAS Update is the live-update system for React Native apps built
        with Expo. Capacitor OTA (via tools like <A href="/">OtaKit</A>) is the live-update model for
        web-layer apps wrapped natively with Capacitor. You don&apos;t usually choose between them for
        the same app &mdash; you choose the stack, and the update system comes with it.
      </p>

      <Callout>
        <p>
          Mental model: EAS Update updates a React Native JS bundle; Capacitor OTA updates a web
          bundle. Same goal &mdash; ship without a store review &mdash; different runtimes.
        </p>
      </Callout>

      <h2>Side by side</h2>
      <DataTable
        headers={['', 'EAS Update', 'Capacitor OTA (OtaKit)']}
        rows={[
          ['App type', 'React Native (Expo)', 'Web app wrapped with Capacitor'],
          ['What updates', 'RN JS bundle + assets', 'Web bundle (HTML/CSS/JS)'],
          ['UI model', 'Native components', 'Web view'],
          ['Ecosystem', 'Tied to Expo tooling', 'Any web framework + your CI'],
          ['Rollback', 'Yes', 'Automatic on failed boot + channel roll-forward'],
          ['Pricing', 'Expo plan tiers', 'No MAU or bandwidth metering'],
        ]}
      />

      <h2>When EAS Update is the answer</h2>
      <p>
        If you&apos;re building in React Native with Expo, EAS Update is the natural, well-integrated
        choice. It understands RN&apos;s bundle format, plugs into EAS Build, and is maintained by
        the Expo team. There&apos;s no reason to look elsewhere for OTA if your app is Expo React
        Native.
      </p>

      <h2>When Capacitor OTA is the answer</h2>
      <p>
        If your app is a web app &mdash; React, Vue, Angular, Svelte, or anything that builds to
        static files &mdash; wrapped with Capacitor, then Capacitor OTA is what fits. It updates the
        web layer your app is actually made of, works with any web framework and your existing CI, and
        isn&apos;t tied to a single platform&apos;s build service. EAS Update doesn&apos;t serve
        Capacitor apps, so this isn&apos;t really a head-to-head for a given codebase.
      </p>

      <h2>The deeper choice: React Native or Capacitor?</h2>
      <p>
        Since the update system follows the stack, the real decision happens earlier &mdash; when you
        pick the framework. If you have web skills and want one codebase for web and mobile, Capacitor
        (plus Capacitor OTA) is fast and familiar. If you need maximum native feel and are building
        from scratch, React Native (plus EAS Update) has a higher ceiling. The full breakdown is in{' '}
        <A href="/blog/react-native-vs-capacitor">React Native vs Capacitor</A>.
      </p>

      <Callout>
        <p>
          Coming from React Native&apos;s retired CodePush and weighing your options? See{' '}
          <A href="/blog/codepush-and-expo-updates-alternatives">CodePush and Expo Updates
          alternatives</A>.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        If Capacitor fits your app, start with the <A href="/docs/setup">setup guide</A> and see the{' '}
        <A href="/blog/best-ota-tools-for-capacitor-2026">2026 OTA tools roundup</A>.
      </p>
    </BlogArticle>
  );
}
