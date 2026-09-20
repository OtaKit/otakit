# Native update state persistence

The current, fallback, and staged bundle IDs and last failure are stored together in
`otakit-state.json` in the app's private storage. Existing preference values are read
until the first successful state-file write. After that, the state file is authoritative.
Channel overrides and runtime-resolution preferences retain their existing storage.

Activation writes trial metadata before publishing the new current pointer. Rollback
commits the restored pointers and failed-bundle record in one replacement. Readiness
persists success and the new fallback before authorizing cleanup or emitting `applied`.
Android metadata also uses `AtomicFile`, with a readback check because its finish API
can log some filesystem failures instead of throwing. iOS uses atomic file replacement.

Metadata and the pointer file are separate writes. If a readiness metadata write succeeds
but the pointer commit fails, the healthy fallback remains intact and a repeated readiness
call can finish the transition. If the process exits first, startup retains the successful
current bundle and the old fallback; it does not invent a missing `applied` event.
These changes do not promise event delivery or a filesystem-wide transaction.

An unreadable state file blocks mutation and cleanup. Startup falls back to the native
builtin bundle, preserving downloaded files for recovery. Failed timeout rollback writes
are retried without deleting the trial or its healthy fallback. Persistent storage failure
therefore requires storage to become writable before a saved rollback can complete.

Native tests deny writes to metadata directories and to the state directory, reopen the
store after partial transitions, exercise retries and legacy migration, and verify that
corrupt state cannot authorize deletion. These checks cover process interruption and
observable filesystem errors, not physical-device power-loss guarantees.
