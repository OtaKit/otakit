import Link from 'next/link';

import { Pre } from '@/app/docs/CodeBlock';
import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'MCP & Agent Skills',
  description:
    'Let Claude Code, Codex, and VS Code ship your Capacitor OTA updates — with the same review and approval your team already uses.',
};

export default function AgentsPage() {
  return (
    <>
      <H1>MCP &amp; Agent Skills</H1>
      <P>
        Ask your coding agent to ship an update and it will read your Capacitor project, check
        whether the change is safe to send over the air, upload the build, and then stop and show
        you exactly what it is about to publish. Nothing reaches a device until you approve it.
      </P>

      <Separator className="my-10" />

      <H2>Set it up</H2>
      <P>One command, from your project directory:</P>
      <Pre>{`npx -y @otakit/cli@latest connect`}</Pre>
      <P>
        It detects your client, signs you in if you are not already, and prints the console,
        organization, project, and app it resolved — plus the exact file it will write — before
        writing anything:
      </P>
      <Pre>{`Connecting Claude Code (detected).

  console       https://console.otakit.app
  organization  Acme Inc
  signed in as  dev@acme.example
  project       /Users/dev/shop
  app           com.acme.shop (from config)

Will add server "otakit" in .mcp.json:
  ...

Write it? [y/N]`}</Pre>
      <P>
        <Code>--dry-run</Code> prints the same plan and writes nothing. <Code>--client</Code>{' '}
        overrides detection. <Code>--yes</Code> skips the prompt in scripts.
      </P>

      <H3>Claude Code</H3>
      <P>
        The official plugin ships the server and the OtaKit Skill together, so this is the whole
        setup:
      </P>
      <Pre>{`npx -y @otakit/cli@latest login

claude plugin marketplace add OtaKit/otakit
claude plugin install otakit@otakit`}</Pre>
      <P>
        Run <Code>/mcp</Code> and you should see <Code>otakit</Code> connected to whichever project
        you have open.
      </P>

      <H3>Codex</H3>
      <Pre>{`npx skills add https://github.com/OtaKit/otakit --skill otakit

npx -y @otakit/cli@latest login
codex mcp add otakit -- npx -y @otakit/cli@latest mcp`}</Pre>

      <H3>VS Code and GitHub Copilot</H3>
      <P>
        Create <Code>.vscode/mcp.json</Code>, then run <strong>MCP: List Servers</strong> to trust
        and start it:
      </P>
      <Pre>{`{
  "servers": {
    "otakit": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@otakit/cli@latest", "mcp", "--project-root", "\${workspaceFolder}"]
    }
  }
}`}</Pre>

      <Separator className="my-10" />

      <H2>What to ask for</H2>
      <P>
        Clients that support MCP prompts expose these as slash commands. Plain language works just
        as well.
      </P>
      <div className="mt-4 overflow-x-auto border border-border">
        <table className="min-w-full border-collapse text-left text-sm text-muted-foreground">
          <thead className="bg-muted/50 text-foreground">
            <tr>
              <th className="border-b border-border px-4 py-3 font-semibold">Command</th>
              <th className="border-b border-border px-4 py-3 font-semibold">What it does</th>
            </tr>
          </thead>
          <tbody className="[&_tr:last-child_td]:border-b-0">
            <PromptRow
              command="/check"
              detail="Reads the project, resolves the lane, and checks native compatibility. Changes nothing."
            />
            <PromptRow
              command="/release"
              detail="Uploads the build and prepares the release, then stops for your approval."
            />
            <PromptRow
              command="/rollout"
              detail="Summarises recent client-reported events for the current release."
            />
            <PromptRow
              command="/revert"
              detail="Prepares a revert and shows the exact target before doing anything."
            />
          </tbody>
        </table>
      </div>
      <P>Or just say what you want:</P>
      <Ul>
        <li>“Upload version 2.4.1 to staging but don’t publish it — tell me the bundle ID.”</li>
        <li>“Prepare this for production with auto-revert on, then wait for me.”</li>
        <li>“Why are people on 1.4.2 seeing rollbacks?”</li>
        <li>“Roll production back to the previous release.”</li>
      </Ul>

      <Separator className="my-10" />

      <H2>Before anything ships</H2>
      <P>
        Publishing and reverting always stop for approval, and always show the same block — so you
        read it at a glance instead of parsing whatever the agent decided to write:
      </P>
      <Pre>{`Publish  com.acme.shop
  lane       base · runtime 2026.04
  from       1.4.0  ->  1.5.0
  native     compatible (12 packages unchanged)
  immediate  no        auto-revert  on · 10% · min 100
Approve? This goes live for every device on that lane.`}</Pre>
      <P>
        Uploading is separate from publishing, so an agent can prepare a build for you to look at
        with no risk of it reaching a device. A publish carries the release state the agent
        reviewed, so if a teammate releases in between, yours is rejected instead of silently
        overwriting theirs. Every write is attributed in the audit log.
      </P>
      <P>
        Native compatibility is checked against what the current release actually shipped. If your
        app gained a native dependency, that needs a store build rather than an OTA update, and the
        agent stops and says so. If it cannot read your dependencies at all, it says that too
        instead of guessing.
      </P>

      <Separator className="my-10" />

      <H2 id="remote">Working without a checkout</H2>
      <P>
        The setup above runs OtaKit in your repository, which is what lets it inspect the project
        and upload builds. There is also a remote endpoint over HTTPS at{' '}
        <Code>console.otakit.app/mcp</Code> for clients that cannot run a local process, and for CI.
        It does everything except the parts that need your files:
      </P>
      <div className="mt-4 overflow-x-auto border border-border">
        <table className="min-w-full border-collapse text-left text-sm text-muted-foreground">
          <CapabilityHeader />
          <tbody className="[&_tr:last-child_td]:border-b-0">
            <CapabilityRow capability="Inspect the Capacitor project" local="Yes" remote="No" />
            <CapabilityRow capability="Check native compatibility" local="Yes" remote="No" />
            <CapabilityRow capability="Package and upload web assets" local="Yes" remote="No" />
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
            <CapabilityRow capability="Signs in with" local="CLI login" remote="OAuth or key" />
          </tbody>
        </table>
      </div>
      <P>
        Add it alongside the local server, not instead of it — running both means your agent sees
        two copies of the shared tools.
      </P>
      <Pre>{`# Claude Code
claude mcp add-json --scope project otakit-remote \\
  '{"type":"http","url":"https://console.otakit.app/mcp","oauth":{"scopes":"otakit:read otakit:app:write otakit:bundle:write otakit:release:write"}}'
claude mcp login otakit-remote

# Codex
codex mcp add otakit-remote --url https://console.otakit.app/mcp
codex mcp login --oauth-client-registration cimd \\
  --scopes otakit:read,otakit:app:write,otakit:bundle:write,otakit:release:write,offline_access \\
  otakit-remote`}</Pre>
      <P>
        The browser flow shows the client, the organization, and what it is asking for before
        anything is granted. Drop the write scopes for a deliberately read-only connection. Revoke
        it from <strong>Settings → Agents</strong> and its tokens stop working immediately. For CI,
        use an organization key in <Code>OTAKIT_TOKEN</Code> and keep it in your secret store, never
        in a project file.
      </P>

      <Separator className="my-10" />

      <H2>Which organization it uses</H2>
      <P>
        A connection is bound to one organization for its lifetime, and it tells the agent which one
        as soon as it connects. A project with a configured <Code>appId</Code> uses that app’s
        organization. Without one, it uses the default you chose at login — change it with{' '}
        <Code>otakit organization select</Code> and restart the server. Automation can set{' '}
        <Code>OTAKIT_ORGANIZATION_ID</Code> instead.
      </P>
      <P>
        This is deliberately separate from the dashboard: switching workspaces in the browser does
        not move a running agent connection.
      </P>

      <Separator className="my-10" />

      <H2>Self-hosting</H2>
      <P>
        Use your own console origin everywhere — <Code>otakit connect</Code> picks it up from{' '}
        <Code>plugins.OtaKit.serverUrl</Code> automatically. Remote MCP lives at{' '}
        <Code>{'<console-origin>/mcp'}</Code>.
      </P>
      <P>
        The agent features roll out in stages and ship disabled. Deploy the code, apply the additive
        migrations through your normal reviewed process, then enable release reliability, remote
        MCP, and OAuth one at a time. OtaKit never migrates a live database for you.
      </P>
      <P>
        See the <LinkText href="/docs/self-host">self-hosting guide</LinkText>, and the{' '}
        <A href="https://github.com/OtaKit/otakit/tree/main/skills/otakit">Agent Skill source</A>{' '}
        for the flags and rollout checklist.
      </P>

      <Separator className="my-10" />

      <H2>Reference</H2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          <LinkText href="/docs/cli">OtaKit CLI reference</LinkText> — every command the agent falls
          back to
        </li>
        <li>
          <A href="https://learn.chatgpt.com/docs/extend/mcp?surface=cli">Codex MCP</A>
        </li>
        <li>
          <A href="https://code.claude.com/docs/en/mcp">Claude Code MCP</A>
        </li>
        <li>
          <A href="https://code.visualstudio.com/docs/agent-customization/mcp-servers">
            VS Code MCP
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

function H2({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-lg font-semibold tracking-tight">
      {children}
    </h2>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-8 text-sm font-semibold tracking-tight">{children}</h3>;
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

function PromptRow({ command, detail }: { command: string; detail: string }) {
  return (
    <tr className="align-top">
      <td className="border-b border-border px-4 py-3">
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{command}</code>
      </td>
      <td className="border-b border-border px-4 py-3">{detail}</td>
    </tr>
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
        <th className="border-b border-border px-4 py-3 font-semibold">In your repo</th>
        <th className="border-b border-border px-4 py-3 font-semibold">Remote</th>
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
