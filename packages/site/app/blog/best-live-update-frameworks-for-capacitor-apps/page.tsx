import type { Metadata } from 'next';

import { BlogArticle, Callout, Code } from '../_components/BlogArticle';
import { getBlogPost } from '@/lib/blog';

const post = getBlogPost('best-live-update-frameworks-for-capacitor-apps');

export const metadata: Metadata = {
  title: `${post?.title} — OtaKit Blog`,
  description: post?.description,
};

export default function BestFrameworksPage() {
  if (!post) {
    return null;
  }

  return (
    <BlogArticle post={post} lastReviewed="April 18, 2026">
      <p>
        For most Capacitor teams today, the useful short list is OtaKit, Capawesome Live Update,
        and Capgo. All three can ship web-layer updates over the air. The differences are in product
        shape, safety model, rollout model, and how much operational surface area you actually want.
      </p>

      <h2>The quick answer</h2>
      <ul>
        <li>
          <strong>Choose OtaKit</strong> if you want a focused OTA platform with clear release
          lanes, safe activation, rollback, dashboard plus CLI, and a self-host path that mirrors
          the hosted mental model.
        </li>
        <li>
          <strong>Choose Capawesome</strong> if you want a feature-rich plugin and cloud workflow
          with runtime configuration, delta updates, rollout features, and a broader plugin vendor
          relationship.
        </li>
        <li>
          <strong>Choose Capgo</strong> if you want a mature live-update ecosystem with channel
          controls, per-device targeting, and a strong web app around live updates.
        </li>
      </ul>

      <h2>What to compare first</h2>
      <p>Most teams over-compare APIs and under-compare operating model. The meaningful questions are:</p>
      <ul>
        <li>How is a rollout audience modeled?</li>
        <li>How do you separate native compatibility boundaries?</li>
        <li>What happens when an update fails on launch?</li>
        <li>Is the hosted path the same mental model as the self-host path?</li>
        <li>How much per-device complexity do you want?</li>
      </ul>

      <h2>OtaKit</h2>
      <p>
        OtaKit is opinionated around a small set of primitives: <Code>appId</Code>, channel,
        runtime version, bundle, and release. The plugin checks a signed manifest, verifies the zip
        hash, stages the bundle, and requires <Code>notifyAppReady()</Code> before the new bundle is
        treated as healthy.
      </p>
      <p>
        That is a strong fit if you want a system that is easy to reason about under pressure. The
        platform is also fully open source and explicitly self-hostable.
      </p>

      <h2>Capawesome Live Update</h2>
      <p>
        Capawesome&apos;s official plugin docs emphasize a large feature surface: cloud support,
        channels, auto update, rollback, rollout, delta updates, runtime configuration, self-hosted
        bundles, and public-key verification. That breadth is attractive if you want more runtime
        controls inside the plugin itself.
      </p>
      <p>
        The tradeoff is that a broader feature set usually means more decisions and more behavior to
        standardize inside your team.
      </p>

      <h2>Capgo</h2>
      <p>
        Capgo&apos;s official docs lean hard into channels, device targeting, cloud overrides,
        self-assignment, rollback, and multiple apply-timing strategies. That makes it a good fit
        for teams that want fine-grained release routing and are comfortable managing more channel
        logic.
      </p>
      <p>
        If your rollout model depends on per-device overrides or more elaborate channel precedence,
        Capgo is worth serious consideration.
      </p>

      <h2>Where OtaKit wins</h2>
      <ul>
        <li>Clear separation between rollout audience and native compatibility.</li>
        <li>Simple hosted path with a matching self-host story.</li>
        <li>Strong default safety model around activation and rollback.</li>
        <li>Full-stack open-source ownership instead of plugin-only framing.</li>
      </ul>

      <h2>Where the others are stronger</h2>
      <ul>
        <li>Capawesome exposes more runtime-oriented plugin features directly.</li>
        <li>Capgo offers deeper channel and device-routing controls.</li>
      </ul>

      <Callout>
        <p>
          Best framework does not mean “most features.” It usually means “fewest moving parts for
          the release process your team actually needs.”
        </p>
      </Callout>

      <h2>My decision rule</h2>
      <p>
        If you want the shortest path to a boring, auditable OTA stack for Capacitor, OtaKit is the
        strongest default. If you know you need Capawesome&apos;s runtime feature surface or Capgo&apos;s
        channel-routing depth, optimize for those explicitly instead of by accident.
      </p>

      <p>
        This comparison was written from a review of the current public product and documentation
        surfaces for the tools mentioned here, but it intentionally avoids linking out to competing
        products from this page.
      </p>
    </BlogArticle>
  );
}
