# Download retries

ZIP and delta-object GETs share a bounded retry policy on Android and iOS:

- At most three attempts, each using a fresh request and temporary file. Partial bytes are never appended or installed.
- Retry transport interruptions/timeouts and HTTP 408, 425, 429, 500, 502, 503, and 504.
- Exponential backoff starts at one second with 50–150% jitter. `Retry-After` seconds and HTTP dates can extend the delay. A server delay over 30 seconds ends this download call instead of retrying earlier than requested; a later update check can try again.
- Certificate validation, cancellation, disk failures, permanent HTTP errors, and integrity failures are terminal. Manifest, signature, and SHA verification remain outside transport retries.
- Progress can restart for a new attempt. HTTP caches are bypassed on iOS and identity content encoding is requested on both platforms.

The retry policy does not resume byte ranges and does not guarantee delivery while an app is suspended. The update-owner lifecycle guard still prevents a completed download from being staged by a destroyed bridge.

Tests cover interrupted bodies, fresh-file ownership, exhaustion, permanent failures, server delays, cancellation, and disk errors. iOS tests use real loopback HTTP responses; Android tests inject connections and failures at the stream boundary.
