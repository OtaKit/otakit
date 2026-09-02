'use client';

import { useState } from 'react';

import { CopyButton } from '@/app/components/CopyButton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const HOSTED_ORIGIN = 'https://console.otakit.app';

type ClientId = 'claude' | 'codex' | 'vscode' | 'ci';
type Step = { label: string; command: string };

const CLIENT_TABS: { id: ClientId; label: string }[] = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'vscode', label: 'VS Code' },
  { id: 'ci', label: 'CI' },
];

/**
 * Local stdio is what these commands set up on purpose: it is the only mode
 * that can inspect the project, check native compatibility, and upload a
 * bundle. Remote MCP covers account and release operations without local files.
 */
function stepsFor(client: ClientId, origin: string): Step[] {
  const selfHosted = origin !== HOSTED_ORIGIN;
  const serverFlag = selfHosted ? ` --server ${origin}` : '';
  const login = { label: 'Sign in once', command: `npx -y @otakit/cli@latest login${serverFlag}` };

  switch (client) {
    case 'claude':
      return [
        login,
        {
          label: 'Add the server to this project',
          command: `claude mcp add --transport stdio --scope project otakit -- \\\n  npx -y @otakit/cli@latest mcp --project-root '\${CLAUDE_PROJECT_DIR:-.}'`,
        },
      ];
    case 'codex':
      return [
        login,
        {
          label: 'Add the server to this project',
          command: `codex mcp add otakit -- \\\n  npx -y @otakit/cli@latest mcp --project-root .`,
        },
      ];
    case 'vscode':
      return [
        login,
        {
          label: 'Create .vscode/mcp.json',
          command: `{
  "servers": {
    "otakit": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@otakit/cli@latest", "mcp", "--project-root", "\${workspaceFolder}"]
    }
  }
}`,
        },
      ];
    case 'ci':
      return [
        {
          label: 'Export an organization key from API keys',
          command: `export OTAKIT_TOKEN=otakit_sk_...\nexport OTAKIT_APP_ID=<your app id>`,
        },
        {
          label: 'Run the server without an interactive login',
          command: `npx -y @otakit/cli@latest mcp --project-root .`,
        },
      ];
  }
}

function NumberedStep({ index, step }: { index: number; step: Step }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-medium tabular-nums text-muted-foreground">
        {index}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-medium">{step.label}</p>
          <CopyButton value={step.command} label={step.label} />
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/60 px-3 py-2.5 text-[11px] leading-relaxed">
          <code>{step.command}</code>
        </pre>
      </div>
    </li>
  );
}

export function ConnectAgentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [client, setClient] = useState<ClientId>('claude');
  // Read from the build-time public URL, which is identical on the server and
  // the client. window.location would either differ across hydration or, from
  // an effect, paint hosted commands for a frame that a self-hosted user could
  // copy in between.
  const origin = (process.env.NEXT_PUBLIC_APP_URL?.trim() || HOSTED_ORIGIN).replace(/\/+$/, '');
  const steps = stepsFor(client, origin);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Connect an agent</DialogTitle>
          <DialogDescription>
            Run these in your project. The agent signs in with your CLI login, so it can inspect the
            repository, check native compatibility, and upload bundles.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1">
          {CLIENT_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setClient(tab.id)}
              aria-pressed={client === tab.id}
              className={cn(
                'rounded-md px-2.5 py-1.5 text-xs transition-colors',
                client === tab.id
                  ? 'bg-accent font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <ol className="space-y-4">
          {steps.map((step, index) => (
            <NumberedStep key={step.label} index={index + 1} step={step} />
          ))}
        </ol>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {client === 'ci' ? (
            <>Keep the key in your CI secret store, never in project files.</>
          ) : (
            <>
              A local agent signs in as you, so it does not appear in the connections list — that
              list is only for browser-authorized remote access.
            </>
          )}{' '}
          <a
            href="https://otakit.app/docs/agents"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Setup guide
          </a>
        </p>
      </DialogContent>
    </Dialog>
  );
}
