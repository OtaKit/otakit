export type PushErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'PUSH_NOT_CONFIGURED'
  | 'PUSH_LIMIT_REACHED'
  | 'PUSH_CAMPAIGN_NOT_FOUND';

/** An expected failure with a message meant for the user; the host maps it to HTTP. */
export class PushError extends Error {
  constructor(
    public readonly code: PushErrorCode,
    message: string,
    public readonly status: number,
    public readonly nextStep?: string,
  ) {
    super(message);
    this.name = 'PushError';
  }
}

export function isPushError(error: unknown): error is PushError {
  return error instanceof PushError;
}

export function invalidInput(message: string): PushError {
  return new PushError('INVALID_INPUT', message, 400);
}
