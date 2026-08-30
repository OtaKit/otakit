import { NextResponse } from 'next/server';

import { isOtaKitServiceError } from './errors';

export function serviceErrorResponse(error: unknown): NextResponse {
  if (isOtaKitServiceError(error)) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        ...(error.nextStep ? { nextStep: error.nextStep } : {}),
      },
      { status: error.status },
    );
  }

  console.error('Unhandled service error', error);
  return NextResponse.json(
    { error: 'Internal server error', code: 'INTERNAL_ERROR' },
    { status: 500 },
  );
}
