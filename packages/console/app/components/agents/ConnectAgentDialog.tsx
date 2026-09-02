'use client';

import { useState } from 'react';
import { ArrowUpRight, Bot, Braces, ServerCog, Terminal, type LucideIcon } from 'lucide-react';

import { CommandBlock } from '@/app/components/CommandBlock';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const HOSTED_ORIGIN = 'https://console.otakit.app';
const DOCS_URL = 'https://otakit.app/docs/agents';

type ClientId = 'claude' | 'codex' | 'vscode' | 'ci';
type Step = { label: string; command: string };

const LOCAL_NOTE =
  'A local agent signs in as you, so it does not appear under Remote connections — that list is only for browser-authorized remote access.';

const CLIENT_TABS: {
  id: ClientId;
  label: string;
  name: string;
  icon: LucideIcon;
  note: string;
}[] = [
  { id: 'claude', label: 'Claude', name: 'Claude Code', icon: Bot, note: LOCAL_NOTE },
  { id: 'codex', label: 'Codex', name: 'Codex', icon: Terminal, note: LOCAL_NOTE },
  { id: 'vscode', label: 'VS Code', name: 'VS Code', icon: Braces, note: LOCAL_NOTE },
  {
    id: 'ci',
    label: 'CI',
    name: 'CI',
    icon: ServerCog,
    note: 'Keep the key in your CI secret store, never in project files.',
  },
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
          // Broken over several lines because the one-line form is wider than
          // the dialog, and a config you have to scroll sideways to read is a
          // config you cannot check before pasting.
          command: `{
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
    // minmax(0,1fr) rather than 1fr: a grid track sizes to its content by
    // default, so a wide command would push the column — and the dialog — out
    // instead of scrolling inside its own block.
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3">
      <span className="mt-0.5 flex size-6 items-center justify-center rounded-full border border-border bg-muted/50 text-[11px] font-medium tabular-nums text-muted-foreground">
        {index}
      </span>
      <div className="min-w-0 space-y-2">
        <p className="text-[13px] font-medium leading-6">{step.label}</p>
        <CommandBlock value={step.command} label={step.label} />
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* One size for every tab. The four clients need different amounts of
          room — a two-line JSON file against a one-line command — and a dialog
          that resizes around its content jumps under the pointer every time
          the reader switches. The frame holds; the step list scrolls. */}
      <DialogContent className="flex h-[min(34rem,calc(100svh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 gap-1.5 border-b border-border px-6 pb-4 pt-6 text-left">
          <DialogTitle className="pr-8 text-base">Connect an agent</DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed">
            Two commands, once per project. The agent signs in with your CLI login, so it can
            inspect the repository, check native compatibility, and upload bundles.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={client}
          onValueChange={(value) => setClient(value as ClientId)}
          className="min-h-0 flex-1 gap-0"
        >
          <div className="shrink-0 px-6 pt-4">
            <TabsList className="grid w-full grid-cols-4">
              {CLIENT_TABS.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id} title={tab.name} className="gap-1.5">
                  {/* The label is the part that has to survive a narrow
                      window; the icon is the first thing to go. */}
                  <tab.icon className="hidden size-3.5 sm:block" />
                  <span className="truncate text-xs">{tab.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {CLIENT_TABS.map((tab) => (
            <TabsContent
              key={tab.id}
              value={tab.id}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-5 pt-5"
            >
              <ol className="space-y-5">
                {stepsFor(tab.id, origin).map((step, index) => (
                  <NumberedStep key={step.label} index={index + 1} step={step} />
                ))}
              </ol>
              <p className="mt-5 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
                {tab.note}
              </p>
            </TabsContent>
          ))}
        </Tabs>

        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-border bg-muted/20 px-6 py-3">
          {/* Dropped rather than truncated on a phone: half a sentence is
              worse than no sentence, and the link is what matters here. */}
          <p className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block">
            The server runs from your project directory.
          </p>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="ml-auto shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
              Setup guide
              <ArrowUpRight className="size-3.5" />
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
