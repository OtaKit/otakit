-- Repricing: collapse the three-tier (starter/pro/scale) catalog into
-- free / pro / enterprise. Rename in place so existing rows keep their plan:
--   starter -> free        (now 10k downloads/mo)
--   scale   -> enterprise  (custom, contact-sales)
-- "pro" keeps its name but is repriced to $50 / 1M downloads in Polar.
ALTER TYPE "PlanKey" RENAME VALUE 'starter' TO 'free';
ALTER TYPE "PlanKey" RENAME VALUE 'scale' TO 'enterprise';

-- Postgres carries the column default through the rename, but set it
-- explicitly so the schema and database agree.
ALTER TABLE "Organization" ALTER COLUMN "planKey" SET DEFAULT 'free';
