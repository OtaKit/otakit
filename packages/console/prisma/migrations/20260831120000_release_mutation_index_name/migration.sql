-- The index in 20260830140000 was named with 68 characters. Postgres truncates
-- identifiers at 63 bytes and stored
-- "ReleaseMutation_organizationId_actorKey_operation_idempotencyKe", while
-- Prisma generates a differently truncated name and therefore reported drift
-- immediately after a clean deploy.
--
-- Renaming here rather than editing the original keeps that migration's
-- checksum intact for any database that already applied it.
ALTER INDEX IF EXISTS "ReleaseMutation_organizationId_actorKey_operation_idempotencyKe"
RENAME TO "ReleaseMutation_organizationId_actorKey_operation_idempoten_key";
