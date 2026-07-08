import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('github-actions-android-build-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function GithubActionsAndroidPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Android builds are the friendlier half of Capacitor CI &mdash; no macOS runner, no
        provisioning profiles, just a keystore and Gradle. This guide sets up a GitHub Actions
        workflow that builds a signed Android App Bundle (AAB) for a Capacitor app, and shows how OTA
        keeps most of your releases off this pipeline entirely.
      </p>

      <Callout>
        <p>
          Mental model: this pipeline is for store builds (native changes). Web-layer changes ship
          over the air with <A href="/blog/automate-capacitor-ota-releases-github-actions">a much
          simpler OTA workflow</A>.
        </p>
      </Callout>

      <h2>What you need in secrets</h2>
      <ul>
        <li>
          Your <strong>signing keystore</strong>, base64-encoded (<Code>ANDROID_KEYSTORE</Code>).
        </li>
        <li>
          The <strong>keystore password</strong>, <strong>key alias</strong>, and{' '}
          <strong>key password</strong>.
        </li>
      </ul>

      <h2>The workflow</h2>
      <p>Runs on Ubuntu, builds the web app, syncs Capacitor, and assembles a signed AAB:</p>
      <Pre>{`# .github/workflows/android.yml
name: Android build

on:
  push:
    tags: ["v*"]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: 21 }

      - run: npm ci
      - run: npm run build          # your web build
      - run: npx cap sync android

      - name: Decode keystore
        env:
          KEYSTORE: \${{ secrets.ANDROID_KEYSTORE }}
        run: echo "$KEYSTORE" | base64 --decode > android/app/release.keystore

      - name: Build signed AAB
        working-directory: android
        env:
          KS_PASSWORD: \${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          KEY_ALIAS: \${{ secrets.ANDROID_KEY_ALIAS }}
          KEY_PASSWORD: \${{ secrets.ANDROID_KEY_PASSWORD }}
        run: |
          ./gradlew bundleRelease \\
            -Pandroid.injected.signing.store.file=release.keystore \\
            -Pandroid.injected.signing.store.password=$KS_PASSWORD \\
            -Pandroid.injected.signing.key.alias=$KEY_ALIAS \\
            -Pandroid.injected.signing.key.password=$KEY_PASSWORD

      - uses: actions/upload-artifact@v4
        with:
          name: app-release-aab
          path: android/app/build/outputs/bundle/release/app-release.aab`}</Pre>
      <p>
        From here you can download the AAB and upload manually, or add a step using the Google Play
        Developer API to publish to a testing track automatically.
      </p>

      <h2>Where OTA changes the picture</h2>
      <p>
        This runs only when native code changes. Your day-to-day releases &mdash; UI, logic, fixes
        &mdash; ship over the air with no Gradle, no keystore, no waiting:
      </p>
      <Pre>{`npm run build
otakit upload --release`}</Pre>
      <p>
        Pattern: native Android builds on version tags (this workflow), OTA releases on every merge
        (<A href="/blog/automate-capacitor-ota-releases-github-actions">the OTA workflow</A>). When
        you do cut a native build, bump <Code>runtimeVersion</Code> so later OTA bundles target the
        new shell &mdash; see <A href="/blog/semantic-versioning-for-ota-bundles">versioning</A>.
      </p>

      <Callout>
        <p>
          Keep your keystore backed up somewhere safe outside CI. Lose it and you can&apos;t update
          the app on Google Play under the same signing identity.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See the <A href="/docs/ci">CI automation docs</A>, and the{' '}
        <A href="/blog/github-actions-ios-build-signing">iOS build guide</A> for the other platform.
      </p>
    </BlogArticle>
  );
}
