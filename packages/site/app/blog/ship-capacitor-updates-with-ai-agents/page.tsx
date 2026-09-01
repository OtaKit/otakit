import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('ship-capacitor-updates-with-ai-agents')!;

export const metadata = blogPostMetadata(post.slug);

export default function McpLaunchPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Shipping an over-the-air update is four commands and about six things you have to remember.
        Which app. Which channel. Which runtime lane. Whether the web bundle still matches the
        native shell you shipped to the store. Whether auto-revert is on. What the current release
        even is, so you know what you are replacing.
      </p>
      <p>
        None of that is hard. It is just easy to get wrong at 6pm on a Friday, and the failure mode
        is a broken app on every device that checks in.
      </p>
      <p>
        So we taught coding agents to do the careful part. Ask Claude Code, Codex, or VS Code to
        ship an update and it reads your project, resolves the exact lane, checks compatibility,
        uploads the build — and then stops:
      </p>

      <Pre>{`Publish  com.acme.shop
  lane       base · runtime 2026.04
  from       1.4.0  ->  1.5.0
  native     compatible (12 packages unchanged)
  immediate  no        auto-revert  on · 10% · min 100
Approve? This goes live for every device on that lane.`}</Pre>

      <p>
        That block is the whole idea. Same shape every time, whether you asked in one sentence or
        walked through it step by step. You read five lines and say yes.
      </p>

      <h2>Getting it running</h2>
      <p>One command, from your project:</p>
      <Pre>{`npx -y @otakit/cli@latest connect`}</Pre>
      <p>
        It works out which client you use, signs you in if you are not already, and shows you the
        console, organization, project, and app it resolved — plus the exact file it is about to
        write — before it writes anything. <Code>--dry-run</Code> shows the same plan and touches
        nothing.
      </p>
      <p>Claude Code has a plugin that ships the server and the release workflow together:</p>
      <Pre>{`claude plugin marketplace add OtaKit/otakit
claude plugin install otakit@otakit`}</Pre>
      <p>Then start with something read-only:</p>
      <Callout>
        <p>
          Check whether this project is ready to ship an OtaKit update. Don&apos;t upload or change
          anything.
        </p>
      </Callout>

      <h2>The parts we worried about</h2>
      <p>
        Handing release access to an agent is only reasonable if the boring safeguards are real.
        These are the ones that mattered to us.
      </p>
      <p>
        <strong>Uploading is not publishing.</strong> They are separate tools. An agent can build,
        package, and upload a bundle for you to look at, and nothing about that reaches a device.
        &ldquo;Upload this but don&apos;t release it&rdquo; is a first-class thing to ask for.
      </p>
      <p>
        <strong>A publish carries the state it reviewed.</strong> If a teammate releases between the
        agent showing you that block and you approving it, the publish is rejected rather than
        quietly overwriting their release. Retries are keyed, so a flaky connection cannot produce
        two releases.
      </p>
      <p>
        <strong>Native changes stop it.</strong> OtaKit compares your dependencies against what the
        current release actually shipped. Add a native plugin and you need a store build, not an OTA
        update — the agent blocks and explains which packages changed. You can override that, but
        only deliberately, and the override is recorded.
      </p>
      <p>
        <strong>It says when it doesn&apos;t know.</strong> If it cannot read your dependencies —
        wrong directory, dependencies not installed — it reports that it could not determine
        compatibility. It does not report &ldquo;compatible&rdquo; on the basis of having found
        nothing. That distinction took us longer to get right than it should have.
      </p>
      <p>
        <strong>Rollout numbers are described honestly.</strong> Device telemetry is client-reported
        events, not users and not adoption. The agent is instructed to call them events, and to say
        &ldquo;unavailable&rdquo; rather than &ldquo;zero&rdquo; when analytics is not configured.
      </p>

      <h2>What it is actually good at</h2>
      <p>
        The obvious use is releasing, but the one that has surprised us is asking questions.
        &ldquo;Why are people on 1.4.2 seeing rollbacks?&rdquo; is a genuinely annoying thing to
        answer by hand — you are cross-referencing events, bundle versions, and lanes. An agent with
        read access does it in one turn.
      </p>
      <ul>
        <li>&ldquo;Is this project set up correctly? Don&apos;t change anything.&rdquo;</li>
        <li>&ldquo;Upload 2.4.1 to staging but don&apos;t publish it.&rdquo;</li>
        <li>&ldquo;Prepare this for production with auto-revert on, then wait for me.&rdquo;</li>
        <li>&ldquo;Roll production back to the previous release.&rdquo;</li>
      </ul>
      <p>
        Clients that support MCP prompts get these as <Code>/check</Code>, <Code>/release</Code>,{' '}
        <Code>/rollout</Code>, and <Code>/revert</Code>.
      </p>

      <h2>It is the same release process</h2>
      <p>
        There is no agent-only path. An agent publishing to production produces exactly the release
        the dashboard would have, with the same lanes, the same force-immediate and auto-revert
        settings, and an audit entry naming who approved it. If you decide tomorrow that you would
        rather do it by hand, nothing about your releases changes.
      </p>
      <p>
        The Skill that teaches all of this is a plain Markdown file. It is{' '}
        <A href="https://github.com/OtaKit/otakit/tree/main/skills/otakit">public in the repo</A> —
        read it, disagree with it, fork it. It is the part of this that most deserves your
        scepticism, so we would rather you could see it.
      </p>
      <p>
        The <A href="/docs/agents">setup guide</A> covers Claude Code, Codex, VS Code, connecting
        without a checkout, and self-hosted rollout.
      </p>
    </BlogArticle>
  );
}
