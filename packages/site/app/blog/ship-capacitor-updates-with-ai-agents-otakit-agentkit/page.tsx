import { BlogArticle, Callout, Code, DataTable, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('ship-capacitor-updates-with-ai-agents-otakit-agentkit')!;

export const metadata = blogPostMetadata(post.slug);

const pieces = [
  [
    'Local MCP',
    'Your Capacitor project',
    'Inspect configuration, check native compatibility, package web assets, upload, and release',
  ],
  [
    'Remote MCP',
    'Your OtaKit account',
    'Inspect apps and releases, publish, monitor events, and revert without local file access',
  ],
  [
    'Agent Skill',
    'The release workflow',
    'Choose the right tools, preserve every release option, and pause for approval',
  ],
];

export default function AgentKitLaunchPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Shipping an over-the-air update involves more than running an upload command. Someone has to
        identify the right app and release lane, check whether the web bundle still matches the
        native shell, preserve rollout settings, review the proposed change, and know what to do if
        it goes wrong. OtaKit AgentKit gives coding agents that complete workflow.
      </p>
      <p>
        It works with Codex, Claude Code, VS Code, and any compatible client through two MCP servers
        and an open Agent Skill. The agent gets useful product access; your team keeps the same
        OtaKit release model, controls, and audit trail.
      </p>

      <Callout>
        <p>
          <strong>In one sentence:</strong> MCP connects the agent to OtaKit; the Agent Skill
          teaches it how to use that connection well.
        </p>
      </Callout>

      <h2>Three pieces, one release process</h2>
      <DataTable headers={['Component', 'Context', 'Best for']} rows={pieces} />
      <p>
        Local and remote MCP deliberately overlap on account operations. That is useful, not
        duplication: use the local server when the agent needs files from your repository, and the
        remote server when it only needs your OtaKit account. Both expose the same release lanes and
        options.
      </p>
      <p>
        The Skill is equally important. A tool can say &ldquo;publish this release&rdquo;; the Skill
        explains that the agent should inspect the exact app, channel, runtime version, current
        release, compatibility result, and rollout settings before doing it. It also works as a
        documented CLI fallback when MCP is unavailable.
      </p>

      <h2>Start locally in a Capacitor project</h2>
      <p>Install the OtaKit Skill and connect the local MCP server:</p>
      <Pre>{`npx skills add https://github.com/OtaKit/otakit --skill otakit

npx -y @otakit/cli@1.5.0 login

codex mcp add otakit -- \\
  npx -y @otakit/cli@1.5.0 mcp --project-root .`}</Pre>
      <p>Claude Code also has a native plugin and marketplace:</p>
      <Pre>{`claude plugin marketplace add OtaKit/otakit
claude plugin install otakit@otakit

claude mcp add --transport stdio --scope project otakit-local -- \\
  npx -y @otakit/cli@1.5.0 mcp --project-root .`}</Pre>
      <p>
        Restart or refresh the client so it discovers both additions. Your first request can stay
        entirely read-only:
      </p>
      <Callout>
        <p>
          Inspect this Capacitor project for OtaKit readiness. Check the effective configuration and
          native compatibility, but do not upload or change anything.
        </p>
      </Callout>

      <h2>Connect remotely when the repository is not needed</h2>
      <p>
        Remote MCP is for account and release work from a client that cannot run the local CLI. An
        OAuth connection is bound to the signed-in user, organization, and approved scopes:
      </p>
      <Pre>{`codex mcp add otakit --url https://console.otakit.app/mcp

codex mcp login \\
  --oauth-client-registration cimd \\
  --scopes otakit:read,otakit:app:write,otakit:bundle:write,otakit:release:write,offline_access \\
  otakit`}</Pre>
      <p>
        The remote endpoint is enabled per deployment after its OAuth and release checks pass. If a
        client reports that remote MCP is not enabled, keep using local MCP or ask the deployment
        operator to enable it. For unattended automation, an existing organization key can be
        supplied through the MCP client&apos;s environment instead of being written into project
        configuration.
      </p>

      <h2>What a good agent workflow looks like</h2>
      <ol>
        <li>
          <strong>Inspect.</strong> Resolve the server, organization, app, channel, and runtime
          version. When the project is local, check its effective Capacitor configuration and native
          packages.
        </li>
        <li>
          <strong>Upload for review.</strong> Build and package the configured <Code>webDir</Code>,
          then upload without silently publishing.
        </li>
        <li>
          <strong>Prepare.</strong> Show the exact current and proposed release state, including
          force-immediate behavior, auto-revert thresholds, and the compatibility decision.
        </li>
        <li>
          <strong>Approve and publish.</strong> Use the prepared state and an idempotency key so a
          retry cannot create a second unintended release.
        </li>
        <li>
          <strong>Observe and recover.</strong> Inspect client-reported events, then prepare the
          exact target and request approval before a revert.
        </li>
      </ol>

      <h2>Prompts that are useful in real work</h2>
      <ul>
        <li>
          &ldquo;Build and upload version 2.4.1 for staging. Do not release it. Return the bundle ID
          and anything I should review.&rdquo;
        </li>
        <li>
          &ldquo;Prepare this bundle for production with force-immediate off and auto-revert
          enabled. Show the current and proposed state, then wait for approval.&rdquo;
        </li>
        <li>
          &ldquo;Summarize recent production release events and failures. Keep event records
          separate from unique users or devices.&rdquo;
        </li>
        <li>
          &ldquo;Prepare a revert of production to the previous release. Show the exact target and
          do not execute it until I approve.&rdquo;
        </li>
      </ul>

      <h2>AgentKit is not a separate deployment system</h2>
      <p>
        This is the design choice that matters most. AgentKit does not invent an agent-only release
        lane or reduce OtaKit to a small set of &ldquo;safe&rdquo; demo tools. It retains
        force-immediate releases, configurable auto-revert, compatibility overrides, bundle
        deletion, event detail, and combined upload-and-publish when you explicitly choose it.
      </p>
      <p>
        The controls live around that functionality: scoped OAuth, organization and role checks,
        explicit preview state, idempotent writes, audit attribution, bounded results, and honest
        telemetry labels. Event records are client-reported diagnostics—not unique devices,
        adoption, or instructions for the agent.
      </p>

      <h2>Use the interface that fits the job</h2>
      <p>
        The dashboard remains best for visual review. The CLI remains best for scripts and CI. The
        REST API remains available for custom integrations. AgentKit adds a conversational path
        through the same product for work that benefits from project inspection, explanation, and
        guided execution.
      </p>
      <p>
        Follow the <A href="/docs/agents">AgentKit setup guide</A> for Codex, Claude Code, VS Code,
        remote OAuth, and self-hosted rollout. The canonical Skill is public in the{' '}
        <A href="https://github.com/OtaKit/otakit/tree/main/skills/otakit">OtaKit repository</A>.
      </p>
    </BlogArticle>
  );
}
