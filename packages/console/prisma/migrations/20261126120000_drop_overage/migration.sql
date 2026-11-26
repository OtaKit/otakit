-- Pro additional usage (overage billed at the end of the cycle) is replaced by
-- extra download packs, so these columns are unused. Apply after the code that
-- no longer reads them is deployed: the previous release still selects
-- "overageEnabled".
-- AlterTable
ALTER TABLE "Organization" DROP COLUMN "overageEnabled",
DROP COLUMN "polarReportedCount";

