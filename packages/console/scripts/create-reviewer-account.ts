/**
 * Create a password-login account for an app-directory reviewer.
 *
 * From packages/console, with the target deployment's DATABASE_URL (the direct
 * host, not the pooler), BETTER_AUTH_SECRET and BETTER_AUTH_URL:
 *
 *   pnpm dlx tsx scripts/create-reviewer-account.ts review@example.com
 *
 * Prints the generated password once. The console needs OTAKIT_REVIEWER_LOGIN=true
 * for the reviewer form to appear. Re-running for an existing email changes nothing.
 */
import { createReviewerAccount } from '../lib/reviewer-account';

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: create-reviewer-account.ts <email>');
    process.exit(1);
  }
  const result = await createReviewerAccount(email);
  console.log(
    JSON.stringify(
      { ...result, password: result.password ?? '(unchanged: the account already existed)' },
      null,
      2,
    ),
  );
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
