export type OtaKitErrorCode =
  | 'AUTH_REQUIRED'
  | 'INSUFFICIENT_SCOPE'
  | 'INSUFFICIENT_ROLE'
  | 'ORGANIZATION_NOT_FOUND'
  | 'APP_NOT_FOUND'
  | 'APP_SLUG_CONFLICT'
  | 'BUNDLE_NOT_FOUND'
  | 'BUNDLE_IN_RELEASE_HISTORY'
  | 'INVALID_INPUT'
  | 'INVALID_LANE'
  | 'INCOMPATIBLE_NATIVE_CHANGE'
  | 'STALE_RELEASE_STATE'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'RELEASE_NOT_FOUND'
  | 'RELEASE_NOT_CURRENT'
  | 'MANIFEST_SYNC_PENDING'
  | 'ANALYTICS_UNAVAILABLE'
  | 'RATE_LIMITED';

export class OtaKitServiceError extends Error {
  readonly code: OtaKitErrorCode;
  readonly status: number;
  readonly nextStep?: string;

  constructor(code: OtaKitErrorCode, message: string, status: number, nextStep?: string) {
    super(message);
    this.name = 'OtaKitServiceError';
    this.code = code;
    this.status = status;
    this.nextStep = nextStep;
  }
}

export function isOtaKitServiceError(error: unknown): error is OtaKitServiceError {
  return error instanceof OtaKitServiceError;
}
