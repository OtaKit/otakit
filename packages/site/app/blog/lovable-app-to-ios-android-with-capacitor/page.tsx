import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('lovable-app-to-ios-android-with-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function LovableToMobilePage() {
  return (
    <BlogArticle post={post}>
      <p>
        AI app builders like Lovable, v0, and Bolt make it fast to go from idea to a working web app.
        The gap they leave is the last mile: getting that app onto the App Store and Google Play, and
        iterating on it without a full redeploy each time. Capacitor and <A href="/">OtaKit</A> close
        that gap.
      </p>
      <p>
        Because these tools generate a standard web app &mdash; almost always React with Vite &mdash;
        you can wrap it natively with Capacitor and ship changes over the air. Here&apos;s the path.
      </p>

      <Callout>
        <p>
          Mental model: your AI-built app is a normal web app. Capacitor makes it a native app;
          OtaKit lets you keep vibe-coding and push each change straight to installed devices.
        </p>
      </Callout>

      <h2>1. Get the code locally</h2>
      <p>
        Export or clone the project from your AI builder (Lovable, v0, and Bolt all let you download
        or connect a Git repo). You&apos;ll get a normal Node project &mdash; install dependencies
        and confirm it builds:
      </p>
      <Pre>{`npm install
npm run build   # usually outputs to dist/ (Vite) or build/`}</Pre>
      <p>
        Set a relative base so assets load from the native <Code>file://</Code> origin. For a Vite
        project:
      </p>
      <Pre>{`// vite.config.ts
export default defineConfig({ base: "./" });`}</Pre>

      <h2>2. Add Capacitor</h2>
      <Pre>{`npm install @capacitor/core
npm install -D @capacitor/cli

npx cap init "My App" com.example.myapp --web-dir dist

npm install @capacitor/ios @capacitor/android

npm run build
npx cap add ios
npx cap add android
npx cap sync`}</Pre>
      <p>
        Open a platform (<Code>npx cap open ios</Code>) and you&apos;ll see your AI-built app running
        as a native app. For the deeper React-specific details &mdash; safe areas, routing &mdash;
        the <A href="/blog/react-to-ios-android-with-capacitor">React guide</A> applies directly.
      </p>

      <h2>3. Add live updates with OtaKit</h2>
      <p>
        This is the part that matches how you built the app: fast iteration. Install the plugin and
        set your OtaKit app id:
      </p>
      <Pre>{`npm install @otakit/capacitor-updater
npx cap sync`}</Pre>
      <Pre>{`// capacitor.config.ts
const config: CapacitorConfig = {
  appId: "com.example.myapp",
  appName: "My App",
  webDir: "dist",
  plugins: {
    OtaKit: { appId: "YOUR_OTAKIT_APP_ID" },
  },
};`}</Pre>
      <Pre>{`import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { OtaKit } from "@otakit/capacitor-updater";

// in your root component
useEffect(() => {
  if (Capacitor.isNativePlatform()) OtaKit.notifyAppReady();
}, []);`}</Pre>
      <Pre>{`npm install -g @otakit/cli
otakit login

npm run build
otakit upload --release`}</Pre>
      <p>
        After a one-time store submission with the plugin configured, every AI-generated change you
        build ships to installed devices with one command. Prompt a fix, build, upload &mdash; users
        get it on their next launch.
      </p>

      <Callout>
        <p>
          Want the full mobile-first loop? See{' '}
          <A href="/blog/vibe-code-an-app-from-your-mobile-with-claude-code-remote-and-otakit">
            vibe coding an app from your phone with Claude Code and OtaKit
          </A>
          .
        </p>
      </Callout>

      <h2>A note on AI-built apps and store review</h2>
      <p>
        AI builders can generate a lot of screens fast &mdash; make sure the app you submit is
        complete and does what its listing says. OTA is for iterating on that approved app, not for
        shipping a shell and filling it in later. See{' '}
        <A href="/blog/first-app-store-review-guide">passing your first store review</A> and{' '}
        <A href="/blog/app-store-compliant-ota-updates">what OTA can and can&apos;t change</A>.
      </p>

      <h2>Where to go next</h2>
      <p>
        Start with the <A href="/docs/setup">setup guide</A>, then{' '}
        <A href="/blog/automate-capacitor-ota-releases-github-actions">automate releases</A> so every
        push ships.
      </p>
    </BlogArticle>
  );
}
