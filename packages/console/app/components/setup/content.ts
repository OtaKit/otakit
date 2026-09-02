import type { OnboardingSnapshot } from '@/lib/services/onboarding';

export type SetupMode = 'agent' | 'cli';
export type AgentClient = 'claude' | 'codex' | 'other';
export type StepId = keyof OnboardingSnapshot['steps'];

export const STEP_ORDER: StepId[] = ['app', 'bundle', 'release', 'device'];

/** One or two words. This is what the header indicator shows. */
export const SHORT_LABEL: Record<StepId, string> = {
  app: 'Create app',
  bundle: 'Upload bundle',
  release: 'Publish',
  device: 'Awaiting device',
};

/**
 * One copyable thing per step. Never more: a panel that shows three commands
 * and a tab strip is a document, and nobody reads a document to press a button.
 */
export type StepAction =
  | { kind: 'prompt'; text: string }
  | { kind: 'command'; text: string }
  | { kind: 'none' };

export type StepContent = {
  title: string;
  /** A single line. If it needs two, the step is doing too much. */
  hint: string;
  action: StepAction;
};

export const MODE_LABELS: Record<SetupMode, string> = {
  agent: 'Coding agent',
  cli: 'Terminal',
};

export const CLIENT_LABELS: Record<AgentClient, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  other: 'Other',
};

export const AGENT_CLIENTS: AgentClient[] = ['claude', 'codex', 'other'];

/**
 * The one-time connect step. It is deliberately not a checkpoint: `otakit
 * login` stores a user session token, so the server cannot tell a connected
 * CLI from somebody clicking in the console. Showing it as permanently
 * unchecked would be worse than not pretending to know.
 */
const CONNECT_COMMAND: Record<AgentClient, string> = {
  claude: 'claude plugin marketplace add OtaKit/otakit && claude plugin install otakit@otakit',
  codex: 'npx -y @otakit/cli@latest connect --client codex',
  other: 'npx -y @otakit/cli@latest connect',
};

export function connectCommand(mode: SetupMode, client: AgentClient): string {
  return mode === 'cli' ? 'npm i -g @otakit/cli && otakit login' : CONNECT_COMMAND[client];
}

const AGENT_STEPS: Record<StepId, StepContent> = {
  app: {
    title: 'Create your app',
    hint: 'Registers it, wires the Capacitor plugin, sets the app ID.',
    action: {
      kind: 'prompt',
      text: 'Set up OtaKit in this project: create the app in my OtaKit organization, install and configure the Capacitor plugin, and make sure notifyAppReady() is called once the app has finished booting.',
    },
  },
  bundle: {
    title: 'Upload a bundle',
    hint: 'Builds your web assets and uploads them. Nothing goes live yet.',
    action: {
      kind: 'prompt',
      text: "Build my web assets and upload them to OtaKit as a new bundle. Don't publish it yet — show me what you'd release.",
    },
  },
  release: {
    title: 'Publish it',
    hint: 'Shows you the exact release and waits for your approval.',
    action: {
      kind: 'prompt',
      text: 'Publish the bundle you just uploaded to my default lane. Show me the exact release first and wait for my approval.',
    },
  },
  device: {
    title: 'Land on a device',
    hint: 'Rebuild the native app and launch it.',
    action: { kind: 'none' },
  },
};

const CLI_STEPS: Record<StepId, StepContent> = {
  app: {
    title: 'Create your app',
    hint: 'Then put the app ID in plugins.OtaKit.appId.',
    action: { kind: 'command', text: 'otakit register --slug com.example.app' },
  },
  bundle: {
    title: 'Upload a bundle',
    hint: 'Uploads your built web assets. Nothing goes live yet.',
    action: { kind: 'command', text: 'otakit upload' },
  },
  release: {
    title: 'Publish it',
    hint: 'Promotes the bundle to your default lane.',
    action: { kind: 'command', text: 'otakit release' },
  },
  device: {
    title: 'Land on a device',
    hint: 'Rebuild the native app and launch it.',
    action: { kind: 'none' },
  },
};

export function stepContent(mode: SetupMode, id: StepId): StepContent {
  return mode === 'agent' ? AGENT_STEPS[id] : CLI_STEPS[id];
}

/** The short right-hand fact that proves a step really happened. */
export function stepEvidence(snapshot: OnboardingSnapshot, id: StepId): string | null {
  const steps = snapshot.steps;
  switch (id) {
    case 'app':
      return steps.app.slug;
    case 'bundle':
      return steps.bundle.version;
    case 'release':
      return steps.release.status === 'done' ? (steps.release.channel ?? 'base') : null;
    case 'device':
      return steps.device.status === 'done' ? (steps.device.platform ?? 'Applied') : null;
  }
}

/** What the header indicator says right now. */
export function currentStepLabel(snapshot: OnboardingSnapshot): string {
  if (snapshot.steps.device.status === 'blocked') return 'Needs you';
  const next = STEP_ORDER.find((id) => snapshot.steps[id].status !== 'done');
  return next ? SHORT_LABEL[next] : 'Finish setup';
}
