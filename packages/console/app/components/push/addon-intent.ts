// A visitor who signs up from the push landing page (login?addon=push) wants the
// push add-on. The intent survives the sign-in redirects in localStorage and is
// used once, the first time the dashboard loads for a workspace owner or admin.

const KEY = 'otakit:addon-intent';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function rememberPushIntent(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ addon: 'push', at: Date.now() }));
  } catch {
    // Storage is optional; the user can still turn push on in Settings.
  }
}

/** Returns true once if a recent push intent was stored, and forgets it. */
export function takePushIntent(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    localStorage.removeItem(KEY);
    const intent = JSON.parse(raw) as { addon?: string; at?: number };
    return intent.addon === 'push' && Date.now() - (intent.at ?? 0) < MAX_AGE_MS;
  } catch {
    return false;
  }
}
