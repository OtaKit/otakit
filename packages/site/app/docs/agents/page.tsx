import Link from 'next/link';

import { Pre } from '@/app/docs/CodeBlock';
import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'AgentKit: MCP & Agent Skills',
  description:
    'Connect OtaKit to Codex, Claude Code, VS Code, and other AI agents for project inspection, uploads, releases, monitoring, and reverts.',
};

export default function AgentsPage() {
  return (
    <>
      <H1>OtaKit AgentKit</H1>
      <Lead>
        Give your coding agent the context and tools to ship Capacitor updates without inventing a
        second release process. AgentKit combines MCP servers for live product access with an open
        Agent Skill that teaches the agent how to inspect, prepare, publish, monitor, and revert
        safely.
      </Lead>

      <h2 className="sr-only">Three parts, one release workflow</h2>
      <div className="-mx-6 mt-8 grid w-[calc(100%+3rem)] gap-px border-y border-border bg-border sm:grid-cols-3">
        <SummaryCard
          eyebrow="Project-aware"
          title="Local MCP"
          description="Runs through the OtaKit CLI inside your repository, so the agent can inspect native packages, package webDir, and upload the actual build."
        />
        <SummaryCard
          eyebrow="Account-aware"
          title="Remote MCP"
          description="Connects over HTTPS with scoped OAuth or an organization key for apps, releases, events, account operations, and auditable writes."
        />
        <SummaryCard
          eyebrow="Workflow-aware"
          title="Agent Skill"
          description="A portable, vendor-neutral playbook for choosing the right tools, preserving every release option, and asking before consequential writes."
        />
      </div>

      <Notice>
        Local MCP and the Agent Skill work independently of the hosted remote endpoint. Remote MCP
        is enabled per deployment after its OAuth and release checks pass. If a client says remote
        MCP is not enabled, use local MCP or ask the deployment operator to enable it; that message
        is not an authentication failure.
      </Notice>

      <Separator className="my-10" />

      <H2>Quick start with Codex</H2>
      <P>Install the open OtaKit Skill once:</P>
      <Pre>{`npx skills add https://github.com/OtaKit/otakit --skill otakit`}</Pre>
      <P>Sign in to OtaKit, then connect the current Capacitor project:</P>
      <Pre>{`npx -y @otakit/cli@1.5.0 login

codex mcp add otakit -- \\
  npx -y @otakit/cli@1.5.0 mcp --project-root .`}</Pre>
      <P>Restart or refresh the agent so it discovers the new Skill and MCP tools. Then try:</P>
      <Prompt>
        Inspect this Capacitor project for OtaKit readiness. Check configuration and native
        compatibility, but do not upload or change anything.
      </Prompt>

      <Separator className="my-10" />

      <H2>Remote MCP with Codex</H2>
      <P>
        Remote MCP is useful when the client cannot run your local CLI, or when you only need
        account and release operations. For Codex, request only the scopes you want the connection
        to expose:
      </P>
      <Pre>{`codex mcp add otakit --url https://console.otakit.app/mcp

codex mcp login \\
  --oauth-client-registration cimd \\
  --scopes otakit:read,otakit:app:write,otakit:bundle:write,otakit:release:write,offline_access \\
  otakit`}</Pre>
      <P>
        The browser flow shows the client, organization, and requested permissions before access is
        granted. You can revoke the connection from{' '}
        <strong>Dashboard → Settings → Connections</strong>; revocation invalidates its tokens
        immediately.
      </P>
      <P>
        For non-interactive automation, configure your MCP client to read an organization key from
        <Code>OTAKIT_TOKEN</Code>. Keep it in the environment or secret manager—never in project
        JSON. Organization keys retain their existing organization-wide operational authority; OAuth
        is the fine-grained option for user connections.
      </P>

      <Separator className="my-10" />

      <H2>Local or remote?</H2>
      <div className="mt-4 overflow-x-auto border border-border">
        <table className="min-w-full border-collapse text-left text-sm text-muted-foreground">
          <CapabilityHeader />
          <tbody className="[&_tr:last-child_td]:border-b-0">
            <CapabilityRow
              capability="Inspect the local Capacitor project"
              local="Yes"
              remote="No"
            />
            <CapabilityRow
              capability="Validate config and native compatibility"
              local="Yes"
              remote="No"
            />
            <CapabilityRow
              capability="Build, package, and upload web assets"
              local="Yes"
              remote="No"
            />
            <CapabilityRow
              capability="Read apps, bundles, releases, and events"
              local="Yes"
              remote="Yes"
            />
            <CapabilityRow
              capability="Prepare, publish, and revert releases"
              local="Yes"
              remote="Yes"
            />
            <CapabilityRow
              capability="Read account status and audit history"
              local="User login"
              remote="OAuth user"
            />
          </tbody>
        </table>
      </div>
      <P>
        Use local MCP for repository work and uploads. Use remote MCP for account-only work. You can
        configure both under different names when one agent needs both contexts.
      </P>

      <Separator className="my-10" />

      <H2>Claude Code</H2>
      <P>
        Install the official Claude plugin for the OtaKit Skill and a full-scope remote connection:
      </P>
      <Pre>{`claude plugin marketplace add OtaKit/otakit
claude plugin install otakit@otakit`}</Pre>
      <P>
        Start Claude Code, run <Code>/mcp</Code>, select <Code>otakit-remote</Code>, and
        authenticate. The consent screen shows the organization and the read, app, bundle, and
        release permissions before anything is granted.
      </P>
      <P>For repository inspection and uploads, add the project-aware local server as well:</P>
      <Pre>{`npx -y @otakit/cli@1.5.0 login

claude mcp add --transport stdio --scope project otakit-local -- \\
  npx -y @otakit/cli@1.5.0 mcp --project-root .`}</Pre>
      <P>
        If you prefer a project-scoped remote connection instead of the plugin default, configure
        its scopes explicitly so Claude exposes every OtaKit operation:
      </P>
      <Pre>{`claude mcp add-json --scope project otakit-remote \\
  '{"type":"http","url":"https://console.otakit.app/mcp","oauth":{"scopes":"otakit:read otakit:app:write otakit:bundle:write otakit:release:write"}}'
claude mcp login otakit-remote
claude mcp get otakit-remote`}</Pre>
      <P>
        Remove write scopes from that JSON when you want a deliberately read-only connection. Commit
        generated project MCP configuration only when the whole team should discover the server.
        OAuth tokens and authorization headers never belong in that file.
      </P>

      <Separator className="my-10" />

      <H2>VS Code and GitHub Copilot</H2>
      <P>
        Create <Code>.vscode/mcp.json</Code>, then run <strong>MCP: List Servers</strong> to review,
        trust, and start the server:
      </P>
      <Pre>{`{
  "servers": {
    "otakit": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@otakit/cli@1.5.0",
        "mcp",
        "--project-root",
        "\${workspaceFolder}"
      ]
    }
  }
}`}</Pre>
      <P>
        For remote MCP, configure <Code>https://console.otakit.app/mcp</Code> as an HTTP server and
        use VS Code&apos;s sign-in flow instead of hardcoding a bearer token.
      </P>

      <Separator className="my-10" />

      <H2>Useful workflows</H2>
      <div className="mt-4 space-y-4">
        <Workflow
          title="Review before upload"
          prompt="Inspect the project, resolve the effective app and lane, and check native compatibility. Show me problems before packaging anything."
        />
        <Workflow
          title="Upload without releasing"
          prompt="Build and upload version 2.4.1 for the staging lane. Do not publish it. Return the bundle ID and anything I should review."
        />
        <Workflow
          title="Prepare a production release"
          prompt="Prepare this bundle for production with force-immediate off and auto-revert enabled. Show the exact current and proposed state, then wait for approval."
        />
        <Workflow
          title="Investigate rollout health"
          prompt="Summarize recent release events and failures for production. Keep client-reported counts separate from unique users or devices."
        />
        <Workflow
          title="Revert deliberately"
          prompt="Prepare a revert of production to the previous release. Show the exact target and current lane state; do not execute until I approve."
        />
      </div>

      <Separator className="my-10" />

      <H2>What the safety workflow preserves</H2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>Exact app, channel, runtime version, bundle, and current release state.</li>
        <li>
          Force-immediate, auto-revert thresholds, encryption, compatibility decisions, and every
          other existing release option.
        </li>
        <li>Preview-first publish and revert operations with explicit client approval.</li>
        <li>
          Idempotent retries and stale-state rejection instead of duplicate or blind releases.
        </li>
        <li>Current organization membership, OAuth scopes, user role, and audit attribution.</li>
        <li>
          Honest analytics language: event records are client-reported diagnostics, not unique
          users, devices, adoption, or proof of cause.
        </li>
      </ul>
      <P>
        MCP does not replace the OtaKit CLI or API. It exposes the same product behavior through an
        agent-compatible interface, so the dashboard, CLI, REST API, and agent all agree on what a
        release means.
      </P>

      <Separator className="my-10" />

      <H2>Self-hosting</H2>
      <P>
        Replace the hosted origin with your console origin. Remote MCP is{' '}
        <Code>{'<console-origin>/mcp'}</Code>. Deploy the agent features disabled, apply the
        supplied additive migrations through your normal reviewed maintenance process, and enable
        release reliability, remote MCP, and OAuth separately. OtaKit does not migrate a live
        database when MCP is enabled.
      </P>
      <P>
        See the <LinkText href="/docs/self-host">self-hosting guide</LinkText> for the platform and{' '}
        <A href="https://github.com/OtaKit/otakit/tree/main/skills/otakit">Agent Skill source</A>{' '}
        for the self-hosted feature flags and rollout checklist.
      </P>

      <Separator className="my-10" />

      <H2>Client references</H2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          <A href="https://developers.openai.com/codex/mcp/">Codex MCP documentation</A>
        </li>
        <li>
          <A href="https://code.claude.com/docs/en/mcp">Claude Code MCP documentation</A>
        </li>
        <li>
          <A href="https://code.visualstudio.com/docs/agent-customization/mcp-servers">
            VS Code MCP documentation
          </A>
        </li>
        <li>
          <A href="https://agentskills.io/">Agent Skills specification</A>
        </li>
      </ul>
    </>
  );
}

function H1({ children }: { children: React.ReactNode }) {
  return <h1 className="text-3xl font-bold tracking-tight">{children}</h1>;
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-semibold tracking-tight">{children}</h2>;
}

function Lead({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">{children}</p>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm leading-6 text-muted-foreground">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{children}</code>;
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 border-l-2 border-emerald-500 bg-emerald-500/5 px-4 py-3 text-sm leading-6 text-muted-foreground">
      {children}
    </div>
  );
}

function SummaryCard({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="bg-background p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-base font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function Prompt({ children }: { children: React.ReactNode }) {
  return (
    <blockquote className="mt-4 border-l-2 border-border bg-muted/40 px-4 py-3 text-sm leading-6 text-foreground">
      “{children}”
    </blockquote>
  );
}

function Workflow({ title, prompt }: { title: string; prompt: string }) {
  return (
    <div className="border border-border p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">“{prompt}”</p>
    </div>
  );
}

function CapabilityRow({
  capability,
  local,
  remote,
}: {
  capability: string;
  local: string;
  remote: string;
}) {
  return (
    <tr className="align-top">
      <td className="border-b border-border px-4 py-3">{capability}</td>
      <td className="border-b border-border px-4 py-3">{local}</td>
      <td className="border-b border-border px-4 py-3">{remote}</td>
    </tr>
  );
}

function CapabilityHeader() {
  return (
    <thead className="bg-muted/50 text-foreground">
      <tr>
        <th className="border-b border-border px-4 py-3 font-semibold">Capability</th>
        <th className="border-b border-border px-4 py-3 font-semibold">Local MCP</th>
        <th className="border-b border-border px-4 py-3 font-semibold">Remote MCP</th>
      </tr>
    </thead>
  );
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-foreground underline underline-offset-4"
    >
      {children}
    </a>
  );
}

function LinkText({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-foreground underline underline-offset-4">
      {children}
    </Link>
  );
}
