import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('codex-capacitor-ota-updates')!;

export const metadata = blogPostMetadata(post.slug);

export default function CodexCapacitorPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Codex is good at finding and fixing the bug. With <A href="/">OtaKit</A> connected, it can
        also ship the fix to your Capacitor app over the air, without a store build, and without
        taking the final decision away from you.
      </p>
      <p>
        This guide covers setup, what Codex does on a release, and two setups for teams: read-only
        reporting and CI.
      </p>

      <h2>1. Setup</h2>
      <p>Install the OtaKit Agent Skill, sign in, and add the MCP server:</p>
      <Pre>{`npx skills add https://github.com/OtaKit/otakit --skill otakit

npx -y @otakit/cli@latest login
codex mcp add otakit -- npx -y @otakit/cli@latest mcp`}</Pre>
      <p>
        Or run <Code>npx -y @otakit/cli@latest connect</Code> in your project: it detects Codex,
        shows what it will configure, and asks before writing anything.
      </p>
      <p>
        The Skill teaches Codex the release workflow (check, upload, prepare, approve, publish). The
        MCP server gives it the tools. Your Capacitor app needs the OtaKit plugin in a store build
        once; after that, web changes can ship over the air.
      </p>

      <h2>2. What Codex does when you ask it to ship</h2>
      <Callout>
        <p>Fix the typo on the pricing screen, build, and ship it to staging.</p>
      </Callout>
      <ol>
        <li>
          <strong>Inspects the project</strong> (<Code>inspect_project</Code>): OtaKit config, build
          folder, whether <Code>notifyAppReady()</Code> is called, sign-in state.
        </li>
        <li>
          <strong>Checks native compatibility</strong> (<Code>check_compatibility</Code>): compares
          your native dependencies with what the current release shipped. A new native plugin means
          a store build, and Codex stops and says so.
        </li>
        <li>
          <strong>Uploads the bundle</strong> (<Code>upload_bundle</Code>). This never publishes.
        </li>
        <li>
          <strong>Prepares the release</strong> (<Code>prepare_release</Code>) and shows you the
          exact lane, the version change, the compatibility result and the auto-revert settings.
        </li>
        <li>
          <strong>Publishes after you approve</strong> (<Code>publish_release</Code>). The publish
          carries the state you reviewed, so a release someone else made in between is never
          overwritten.
        </li>
      </ol>
      <p>
        Codex asks before running tools according to its approval settings, and the OtaKit Skill
        tells it to stop for your approval before publishing. Keep publishing on manual approval;
        uploads and read-only checks are safe to allow.
      </p>

      <h2>3. Read-only reporting</h2>
      <p>
        Not everyone who asks &ldquo;how is the release doing?&rdquo; should be able to release. The
        remote endpoint uses OAuth scopes, so you can connect Codex with read access only:
      </p>
      <Pre>{`codex mcp add otakit-remote --url https://console.otakit.app/mcp
codex mcp login --oauth-client-registration cimd \\
  --scopes otakit:read,offline_access \\
  otakit-remote`}</Pre>
      <p>
        With only <Code>otakit:read</Code>, Codex can list releases, read health and summarize
        rollout events, but cannot upload, publish or revert. Revoke the connection any time from
        Settings → Agents in the dashboard.
      </p>

      <h2>4. In CI</h2>
      <p>
        For pipelines, use an organization key in <Code>OTAKIT_TOKEN</Code> (from your secret store,
        never a project file). The same CLI commands the agent uses work in any CI:
      </p>
      <Pre>{`npm run build
npx -y @otakit/cli@latest upload --release staging`}</Pre>
      <p>
        A common split: CI uploads every merge to staging, and a human (or Codex, with your
        approval) promotes to production. See <A href="/docs/ci">CI automation</A>.
      </p>

      <h2>5. After the release</h2>
      <p>Useful follow-up prompts:</p>
      <ul>
        <li>&ldquo;How is the current staging release doing?&rdquo;</li>
        <li>&ldquo;List download errors for the last release.&rdquo;</li>
        <li>&ldquo;Prepare a revert of production and wait for me.&rdquo;</li>
      </ul>
      <p>
        Every write is attributed in the audit log, whether a person or an agent made it. For the
        same flow in Claude Code, see{' '}
        <A href="/blog/claude-code-capacitor-releases">Claude Code for Capacitor releases</A>; for
        all agents, the <A href="/ai-agents">AI agents page</A>.
      </p>
    </BlogArticle>
  );
}
