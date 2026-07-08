import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('migrate-cordova-to-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function CordovaMigrationPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Cordova has been in maintenance mode for years, and the plugin ecosystem it depended on is
        thinning out. Capacitor is the modern successor: same idea &mdash; your web app in a native
        shell &mdash; but with maintained tooling, first-class native project access, and a healthy
        plugin ecosystem. The migration is more &ldquo;adopt a new native layer&rdquo; than
        &ldquo;rewrite,&rdquo; and it unlocks something Cordova never had cleanly:{' '}
        <A href="/">over-the-air updates</A>.
      </p>

      <Callout>
        <p>
          Good news up front: your web app &mdash; HTML, CSS, JS, and your framework &mdash; comes
          across essentially unchanged. What changes is the native wrapper and how plugins are wired.
        </p>
      </Callout>

      <h2>The mental-model shift</h2>
      <p>
        Cordova hides the native projects and generates them from config and plugins. Capacitor treats
        the <Code>ios/</Code> and <Code>android/</Code> folders as source you own and commit. This
        feels heavier at first and pays off constantly: you can open Xcode or Android Studio and change
        native config directly, instead of fighting a hook system.
      </p>

      <h2>Migration steps</h2>
      <ol>
        <li>
          Add Capacitor to your existing project:
          <Pre>{`npm install @capacitor/core @capacitor/cli
npx cap init`}</Pre>
        </li>
        <li>
          Point <Code>webDir</Code> at your existing web build output, then add platforms:
          <Pre>{`npx cap add ios
npx cap add android`}</Pre>
        </li>
        <li>
          Replace Cordova plugins with Capacitor equivalents. Many common ones (camera, geolocation,
          filesystem, push) have official Capacitor plugins. Capacitor can also run many Cordova
          plugins directly, which is a useful bridge while you migrate the rest.
        </li>
        <li>
          Move <Code>config.xml</Code> settings into <Code>capacitor.config.ts</Code> and the native
          projects (permissions, app id, name, splash/icon).
        </li>
        <li>
          Build your web app and sync:
          <Pre>{`npx cap sync`}</Pre>
        </li>
      </ol>

      <h2>The payoff: live updates</h2>
      <p>
        Cordova&apos;s update story was awkward &mdash; the community options were limited and the
        hosted ones have since shut down. On Capacitor, add{' '}
        <Code>@otakit/capacitor-plugin</Code> and you can ship web-layer changes over the air:
      </p>
      <Pre>{`otakit upload --release production`}</Pre>
      <p>
        After the migration, most of what you iterate on ships without a store review. That&apos;s
        often the single biggest reason teams finally make the move. See{' '}
        <A href="/blog/how-ota-works-for-capacitor-apps">how OTA works</A> for the delivery model.
      </p>

      <Callout>
        <p>
          Watch out for plugins that inject into the WebView or rely on Cordova-specific globals. Test
          those paths on device early &mdash; they&apos;re the most likely to need a Capacitor-native
          replacement rather than a drop-in.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        Follow <A href="/docs/setup">Setup</A> for the Capacitor + OtaKit install, then the{' '}
        <A href="/docs/cli">CLI reference</A>. If you&apos;re on Ionic specifically, see{' '}
        <A href="/blog/ionic-live-updates-with-capacitor">Ionic live updates</A>.
      </p>
    </BlogArticle>
  );
}
