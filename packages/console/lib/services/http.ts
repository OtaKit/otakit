import { NextResponse } from 'next/server';

import type { OrganizationAccessResult } from '@/lib/organization-access';

import { isOtaKitServiceError } from './errors';

type OrganizationAccessError = Extract<OrganizationAccessResult, { success: false }>;

export function organizationAccessErrorResponse(error: OrganizationAccessError): NextResponse {
  return NextResponse.json(
    {
      error: error.error,
      ...(error.code ? { code: error.code } : {}),
      ...(error.nextStep ? { nextStep: error.nextStep } : {}),
    },
    { status: error.status },
  );
}

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
