import Link from 'next/link';

import { Pre } from '@/app/docs/CodeBlock';
import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'MCP & Agent Skills',
  description:
    'Connect Codex, Claude Code, VS Code, and other coding agents to OtaKit with MCP and Agent Skills.',
};

export default function AgentsPage() {
  return (
    <>
      <H1>MCP &amp; Agent Skills</H1>
      <P>
        Connect your coding agent to OtaKit without creating a separate release process. MCP gives
        the agent access to your project and OtaKit account; the open OtaKit Skill provides the
        release workflow.
      </P>

      <Separator className="my-10" />

      <H2>Choose how your agent connects</H2>
      <Ul>
        <li>
          <strong>Local MCP</strong> runs through the OtaKit CLI in your repository. Use it to
          inspect the Capacitor project, check native compatibility, package web assets, and upload
          builds.
        </li>
        <li>
          <strong>Remote MCP</strong> connects over HTTPS. Use it for apps, releases, events, and
          account operations when the agent does not need local files.
        </li>
        <li>
          <strong>Agent Skills</strong> provide reusable instructions. The OtaKit Skill teaches the
          agent how to choose the right connection and follow the complete release and revert
          workflow.
        </li>
      </Ul>
      <P>
        Local MCP and the OtaKit Skill work even when hosted remote MCP is not enabled. An
        unavailable remote server is a deployment setting, not an authentication failure.
      </P>
      <P>
        Local MCP normally derives its fixed organization from the project&apos;s configured OtaKit
        app and verifies your membership. During login, multi-organization users choose a named
        default for app-less commands. Change it later with <Code>otakit organization select</Code>;
        no organization ID is needed for interactive setup.
      </P>
      <P>
        The CLI default is local to that console and user. It does not follow or change the active
        dashboard workspace, and a configured app always selects its own organization. Automation
        can override app-less context with <Code>OTAKIT_ORGANIZATION_ID</Code>.
      </P>

      <Separator className="my-10" />

      <H2>One command</H2>
      <P>
        <Code>otakit connect</Code> detects your client, signs you in if needed, and writes the MCP
        configuration for the current project. It prints the console, organization, project, and app
        it resolved, plus the exact file and contents it will write, before writing anything:
      </P>
      <Pre>{`npx -y @otakit/cli@latest connect`}</Pre>
      <P>
        Use <Code>--dry-run</Code> to see the plan and exit, <Code>--client</Code> to override
        detection, and <Code>--yes</Code> to skip the prompt in scripts. The rest of this page is
        the manual equivalent, per client.
      </P>

      <Separator className="my-10" />

      <H2>Codex</H2>
      <P>Install the open OtaKit Skill:</P>
      <Pre>{`npx skills add https://github.com/OtaKit/otakit --skill otakit`}</Pre>
      <P>Sign in to OtaKit, then connect the current Capacitor project:</P>
      <Pre>{`npx -y @otakit/cli@latest login

codex mcp add otakit -- \\
  npx -y @otakit/cli@latest mcp --project-root .`}</Pre>
      <P>Restart or refresh Codex, then try a read-only request:</P>
      <Pre>{`Inspect this Capacitor project for OtaKit readiness. Check configuration and native compatibility, but do not upload or change anything.`}</Pre>

      <Separator className="my-10" />

      <H2>Remote MCP with Codex</H2>
      <P>
        Remote MCP is useful when the client cannot run your local CLI, or when you only need
        account and release operations. For Codex, request only the scopes you want the connection
        to expose:
      </P>
      <Pre>{`codex mcp add otakit-remote --url https://console.otakit.app/mcp

codex mcp login \\
  --oauth-client-registration cimd \\
  --scopes otakit:read,otakit:app:write,otakit:bundle:write,otakit:release:write,offline_access \\
  otakit-remote`}</Pre>
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
        Install the official Claude plugin. It ships the OtaKit Skill and the project-aware local
        server, which is the connection that can inspect your project, check native compatibility,
        and upload bundles:
      </P>
      <Pre>{`npx -y @otakit/cli@latest login

claude plugin marketplace add OtaKit/otakit
claude plugin install otakit@otakit`}</Pre>
      <P>
        The server binds to whichever project you have open. Start Claude Code, run{' '}
        <Code>/mcp</Code>, and you should see <Code>otakit</Code> connected. Try a read-only request
        first:
      </P>
      <Pre>{`Inspect this Capacitor project for OtaKit readiness. Check configuration and native compatibility, but do not upload or change anything.`}</Pre>
      <P>
        Add a remote connection as well only when you want account and release operations without a
        checkout. Configure its scopes explicitly:
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
        "@otakit/cli@latest",
        "mcp",
        "--project-root",
        "\${workspaceFolder}"
      ]
    }
  }
}`}</Pre>
      <P>For remote MCP, add a separate HTTP server and use VS Code&apos;s sign-in flow:</P>
      <Pre>{`{
  "servers": {
    "otakit-remote": {
      "type": "http",
      "url": "https://console.otakit.app/mcp"
    }
  }
}`}</Pre>

      <Separator className="my-10" />

      <H2>Useful workflows</H2>
      <Ul>
        <li>
          <strong>Review before upload:</strong> “Inspect the project, resolve the effective app and
          lane, and check native compatibility. Show me problems before packaging anything.”
        </li>
        <li>
          <strong>Upload without releasing:</strong> “Build and upload version 2.4.1 for staging. Do
          not publish it. Return the bundle ID and anything I should review.”
        </li>
        <li>
          <strong>Prepare a production release:</strong> “Prepare this bundle for production with
          force-immediate off and auto-revert enabled. Show the current and proposed state, then
          wait for approval.”
        </li>
        <li>
          <strong>Investigate rollout health:</strong> “Summarize recent production release events
          and failures. Keep event records separate from unique users or devices.”
        </li>
        <li>
          <strong>Revert:</strong> “Prepare a revert of production to the previous release. Show the
          exact target and do not execute it until I approve.”
        </li>
      </Ul>

      <Separator className="my-10" />

      <H2>The same release workflow</H2>
      <Ul>
        <li>Exact app, channel, runtime version, bundle, and current release state.</li>
        <li>
          Existing release options, including force-immediate behavior, auto-revert thresholds,
          encryption, and compatibility decisions.
        </li>
        <li>
          Upload-only, combined upload-and-release, prepared publish, and prepared revert flows.
        </li>
        <li>Organization membership, OAuth scopes, user roles, and audit attribution.</li>
        <li>Release events with the same raw diagnostic detail available through the API.</li>
      </Ul>
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
          <A href="https://learn.chatgpt.com/docs/extend/mcp?surface=cli">
            Codex MCP documentation
          </A>
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
  return <h1 className="text-2xl font-bold tracking-tight">{children}</h1>;
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold tracking-tight">{children}</h2>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm text-muted-foreground">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{children}</code>;
}

function Ul({ children }: { children: React.ReactNode }) {
  return (
    <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">{children}</ul>
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
