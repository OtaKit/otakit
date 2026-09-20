# Device event delivery

Native events are persisted in an atomic snapshot in private application storage before the HTTP request starts. The queue is independent of the WebView and resumes at plugin load and foreground entry, including when the resume update policy is off. Android excludes its directory from backup; iOS marks the directory excluded from backup.

Each event retains its original event ID, timestamp, endpoint, app ID, and body across attempts and process restarts. A successful HTTP response removes the event. Offline errors, response loss, HTTP 408/425/429, and server failures retry with exponential backoff (five-second initial base, one-hour maximum base, 50–150% jitter). `Retry-After` seconds and dates extend this delay, including across restarts. Redirects and other permanent HTTP client errors are discarded rather than retried forever. No redirect can forward the app header to another host.

Limits are 256 events, seven days of retention, and 8 KiB per event. Overflow evicts the oldest event. An event with a server delay beyond its retention expires without an early retry. Corrupt JSON is discarded with a native diagnostic so later events can proceed. Disk failures never fail an update; enqueue failure can still lose that event, and persistence failure during acknowledgement may cause a later duplicate. Storage failures back off instead of spinning.

This is at-least-once delivery within those limits, not a transaction with the update state machine. A crash between committing update state and creating the event can still omit an event. Suspended or terminated apps cannot continue the delivery loop; it resumes when the process runs again. No background task entitlement or scheduler is added.

The existing Tinybird daily aggregate and Insights health/error endpoints use unique event IDs. Raw rows may contain retries after a lost acknowledgement; ad hoc queries must deduplicate by `event_id` too. Preserve this rule when adding metrics.

Tests reopen the on-disk queue after offline failure and acknowledgement; check permanent rejection, rate limiting, queue limits, expiration, and write failure; and exercise the native HTTP delivery loops through failure and success. Android persistence runs against API 28 and 34 implementations of `AtomicFile`.
