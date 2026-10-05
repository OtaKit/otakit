/**
 * Password sign-in for app-directory reviewers (OpenAI, Anthropic). Reviewers
 * cannot receive email codes, so their accounts are created ahead of time
 * (scripts/create-reviewer-account.ts); nobody can sign up with a password.
 */
export function isReviewerLoginEnabled(): boolean {
  return process.env.OTAKIT_REVIEWER_LOGIN === 'true';
}
