import type { Metadata } from 'next';

import { BlogArticle, Callout, Code, Pre } from '../_components/BlogArticle';
import { getBlogPost } from '@/lib/blog';

const post = getBlogPost('vibe-code-an-app-from-your-mobile-with-claude-code-remote-and-otakit');

export const metadata: Metadata = {
  title: `${post?.title} — OtaKit Blog`,
  description: post?.description,
};

export default function ClaudeRemotePage() {
  if (!post) {
    return null;
  }

  return (
    <BlogArticle post={post}>
      <p>
        The interesting part of coding from your phone is not writing perfect code on a tiny screen.
        It is shortening the loop between “I have an idea” and “the app on my device is running that
        idea.”
      </p>
      <p>
        Claude Code Remote helps with the editing side of that loop. OtaKit helps with the delivery
        side. Put together, you get a workflow where the phone becomes the place you direct and test
        the app, not just the place you consume it.
      </p>

      <h2>The workflow in one sentence</h2>
      <p>
        Use your phone to drive remote edits, let a remote machine build the web app, and use OTA to
        move the new web layer back into the installed Capacitor app without waiting on a new store
        submission.
      </p>

      <h2>What “vibe coding from mobile” should actually mean</h2>
      <p>
        It should mean that the phone is good at intent, review, and verification. The remote
        machine is good at repo access, builds, tests, and packaging. If you flip those roles, the
        workflow gets slow fast.
      </p>

      <h2>Practical loop</h2>
      <ol>
        <li>Open the repo remotely from your phone.</li>
        <li>Ask for a bounded change, not a vague redesign.</li>
        <li>Run the web build remotely.</li>
        <li>Upload the new bundle with OtaKit.</li>
        <li>Resume the app on device and verify the OTA result.</li>
      </ol>

      <Pre>{`npm run build
otakit upload --release staging`}</Pre>

      <h2>Why Capacitor is a good match</h2>
      <p>
        The native shell is already on the device. That means the feedback loop mostly depends on how
        fast you can rebuild and ship the web layer. OTA collapses that step from “make a new binary”
        into “ship a new bundle.”
      </p>

      <h2>Recommended setup</h2>
      <ul>
        <li>Keep a dedicated <Code>staging</Code> channel for your own device.</li>
        <li>Use a reproducible remote build command.</li>
        <li>Keep <Code>notifyAppReady()</Code> wired correctly so bad experiments roll back.</li>
        <li>Only promote to base or production after the phone loop is clean.</li>
      </ul>

      <Callout>
        <p>
          The value of this workflow is not novelty. It is that you can turn a commute, QA pass, or
          hallway idea into a real build on a real device without breaking release discipline.
        </p>
      </Callout>

      <h2>Where this workflow breaks</h2>
      <ul>
        <li>Native changes still need a new store or dev build.</li>
        <li>Large refactors are still better from a full desktop environment.</li>
        <li>Testing gets sloppy if you skip staging lanes.</li>
        <li>Mobile prompt-writing must stay specific or the loop turns noisy.</li>
      </ul>

      <h2>The right expectation</h2>
      <p>
        You are not replacing your laptop. You are extending the moments where you can move the app
        forward. For a Capacitor team with OTA in place, that can be surprisingly high leverage.
      </p>
    </BlogArticle>
  );
}
