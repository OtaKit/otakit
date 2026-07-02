import type { Metadata } from 'next';

import { BlogArticle, Callout, Code } from '../_components/BlogArticle';
import { getBlogPost } from '@/lib/blog';

const post = getBlogPost('ota-policies-for-app-store-and-google-play');

export const metadata: Metadata = {
  title: `${post?.title} — OtaKit Blog`,
  description: post?.description,
};

export default function OtaPoliciesPage() {
  if (!post) {
    return null;
  }

  return (
    <BlogArticle post={post} lastReviewed="April 18, 2026">
      <p>
        This is the narrow version, not legal advice: OTA is usually viable for the web layer of a
        Capacitor app, but only if you stay inside the functionality that was actually reviewed and
        distributed through the store build.
      </p>
      <p>
        Where teams get rejected is not “using OTA” in the abstract. It is using OTA to smuggle in
        unreviewed functionality, native behavior changes, hidden features, or executable code that
        the platform does not permit.
      </p>

      <Callout>
        <p>
          Safe rule of thumb: ship HTML, CSS, JavaScript, content, and bug fixes over the air.
          Ship native capability changes through the store.
        </p>
      </Callout>

      <h2>What Apple says</h2>
      <p>
        Apple&apos;s{' '}
        <a
          href="https://developer.apple.com/app-store/review/guidelines/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 hover:text-foreground"
        >
          App Review Guidelines
        </a>{' '}
        are the primary source here.
      </p>
      <ul>
        <li>
          <strong>2.5.2</strong>: apps must be self-contained and may not download, install, or
          execute code that introduces or changes features or functionality.
        </li>
        <li>
          <strong>2.3.1</strong>: hidden, dormant, or undocumented features are not allowed.
        </li>
        <li>
          <strong>2.3</strong>: metadata and the reviewed app experience must stay accurate.
        </li>
        <li>
          <strong>2.5.6</strong>: apps that browse the web must use the appropriate WebKit
          framework and JavaScript engine.
        </li>
      </ul>
      <p>
        The practical reading is that OTA is safest when it updates the web layer inside the
        already-reviewed app model, not when it changes what the app fundamentally is.
      </p>

      <h2>What Google says</h2>
      <p>
        Google&apos;s current primary sources are the{' '}
        <a
          href="https://support.google.com/googleplay/android-developer/answer/16273414"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 hover:text-foreground"
        >
          Device and Network Abuse
        </a>{' '}
        policy and the{' '}
        <a
          href="https://support.google.com/googleplay/android-developer/answer/9888077"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 hover:text-foreground"
        >
          Deceptive Behavior
        </a>{' '}
        policy.
      </p>
      <ul>
        <li>
          Google Play says an app distributed through Play may not modify, replace, or update
          itself outside Play&apos;s update mechanism.
        </li>
        <li>
          It also says apps may not download executable code such as <Code>dex</Code>,{' '}
          <Code>JAR</Code>, or <Code>.so</Code> files from outside Google Play.
        </li>
        <li>
          The same policy explicitly carves out code running in a virtual machine or interpreter,
          including JavaScript in a WebView or browser.
        </li>
        <li>
          That carve-out does <strong>not</strong> allow policy evasion: interpreted code loaded at
          runtime must still not enable Play policy violations.
        </li>
        <li>
          Google also prohibits remotely activated hidden or undocumented functionality that was not
          present during review.
        </li>
      </ul>

      <h2>What is usually in bounds</h2>
      <ul>
        <li>Bug fixes in the web layer.</li>
        <li>UI polish and copy changes.</li>
        <li>Feature iteration that stays inside the app&apos;s reviewed purpose.</li>
        <li>Rollout control, staging, and rollback for the existing web experience.</li>
      </ul>

      <h2>What is risky or out of bounds</h2>
      <ul>
        <li>Adding new native plugins or native permissions without a new store build.</li>
        <li>Downloading native or otherwise executable binaries outside store mechanisms.</li>
        <li>Using OTA to activate hidden features that reviewers could not see.</li>
        <li>Materially changing the app&apos;s purpose after review.</li>
        <li>Making the app behave differently for reviewers than for real users.</li>
      </ul>

      <h2>What OtaKit is optimized for</h2>
      <p>
        OtaKit is intentionally narrow: web-layer bundle delivery, signed manifests, safe
        activation, rollback, and rollout lanes. That is the compliance-friendly slice for
        Capacitor teams. The product is not designed around sideloading native behavior.
      </p>
      <p>
        If you need a native capability change, treat that as a new store release and then use OTA
        for follow-up web changes inside that new native baseline.
      </p>

      <Callout>
        <p>
          Conservative policy posture: document the feature in store metadata, keep OTA inside the
          reviewed scope, and create a new native build whenever the shell changes.
        </p>
      </Callout>

      <h2>Operational checklist</h2>
      <ol>
        <li>Keep OTA limited to the web layer.</li>
        <li>Describe meaningful product changes in your store submission notes and metadata.</li>
        <li>Do not ship hidden feature flags intended to bypass review.</li>
        <li>Use runtime compatibility lanes when a new native baseline lands.</li>
        <li>Keep an internal policy review step for larger launches.</li>
      </ol>
    </BlogArticle>
  );
}
