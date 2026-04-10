export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

export async function runCommand(action: () => Promise<void> | void): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown command error';
    const exitCode = error instanceof CliError ? error.exitCode : 1;
    console.error(message);
    process.exitCode = exitCode;
  }
}
