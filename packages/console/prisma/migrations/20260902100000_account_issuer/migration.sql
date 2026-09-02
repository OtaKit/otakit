-- Better Auth 1.7 keys an OAuth account by (issuer, accountId) rather than by
-- (providerId, accountId), and writes the issuer on every social sign-in. The
-- column never existed here, so since the 1.4 -> 1.7 bump every callback threw
-- PrismaClientValidationError and no social sign-in could complete.
--
-- Added nullable, backfilled, then made NOT NULL: adding a required column to a
-- populated table has no value for the rows already in it. The backfill matches
-- what Better Auth derives from a provider id, so existing accounts keep their
-- identity instead of looking like new ones on the next sign-in.
ALTER TABLE "Account" ADD COLUMN "issuer" TEXT;

UPDATE "Account" SET "issuer" = 'local:oauth:' || "providerId" WHERE "issuer" IS NULL;

ALTER TABLE "Account" ALTER COLUMN "issuer" SET NOT NULL;

-- The key Better Auth looks accounts up by. Fails loudly if two rows already
-- share a provider and account id, which would be a duplicate to resolve by
-- hand rather than something to index over.
CREATE UNIQUE INDEX "Account_issuer_accountId_key" ON "Account"("issuer", "accountId");
