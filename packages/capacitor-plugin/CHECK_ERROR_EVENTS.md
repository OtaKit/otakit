# Update-check error events

`check_error` records failures before a bundle can be downloaded: manifest HTTP/transport errors, parsing failures, runtime mismatches, and signature rejection. A 404/204 or a successful check without an update is not an error. Cancellation and destroyed-owner work do not produce check-error events. Callers still receive the original error; reporting does not bypass verification or mutate update state.

The event carries a fresh `check-UUID` attempt ID, native SDK version, requested channel/runtime, lifecycle, and either the `check` or `signature` phase. Before verification succeeds, bundle/release identity is omitted rather than attributed to the currently running release. Runtime mismatch can include the already-verified manifest's release identity. Diagnostics use bounded reason codes such as `manifest_http_503`, `manifest_network_*`, `signature_expired`, `signature_unknown_key`, `signature_missing`, `signature_invalid`, and `runtime_mismatch`. Response bodies, URLs, signatures, and key IDs are not copied into check-error detail.

Ingest accepts missing bundle/release identity only for `check_error`. The console event timeline and MCP event filter expose the action. Existing download-error, rollback, and apply-through rates do not include it; there is no check-attempt denominator, so a check-error rate cannot yet be inferred.

Deploy the nullable context schema from `DEVICE_EVENT_CONTEXT.md`, then the ingest action support and console/API filters, then rebuilt native apps. Older ingest Workers reject unknown actions, so native rollout must follow backend support. The Insights error endpoint also needs the companion update to include check errors and native context. No production deployment is performed by this change.
