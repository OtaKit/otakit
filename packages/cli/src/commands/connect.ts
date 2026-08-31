import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { Command } from 'commander';

import { ApiClient, OtaKitApiError } from '../lib/api.js';
import { resolveAuthToken, resolveConfigSnapshot, resolveServerUrl } from '../lib/config.js';
import { CliError, runCommand } from '../lib/errors.js';
import { signInWithEmailOtp } from '../lib/login-flow.js';
import { confirm } from '../lib/prompt.js';
import { storeAuthProfile } from '../lib/token-store.js';
import { CLI_VERSION } from '../lib/version.js';

const SERVER_NAME = 'otakit';

type ConnectOptions = {
  client?: string;
  projectRoot?: string;
  server?: string;
  dryRun?: boolean;
  yes?: boolean;
};

type ClientId = 'claude' | 'codex' | 'vscode';

type ContextResponse = {
  organization: { id: string; name: string };
  actor: { label: string };
  app?: { id: string; slug: string } | null;
};

/**
 * Which agent this repository is set up for. Detection only ever picks the
 * default shown in the plan; `--client` overrides it and the plan states what
 * was chosen, so nothing is configured behind the user's back.
 */
function detectClient(projectRoot: string): ClientId {
  if (existsSync(join(projectRoot, '.claude')) || existsSync(join(projectRoot, 'CLAUDE.md'))) {
    return 'claude';
  }
  if (existsSync(join(projectRoot, '.codex')) || existsSync(join(projectRoot, 'AGENTS.md'))) {
    return 'codex';
  }
  if (existsSync(join(projectRoot, '.vscode'))) return 'vscode';
  return 'claude';
}

function parseClient(value: string | undefined, projectRoot: string): ClientId {
  if (!value) return detectClient(projectRoot);
  const normalized = value.trim().toLowerCase();
  if (normalized === 'claude' || normalized === 'claude-code') return 'claude';
  if (normalized === 'codex') return 'codex';
  if (normalized === 'vscode' || normalized === 'vs-code') return 'vscode';
  throw new CliError(`Unknown client "${value}". Use claude, codex, or vscode.`);
}

const CLIENT_LABELS: Record<ClientId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  vscode: 'VS Code',
};

function serverEntry(serverUrl: string, isHosted: boolean, projectRootToken: string) {
  const args = ['-y', '@otakit/cli@latest', 'mcp', '--project-root', projectRootToken];
  if (!isHosted) args.push('--server', serverUrl);
  return { type: 'stdio' as const, command: 'npx', args };
}

function configTargetFor(client: ClientId, projectRoot: string): string | null {
  if (client === 'claude') return join(projectRoot, '.mcp.json');
  if (client === 'vscode') return join(projectRoot, '.vscode', 'mcp.json');
  // Codex keeps servers in ~/.codex/config.toml. Hand-editing someone's global
  // TOML is not something to do quietly, so print its own command instead.
  return null;
}

function readExisting(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // VS Code allows comments in mcp.json. Rewriting the file would drop them
    // anyway, so stop rather than silently discarding someone's notes.
    throw new CliError(
      `${path} could not be parsed as JSON (comments are not supported here). Add the server by hand, or move the file and run again.`,
    );
  }
}

function row(label: string, value: string): string {
  return `  ${label.padEnd(14)}${value}`;
}

export const connectCommand = new Command('connect')
  .description('Connect this project to your coding agent')
  .option('--client <client>', 'claude, codex, or vscode (default: detected)')
  .option('--project-root <path>', 'Project to connect (default: current directory)')
  .option('--server <url>', 'OtaKit console URL override')
  .option('--dry-run', 'Show what would be written and exit')
  .option('--yes', 'Skip the confirmation prompt')
  .action(async (options: ConnectOptions) => {
    await runCommand(async () => {
      const projectRoot = resolve(options.projectRoot ?? process.cwd());
      if (!existsSync(projectRoot)) {
        throw new CliError(`Project root does not exist: ${projectRoot}`);
      }
      const client = parseClient(options.client, projectRoot);
      const serverUrl = resolveServerUrl(projectRoot, options.server);
      const isHosted = serverUrl.replace(/\/+$/, '') === 'https://console.otakit.app';

      // Sign in first if needed, so this really is one command.
      let auth = await resolveAuthToken(serverUrl);
      if (!auth) {
        console.log(`Not signed in to ${serverUrl}.`);
        const { token } = await signInWithEmailOtp(serverUrl);
        const stored = await storeAuthProfile(serverUrl, { token });
        if (!stored.ok) {
          throw new CliError(stored.reason ?? 'Could not store the access token.');
        }
        auth = await resolveAuthToken(serverUrl);
        console.log('');
      }
      if (!auth) throw new CliError('Not authenticated. Run `otakit login`, or set OTAKIT_TOKEN.');

      const snapshot = await resolveConfigSnapshot({ cwd: projectRoot });
      const probe = new ApiClient(
        {
          appId: snapshot.appId.value ?? '00000000-0000-0000-0000-000000000000',
          serverUrl,
          authToken: auth.token,
          authSource: auth.source,
        },
        CLI_VERSION,
        snapshot.appId.value ? {} : { organizationId: auth.organizationId ?? undefined },
      );

      let context: ContextResponse;
      try {
        context = await probe.request<ContextResponse>(
          snapshot.appId.value
            ? `/api/v1/context?${new URLSearchParams({ appId: snapshot.appId.value })}`
            : '/api/v1/context',
        );
      } catch (error) {
        if (error instanceof OtaKitApiError && error.nextStep) {
          throw new CliError(`${error.message}\n${error.nextStep}`);
        }
        throw error;
      }

      const target = configTargetFor(client, projectRoot);
      const projectRootToken =
        client === 'claude'
          ? '${CLAUDE_PROJECT_DIR}'
          : client === 'vscode'
            ? '${workspaceFolder}'
            : '.';
      const entry = serverEntry(serverUrl, isHosted, projectRootToken);

      // Everything that is about to happen, before any of it happens.
      console.log(`Connecting ${CLIENT_LABELS[client]}${options.client ? '' : ' (detected)'}.`);
      console.log('');
      console.log(row('console', serverUrl));
      console.log(row('organization', context.organization.name));
      console.log(row('signed in as', context.actor.label));
      console.log(row('project', projectRoot));
      console.log(
        row(
          'app',
          snapshot.appId.value
            ? `${context.app?.slug ?? snapshot.appId.value} (from ${snapshot.appId.source})`
            : 'none configured — set plugins.OtaKit.appId in capacitor.config.*',
        ),
      );
      console.log('');

      if (!target) {
        const command = `codex mcp add ${SERVER_NAME} -- ${entry.command} ${entry.args.join(' ')}`;
        console.log('Codex stores MCP servers in ~/.codex/config.toml. Run:');
        console.log('');
        console.log(`  ${command}`);
        console.log('');
        console.log('Then restart Codex and ask it to inspect this project.');
        return;
      }

      const existing = readExisting(target);
      // VS Code's mcp.json uses "servers"; Claude Code's .mcp.json uses
      // "mcpServers". The client decides, not whatever happens to be in the file.
      const key = client === 'vscode' ? 'servers' : 'mcpServers';
      const servers = (existing[key] ?? {}) as Record<string, unknown>;
      const replacing = Object.prototype.hasOwnProperty.call(servers, SERVER_NAME);
      const relativeTarget = relative(projectRoot, target) || target;

      console.log(
        `Will ${replacing ? 'replace' : 'add'} server "${SERVER_NAME}" in ${relativeTarget}:`,
      );
      console.log('');
      for (const line of JSON.stringify({ [SERVER_NAME]: entry }, null, 2).split('\n')) {
        console.log(`  ${line}`);
      }
      console.log('');

      if (options.dryRun) {
        console.log('Dry run: nothing was written.');
        return;
      }

      if (!options.yes) {
        if (!process.stdin.isTTY) {
          throw new CliError('Confirmation needs an interactive terminal. Re-run with --yes.');
        }
        if (!(await confirm('Write it?'))) {
          console.log('Cancelled. Nothing was written.');
          return;
        }
      }

      const next = { ...existing, [key]: { ...servers, [SERVER_NAME]: entry } };
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(next, null, 2)}\n`, 'utf8');

      console.log('');
      console.log(`Wrote ${relativeTarget}.`);
      console.log(
        client === 'claude'
          ? 'Restart Claude Code, run /mcp to confirm "otakit" is connected, then ask it to inspect this project.'
          : 'Run "MCP: List Servers" in VS Code to trust and start the server.',
      );
    });
  });
