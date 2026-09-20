# Foreground readiness deadline

`appReadyTimeout` is a cumulative foreground budget, with the existing 10-second
default. A trial gets the full budget if it begins in the background. Pausing saves
the remaining time; resuming does not reset it. Repeated lifecycle notifications
cannot extend the budget. The deadline uses a monotonic clock and rejects cancelled
or superseded callbacks, including callbacks already queued when the app pauses.

On iOS, `didBecomeActive` and `willResignActive` drive the deadline independently of
`resumePolicy`. On Android, the plugin's resume/pause callbacks do the same, and
destruction cancels the scheduled deadline. Update-check policies still determine
whether a resume starts a check; they do not control the readiness budget.

A process exit before readiness continues to use the existing startup rollback rule.
This change does not prove that all production `notify_timeout` events were caused by
backgrounding: a foreground app can still exceed its budget or omit readiness.

Tests advance an injected monotonic clock, deliberately deliver stale callbacks, and
exercise the real coordinator rollback through iOS lifecycle notifications and Android
plugin lifecycle callbacks. They verify the fallback survives background time and is
restored only after the remaining foreground budget expires.
