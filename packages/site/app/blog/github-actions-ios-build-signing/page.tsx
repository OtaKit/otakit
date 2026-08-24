import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('github-actions-ios-build-signing')!;

export const metadata = blogPostMetadata(post.slug);

export default function GithubActionsIosPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Building a Capacitor iOS app in CI is mostly straightforward &mdash; until code signing. The
        certificates and provisioning profiles that make Apple happy are exactly the part that&apos;s
        fiddly to automate. This guide sets up a GitHub Actions workflow that builds, signs, and can
        upload a Capacitor iOS app, and shows where OTA fits so your web-layer changes don&apos;t
        need this pipeline at all.
      </p>

      <Callout>
        <p>
          Mental model: use this native pipeline for store builds (native changes). Use{' '}
          <A href="/blog/automate-capacitor-ota-releases-github-actions">the OTA pipeline</A> for
          everything in the web layer &mdash; which is most of your releases.
        </p>
      </Callout>

      <h2>What you need in secrets</h2>
      <p>Store these as encrypted repository secrets, never in the workflow file:</p>
      <ul>
        <li>
          <strong>Distribution certificate</strong> (a base64-encoded <Code>.p12</Code>) and its
          password.
        </li>
        <li>
          <strong>Provisioning profile</strong> (base64-encoded <Code>.mobileprovision</Code>).
        </li>
        <li>
          An <strong>App Store Connect API key</strong> if you&apos;ll upload from CI.
        </li>
      </ul>

      <h2>The workflow</h2>
      <p>
        iOS builds require a macOS runner. This installs the signing assets into a temporary keychain,
        syncs Capacitor, and archives the app:
      </p>
      <Pre>{`# .github/workflows/ios.yml
name: iOS build

on:
  push:
    tags: ["v*"]   # native builds on version tags

jobs:
  build:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }

      - run: npm ci
      - run: npm run build            # your web build
      - run: npx cap sync ios

      - name: Import signing certificate
        env:
          CERT_P12: \${{ secrets.IOS_CERT_P12 }}
          CERT_PASSWORD: \${{ secrets.IOS_CERT_PASSWORD }}
          PROFILE: \${{ secrets.IOS_PROVISIONING_PROFILE }}
        run: |
          echo "$CERT_P12" | base64 --decode > cert.p12
          security create-keychain -p "" build.keychain
          security import cert.p12 -k build.keychain -P "$CERT_PASSWORD" -T /usr/bin/codesign
          security list-keychains -s build.keychain
          security unlock-keychain -p "" build.keychain
          mkdir -p ~/Library/MobileDevice/Provisioning\\ Profiles
          echo "$PROFILE" | base64 --decode > ~/Library/MobileDevice/Provisioning\\ Profiles/app.mobileprovision

      - name: Archive
        run: |
          xcodebuild -workspace ios/App/App.xcworkspace \\
            -scheme App -configuration Release \\
            -archivePath build/App.xcarchive archive`}</Pre>
      <p>
        From the archive you can export an IPA and upload with{' '}
        <Code>xcrun altool</Code> / the App Store Connect API. If this feels like a lot, it is &mdash;
        which is the point of the next section.
      </p>

      <h2>Consider fastlane match</h2>
      <p>
        Managing certificates by hand is error-prone. <Code>fastlane match</Code> stores signing
        assets in a private repo and installs them in CI with one command, which removes most of the
        keychain wrangling above. See{' '}
        <A href="/blog/fastlane-capacitor-ota-releases">Fastlane + OtaKit</A> for combining it with
        OTA releases.
      </p>

      <h2>Where OTA changes the picture</h2>
      <p>
        This native pipeline should run rarely &mdash; only when native code changes. Everything in
        your web layer (UI, logic, fixes) ships over the air with a far simpler workflow and no
        signing at all:
      </p>
      <Pre>{`npm run build
otakit upload --release`}</Pre>
      <p>
        So the healthy pattern is: native iOS builds on version tags (this workflow), OTA releases on
        every merge (<A href="/blog/automate-capacitor-ota-releases-github-actions">the OTA
        workflow</A>).
      </p>

      <Callout>
        <p>
          Remember to bump <Code>runtimeVersion</Code> whenever you cut a native build, so OTA
          bundles built afterward only reach the new shell. See{' '}
          <A href="/blog/semantic-versioning-for-ota-bundles">versioning</A>.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See the <A href="/docs/ci">CI automation docs</A>, and the{' '}
        <A href="/blog/github-actions-android-build-capacitor">Android build guide</A> for the other
        platform.
      </p>
    </BlogArticle>
  );
}
