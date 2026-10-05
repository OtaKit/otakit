-- Better Auth 1.7.3 removed the account issuer that 1.7.0-1.7.2 required:
-- accounts are keyed by (providerId, accountId) again and new rows no longer
-- write issuer, so a NOT NULL issuer would reject every sign-up and account
-- link. https://www.better-auth.com/docs/guides/1-7-upgrade-guide
--
-- 1.7.0-1.7.2 also duplicated Google accounts here. The 20260902100000 backfill
-- wrote local:oauth:google, but Google sign-ins carry https://accounts.google.com,
-- so the next sign-in of each existing Google user added a second row for the
-- same user. 1.7.3+ refuses a lookup that matches two rows, which would lock
-- those users out of Google sign-in. Keep the most recently updated row.

-- Duplicates spread across different users are a real conflict: stop here and
-- resolve them by hand rather than pick an owner.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Account"
    GROUP BY "providerId", "accountId"
    HAVING count(DISTINCT "userId") > 1
  ) THEN
    RAISE EXCEPTION 'Account rows share a (providerId, accountId) across different users; resolve them before migrating';
  END IF;
END $$;

DELETE FROM "Account" AS stale
USING "Account" AS kept
WHERE stale."providerId" = kept."providerId"
  AND stale."accountId" = kept."accountId"
  AND stale."userId" = kept."userId"
  AND (stale."updatedAt", stale."id") < (kept."updatedAt", kept."id");

-- DropIndex
DROP INDEX "Account_issuer_accountId_key";

-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "issuer" DROP NOT NULL;
