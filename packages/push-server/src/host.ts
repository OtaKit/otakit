export type PushPlan = 'free' | 'starter' | 'pro' | 'enterprise';

/**
 * What push needs from the product it runs in. Everything else (who may call what,
 * whether the add-on is switched on, audit logging) is the host's business.
 */
export interface PushHost {
  /** Plan and billing period of a workspace, for push limits and monthly usage. */
  getWorkspace(organizationId: string): Promise<{ plan: PushPlan; periodStart: Date | null }>;
}
