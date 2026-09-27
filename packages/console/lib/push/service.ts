import { createPushService } from '@otakit/push-server';

import { db } from '@/lib/db';

/**
 * The push add-on, wired to OtaKit. This folder is the only place the console talks
 * to @otakit/push-server (enforced in eslint.config.mjs).
 */
export const push = createPushService({
  async getWorkspace(organizationId) {
    const organization = await db.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { planKey: true, usagePeriodStart: true },
    });
    return { plan: organization.planKey, periodStart: organization.usagePeriodStart };
  },
});

export { registerDeviceSchema, topicsSchema } from '@otakit/push-server';
