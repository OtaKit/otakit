import { describe, expect, it } from 'vitest';

import { organizationAccessErrorResponse } from './http';

describe('organization access error responses', () => {
  it('preserves machine-readable selection guidance for CLI clients', async () => {
    const response = organizationAccessErrorResponse({
      success: false,
      status: 409,
      error: 'Choose an organization for this command.',
      code: 'ORGANIZATION_SELECTION_REQUIRED',
      nextStep: 'Run `otakit organization select` and retry.',
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Choose an organization for this command.',
      code: 'ORGANIZATION_SELECTION_REQUIRED',
      nextStep: 'Run `otakit organization select` and retry.',
    });
  });
});
