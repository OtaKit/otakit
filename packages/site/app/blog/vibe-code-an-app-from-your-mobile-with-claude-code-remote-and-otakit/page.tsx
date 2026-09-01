import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('vibe-code-an-app-from-your-mobile-with-claude-code-remote-and-otakit')!;

export const metadata = blogPostMetadata(post.slug);

export default function ClaudeRemotePage() {
  return (
    <BlogArticle post={post}>
      <p>
        Here&apos;s a loop that genuinely works in 2026: you&apos;re away from your desk, you open
        Claude Code on your phone, describe a change to your app, let it build in the cloud, ship
        the result with an OTA release — and thirty seconds later the app{' '}
        <em>already installed on that same phone</em> is running the new code. No laptop, no store
        review, no TestFlight wait.
      </p>
      <p>
        The trick is that the two halves finally exist. Claude Code handles editing and building
        remotely; OtaKit handles getting the result onto your device. This post wires them together
        for a Capacitor app.
      </p>

      <h2>The pieces</h2>
      <ul>
        <li>
          <strong>Claude Code on mobile</strong> — since late 2025, Claude Code runs inside the
          Claude iOS app and on the web (claude.ai/code): sessions execute in Anthropic&apos;s cloud
          sandbox against your GitHub repo, and your phone is the steering wheel. If you prefer your
          own hardware, remote control mode can drive a Claude Code CLI running on your desktop
          instead.
        </li>
        <li>
          <strong>A Capacitor app with OtaKit installed</strong> — the store build already on your
          phone, with the plugin configured and a <Code>staging</Code> channel to play in. The{' '}
          <A href="/docs/setup">setup guide</A> covers this.
        </li>
        <li>
          <strong>A CI step that uploads on push</strong> — the piece that turns
          &ldquo;merged&rdquo; into &ldquo;on my phone.&rdquo;
        </li>
      </ul>

      <h2>The division of labor</h2>
      <p>
        The workflow works when each side does what it&apos;s good at. The phone is good at intent,
        review, and verification: describing the change, reading the diff, tapping through the
        result. The cloud (or your remote machine) is good at repo access, dependency installs,
        builds, and tests. Trying to write code by thumb is miserable; directing an agent that
        writes it while you review is not.
      </p>

      <h2>The direct MCP path</h2>
      <p>
        CI remains the cleanest unattended path from a merged branch to staging. When Claude Code is
        running in a workspace with your repository, OtaKit&apos;s local MCP provides a shorter,
        interactive path: it can inspect the Capacitor project, check native compatibility, package
        the configured web output, upload it, and prepare a release for your approval.
      </p>
      <Callout>
        <p>
          Build and upload this change to staging. Check native compatibility first, show the exact
          proposed release and rollout options, and wait for my approval before publishing.
        </p>
      </Callout>
      <p>
        Use remote MCP when the agent only needs account or release history; it cannot read or
        upload your local build. The <A href="/docs/agents">MCP and Agent Skills guide</A> shows
        both setups.
      </p>

      <h2>The loop, step by step</h2>
      <ol>
        <li>
          <strong>Open Claude Code</strong> in the Claude app and pick your app&apos;s repo.
        </li>
        <li>
          <strong>Ask for a bounded change.</strong> &ldquo;Add pull-to-refresh on the history
          screen and show a relative timestamp&rdquo; beats &ldquo;make the app feel nicer.&rdquo;
          Small, verifiable prompts keep the loop tight.
        </li>
        <li>
          <strong>Review the diff on your phone</strong> and let the session run your web build and
          tests in the sandbox.
        </li>
        <li>
          <strong>Merge to your staging branch.</strong> CI builds the web bundle and runs:
          <Pre>{`npm run build
otakit upload --release staging`}</Pre>
        </li>
        <li>
          <strong>Reopen your app.</strong> With the default policies, the staged bundle is applied
          on the next cold start — or ship with <Code>--force-immediate</Code> while iterating so
          the device picks it up on its very next check.
        </li>
      </ol>
      <p>
        That last step is the payoff: the phone that wrote the change is the phone that verifies it,
        on a real device, inside the real native shell.
      </p>

      <Callout>
        <p>
          Point your own device at the <Code>staging</Code> channel with a{' '}
          <Code>setChannel(&#123; channel: &apos;staging&apos; &#125;)</Code> toggle in a hidden
          debug menu — then your personal install rides the experimental lane while every other user
          stays safely on production.
        </p>
      </Callout>

      <h2>Why this is safe to do at all</h2>
      <p>
        Shipping code you reviewed on a phone screen sounds reckless until you remember what the OTA
        layer is doing underneath. Every bundle is verified against a signed manifest before it
        runs. Every activation is provisional until the app calls <Code>notifyAppReady()</Code> — if
        your experiment white-screens on boot, the device rolls itself back to the last good bundle
        automatically. And the blast radius is whatever the <Code>staging</Code> channel contains:
        your device, not your users.
      </p>
      <p>
        The OtaKit CLI also runs a native-compatibility check on every upload, so if Claude
        helpfully added a Capacitor plugin that needs native code your installed shell doesn&apos;t
        have, you find out at upload time — not from a crash.
      </p>

      <h2>Where the loop ends</h2>
      <ul>
        <li>
          <strong>Native changes.</strong> New plugins, permissions, or Capacitor upgrades need a
          real build and a store release. The compatibility guardrail will tell you when you&apos;ve
          crossed that line.
        </li>
        <li>
          <strong>Big refactors.</strong> Reviewing a 40-file diff on a phone is technically
          possible and practically a bad idea. Save those for the desk.
        </li>
        <li>
          <strong>Promotion discipline.</strong> The phone loop earns its speed on staging. Promote
          to production the boring way — after the change has soaked.
        </li>
      </ul>

      <h2>The right expectation</h2>
      <p>
        This isn&apos;t about replacing your laptop. It&apos;s that ideas now survive the gap
        between having them and being at a desk. A commute, a coffee line, a hallway conversation —
        each becomes a window where the app can actually move forward, with the same rollback safety
        net as any other release.
      </p>
      <p>
        If your Capacitor app doesn&apos;t have OTA wired up yet, that&apos;s the prerequisite —{' '}
        <A href="/docs/setup">it takes about ten minutes</A>. For the CI half, see the{' '}
        <A href="/docs/ci">CI automation guide</A>. For an interactive agent-driven release, use the{' '}
        <A href="/docs/agents">MCP and Agent Skills guide</A>.
      </p>
    </BlogArticle>
  );
}
