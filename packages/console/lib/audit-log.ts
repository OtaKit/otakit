import { db } from './db';
import { resolveReleaseActor } from './release-audit';
import type { OrganizationAccess } from './organization-access';
import type { SessionContext } from './session';

export type AuditAction =
  | 'organization.created'
  | 'organization.renamed'
  | 'app.created'
  | 'bundle.uploaded'
  | 'bundle.deleted'
  | 'release.created'
  | 'release.reverted'
  | 'release.auto_reverted'
  | 'release.auto_revert_suppressed'
  | 'api_key.created'
  | 'api_key.revoked'
  | 'member.added'
  | 'member.removed'
  | 'member.joined'
  | 'invite.created'
  | 'invite.revoked'
  | 'oauth.connection_revoked';

export type AuditActor = {
  actorType: 'user' | 'key' | 'system';
  actorId?: string;
  actorLabel: string;
};

export function sessionActor(ctx: SessionContext): AuditActor {
  return { actorType: 'user', actorId: ctx.userId, actorLabel: ctx.email };
}

/**
 * Actor for routes authenticated via resolveOrganizationAccess (user or API key).
 * Pass `label` when the route already resolved one (e.g. Release.promotedBy)
 * to avoid a duplicate lookup.
 */
export async function accessActor(access: OrganizationAccess, label?: string): Promise<AuditActor> {
  return {
    actorType: access.actorType,
    actorId: access.actorId,
    actorLabel: label ?? (await resolveReleaseActor(access)),
  };
}

export type AuditLogEntry = {
  organizationId: string;
  actor: AuditActor;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Persist an audit log entry. Never throws — audit failures must not break
 * the mutation that triggered them. Callers should await this (un-awaited
 * work may be killed once the response is sent on serverless).
 */
export async function recordAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        actorType: entry.actor.actorType,
        actorId: entry.actor.actorId ?? null,
        actorLabel: entry.actor.actorLabel,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        metadata: entry.metadata ? JSON.parse(JSON.stringify(entry.metadata)) : undefined,
      },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        auditLogWriteFailed: entry.action,
        organizationId: entry.organizationId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
