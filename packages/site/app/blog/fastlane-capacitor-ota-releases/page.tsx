import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('fastlane-capacitor-ota-releases')!;

export const metadata = blogPostMetadata(post.slug);

export default function FastlaneOtaPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Fastlane is the workhorse of native mobile release automation &mdash; signing, building, and
        uploading to the App Store and Google Play. But most of your releases aren&apos;t native;
        they&apos;re web-layer changes that should ship over the air. The clean setup uses Fastlane
        for the native store builds and <A href="/">OtaKit</A> for everything in between, in one
        coherent release process.
      </p>

      <Callout>
        <p>
          Mental model: Fastlane handles the rare, heavy native releases. OtaKit handles the frequent,
          light web-layer releases. Same repo, two lanes.
        </p>
      </Callout>

      <h2>The division of labor</h2>
      <ul>
        <li>
          <strong>Fastlane</strong> &mdash; build and submit the native binary when native code
          changes (new plugins, permissions, Capacitor upgrades). Handles signing via{' '}
          <Code>match</Code>, uploads via <Code>deliver</Code> / <Code>supply</Code>.
        </li>
        <li>
          <strong>OtaKit</strong> &mdash; ship the web layer (UI, logic, fixes) over the air, no
          signing, no store wait.
        </li>
      </ul>

      <h2>A native store lane</h2>
      <p>
        A minimal iOS lane that syncs the web build into the native project, then builds and uploads:
      </p>
      <Pre>{`# fastlane/Fastfile
platform :ios do
  lane :release do
    sh("npm", "run", "build")
    sh("npx", "cap", "sync", "ios")
    match(type: "appstore")          # signing assets
    build_app(workspace: "ios/App/App.xcworkspace", scheme: "App")
    upload_to_app_store(skip_screenshots: true)
  end
end`}</Pre>
      <p>
        Run this only when you actually change native code. When you do, bump{' '}
        <Code>runtimeVersion</Code> so later OTA bundles target the new shell.
      </p>

      <h2>An OTA lane in the same Fastfile</h2>
      <p>
        You can wrap the OtaKit release in a Fastlane lane too, so your team has one command surface
        for both kinds of release:
      </p>
      <Pre>{`platform :ios do
  lane :ota do
    sh("npm", "run", "build")
    sh("otakit", "upload", "--release", "production")
  end
end`}</Pre>
      <p>
        Now <Code>fastlane ota</Code> ships a live update and <Code>fastlane release</Code> cuts a
        native store build. The OTA lane needs no certificates &mdash; just the{' '}
        <Code>OTAKIT_TOKEN</Code> in the environment.
      </p>

      <h2>Wire it into CI</h2>
      <p>
        Both lanes run happily in CI. A common split: run <Code>fastlane ota</Code> on every merge to
        main, and <Code>fastlane release</Code> on version tags. That mirrors the{' '}
        <A href="/blog/automate-capacitor-ota-releases-github-actions">GitHub Actions</A> and{' '}
        <A href="/blog/gitlab-ci-capacitor-live-updates">GitLab</A> patterns, with Fastlane as the
        shared command layer.
      </p>

      <Callout>
        <p>
          The payoff: your team runs one tool, but only pays the cost of a full native build when a
          release genuinely needs one. Most releases take the fast OTA lane.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See the <A href="/docs/ci">CI automation docs</A> and{' '}
        <A href="/blog/automate-channel-promotion-ota">automating channel promotion</A> for a safe
        beta-to-production flow.
      </p>
    </BlogArticle>
  );
}
