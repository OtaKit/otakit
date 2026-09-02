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

/**
 * How the reader works, as one question. Mode and client used to be two
 * stacked controls where the second only ever applied to one answer of the
 * first, which cost the panel two rows of chrome to ask what is really a
 * single thing: what are you driving this from?
 */
export type SetupChoice = AgentClient | 'cli';

export const SETUP_CHOICES: SetupChoice[] = ['claude', 'codex', 'other', 'cli'];

export const CHOICE_LABELS: Record<SetupChoice, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  other: 'Another agent',
  cli: 'Terminal',
};

/** What fits a four-up control at panel width. */
export const CHOICE_SHORT_LABELS: Record<SetupChoice, string> = {
  claude: 'Claude',
  codex: 'Codex',
  other: 'Other',
  cli: 'Terminal',
};

export function choiceMode(choice: SetupChoice): SetupMode {
  return choice === 'cli' ? 'cli' : 'agent';
}

/**
 * Mode and client stay two stored values even though the panel asks once:
 * somebody who tries the terminal and comes back should land on the agent they
 * had picked, not on the default.
 */
export function readChoice(mode: string | null, client: string | null): SetupChoice {
  if (mode === 'cli') return 'cli';
  return client === 'codex' || client === 'other' ? client : 'claude';
}

/**
 * The one-time connect step. It is deliberately not a checkpoint: `otakit
 * login` stores a user session token, so the server cannot tell a connected
 * CLI from somebody clicking in the console. Showing it as permanently
 * unchecked would be worse than not pretending to know.
 */
const CONNECT_COMMAND: Record<SetupChoice, string> = {
  claude: 'claude plugin marketplace add OtaKit/otakit && claude plugin install otakit@otakit',
  codex: 'npx -y @otakit/cli@latest connect --client codex',
  other: 'npx -y @otakit/cli@latest connect',
  cli: 'npm i -g @otakit/cli && otakit login',
};

export function connectCommand(choice: SetupChoice): string {
  return CONNECT_COMMAND[choice];
}

/** The line above that command. One sentence, no second line. */
const CONNECT_SUMMARY: Record<SetupChoice, string> = {
  claude: 'One-time: connect OtaKit to Claude Code',
  codex: 'One-time: connect OtaKit to Codex',
  other: 'One-time: connect OtaKit to your agent',
  cli: 'One-time: install the CLI and sign in',
};

export function connectSummary(choice: SetupChoice): string {
  return CONNECT_SUMMARY[choice];
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
