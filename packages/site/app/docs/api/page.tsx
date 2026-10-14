import { Separator } from '@/components/ui/separator';
import { Pre } from '@/app/docs/CodeBlock';

export const metadata = {
  title: 'REST API',
  description: 'Public OtaKit REST API endpoints for app, bundle, and release automation.',
};

export default function ApiReferencePage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">REST API</h1>
      <P>
        All endpoints are under <Code>/api/v1</Code>. This page covers the public Bearer-token API
        for automation and server-side tooling. Requests and responses use JSON.
      </P>

      <Separator className="my-10" />

      <H2>Authentication</H2>
      <P>Public REST requests use a Bearer token:</P>
      <div className="mt-4 overflow-x-auto rounded-lg border text-xs">
        <div className="flex gap-3 px-4 py-2.5">
          <span className="w-36 shrink-0 font-medium">Bearer token</span>
          <span className="text-muted-foreground">
            CLI / server operations — upload, release, list. Use your organization secret key (
            <Code>otakit_sk_...</Code>) or a user access token from <Code>otakit login</Code>. The
            app ID is part of the URL path.
          </span>
        </div>
      </div>
      <Pre>{`# CLI / server operations
Authorization: Bearer otakit_sk_...`}</Pre>

      <Separator className="my-10" />

      <H2>Apps</H2>
      <Endpoint
        method="POST"
        path="/api/v1/apps"
        auth="Bearer"
        body={'{ "slug": "com.example.myapp" }'}
        response={`{
  "id": "uuid",
  "slug": "com.example.myapp",
  "createdAt": "ISO timestamp"
}`}
        description="Create a new app. The slug should match your Capacitor app identifier. Returns an appId for plugin and CLI usage."
      />

      <Separator className="my-10" />

      <H2>Bundles</H2>
      <div className="space-y-8">
        <Endpoint
          method="POST"
          path="/api/v1/apps/:appId/bundles/initiate"
          auth="Bearer"
          body={`{
  "version": "1.0.1",       // semver string
  "size": 1048576,          // bundle size in bytes
  "sha256": "64-char hex checksum of the zip file",
  "runtimeVersion": "2026.04" // optional compatibility lane
}`}
          response={`{
  "uploadId": "uuid",
  "presignedUrl": "https://...",
  "storageKey": "...",
  "expiresAt": "ISO timestamp"
}`}
          description="Start a bundle upload session. Returns a presigned PUT URL. Upload your zip file to this URL with Content-Type: application/zip."
        />
        <Endpoint
          method="POST"
          path="/api/v1/apps/:appId/bundles/finalize"
          auth="Bearer"
          body={`{
  "uploadId": "uuid"
}`}
          response={`{
  "id": "uuid",
  "version": "1.0.1",
  "sha256": "...",
  "size": 1048576,
  "runtimeVersion": "2026.04",
  "createdAt": "ISO timestamp"
}`}
          description="Finalize a bundle upload session. The server checks that the uploaded object exists and that its size matches the initiated session, then creates the bundle record from the stored session data."
        />
        <Endpoint
          method="GET"
          path="/api/v1/apps/:appId/bundles"
          auth="Bearer"
          queryParams="?limit=20&offset=0"
          response={`{
  "bundles": [{ id, version, sha256, size, createdAt }],
  "total": 42
}`}
          description="List bundles sorted by creation date (newest first)."
        />
        <Endpoint
          method="DELETE"
          path="/api/v1/apps/:appId/bundles/:bundleId"
          auth="Bearer"
          response={'{ "deleted": true, "id": "uuid" }'}
          description="Delete a bundle. Bundles that are part of a release history cannot be deleted."
        />
        <Endpoint
          method="GET"
          path="/api/v1/apps/:appId/bundles/:bundleId/diff"
          auth="Bearer"
          queryParams="?against=<bundleId> or ?channel=<name> (empty for the base channel)"
          response={`{
  "target": { "id": "…", "version": "1.4.2", "strategy": "deltas", "size": 4508876 },
  "base": { "id": "…", "version": "1.4.1", … },
  "baseSource": "channel",          // "against" | "channel" | "channel_previous" | "previous_upload"
  "baseChannel": "production",      // with ?channel= (null: base)
  "status": "ok",                   // or "target_unavailable" | "base_unavailable"
  "unavailableReason": null,        // "encrypted" | "unreadable"
  "comparable": true,               // false: zip vs deltas, compared by size only
  "summary": { "added": 3, "changed": 12, "removed": 1, "unchanged": 210,
               "totalBefore": 4299161, "totalAfter": 4508876,
               "downloadBytes": 38912 },
  "changes": [{ "path": "assets/hero.png", "status": "added",
                "sizeBefore": null, "sizeAfter": 3145728 }],
  "unlistedChanges": 0,
  "warnings": [{ "code": "env_file", "severity": "warning",
                 "message": "…", "paths": [".env.production"], "count": 1 }]
}`}
          description="Compare a bundle with another one. Without against or channel, the base is the previous upload of the same runtime version. Zip bundles are read from the archive's central directory and delta bundles from their file list; encrypted bundles cannot be inspected. channel compares with the bundle that channel runs for the target's runtime version (404 when the channel has no release for it); when the target is that bundle, it is compared with the release it replaced there (baseSource channel_previous). against and channel cannot be combined. downloadBytes is what a device on the base downloads: the whole archive for zip updates, at most the content it does not have yet for delta updates (it may already have more), or null when that depends on the device. changes lists up to 5,000 files; unlistedChanges counts the rest. Warning codes: env_file, git_directory and node_modules (warnings); source_map, dotfile, native_installer, large_new_file and size_increase (notes). Warnings help catch build mistakes; they are not a security scan."
        />
      </div>

      <Separator className="my-10" />

      <H2>Releases</H2>
      <div className="space-y-8">
        <Endpoint
          method="POST"
          path="/api/v1/apps/:appId/releases"
          auth="Bearer"
          body={`{
  "bundleId": "uuid",
  "channel": "staging",    // optional; omit or null for base channel
  "rolloutPercent": 10,    // optional; 1-100, default 100
  "replaceRollout": true,  // optional; cancel the active rollout first
  "notes": "Faster checkout." // optional; plain text, up to 2,000 characters
}`}
          response={`{
  "release": {
    "id": "uuid",
    "channel": null,
    "runtimeVersion": "2026.04",
    "bundleId": "uuid",
    "bundleVersion": "1.0.1",
    "rolloutPercent": 10,
    "promotedAt": "ISO timestamp"
  },
  "previousRelease": { ... } | null
}`}
          description="Release a bundle to the base channel or a named channel. The runtimeVersion comes from the bundle itself, so current resolution is per (channel, runtimeVersion). A rolloutPercent below 100 releases to that share of devices; it needs a previous release on the lane. While a rollout is active, another release returns 409 ROLLOUT_IN_PROGRESS unless replaceRollout is true."
        />
        <Endpoint
          method="PATCH"
          path="/api/v1/apps/:appId/releases/:releaseId/notes"
          auth="Bearer"
          body={'{ "notes": "Faster checkout.\\nPhoto upload fixed." }   // or null to remove'}
          response={'{ "release": { ..., "notes": "Faster checkout.\\nPhoto upload fixed." } }'}
          description="Change a release's notes. The release's channel is republished, so phones that update from now on get the new text; phones that already updated keep what they received."
        />
        <Endpoint
          method="PATCH"
          path="/api/v1/apps/:appId/releases/:releaseId/rollout"
          auth="Bearer"
          body={`{
  "percent": 50,           // 1-100; 100 completes the rollout
  "expectedPercent": 10    // optional; rejects the change if the rollout moved
}`}
          response={`{
  "release": { ..., "rolloutPercent": 50 },
  "previousPercent": 10,
  "publicationStatus": "published"
}`}
          description="Change the percentage of an active rollout. Only the current release of a lane can change while it is below 100%, and a completed rollout stays complete. To cancel a rollout, revert the release: POST /api/v1/apps/:appId/releases/:releaseId/revert, optionally with expectedRolloutPercent so the revert is refused if the rollout completed or changed meanwhile."
        />
        <Endpoint
          method="GET"
          path="/api/v1/apps/:appId/releases"
          auth="Bearer"
          queryParams="?channel=staging&limit=20&offset=0"
          response={`{
  "releases": [{
    id, channel, runtimeVersion, bundleId, bundleVersion, promotedAt
  }],
  "total": 12
}`}
          description="List release history sorted newest first. Omit channel to list every stream, or pass an empty channel value to query only the base channel."
        />
        <Endpoint
          method="GET"
          path="/api/v1/apps/:appId/releases/:releaseId/timeseries"
          auth="Bearer"
          queryParams="?range=24h|7d|30d&platform=ios|android&lane=1"
          response={`{
  "range": "24h",
  "granularity": "hour",           // "day" for 30d
  "unit": "events",
  "analyticsAvailable": true,
  "totals": { "downloads": 53, "applied": 48, "downloadErrors": 0,
              "rollbacks": 1, "rollbackSharePercent": 2.04 },
  "buckets": [{ "start": "2026-10-01T12:00:00.000Z", "downloads": 6,
                "applied": 5, "downloadErrors": 0, "rollbacks": 0,
                "appliedTotal": 5 }],
  "markers": [{ "at": "…", "type": "rollout", "label": "10% → 50%" }],
  "lane": { "channel": "production", "releases": [{ "id": "…",
            "bundleVersion": "1.4.1", "applied": [3, 2] }] }
}`}
          description="A release's client-reported events per UTC hour (24h, 7d) or day (30d), zero-filled, with totals, the rollback share (rollbacks ÷ (applies + rollbacks)) and markers for release, rollout steps and reverts. The range defaults to 24h for releases younger than two days and 7d otherwise. lane=1 adds applies per bucket for recent releases of the same channel and runtime. Counts are events, not unique devices; when analytics are unavailable, analyticsAvailable is false."
        />
      </div>

      <Separator className="my-10" />

      <H2>Preview links</H2>
      <div className="space-y-8">
        <Endpoint
          method="POST"
          path="/api/v1/apps/:appId/bundles/:bundleId/previews"
          auth="Bearer"
          body={`{
  "expiresIn": "24h",      // optional; 1h, 24h, 7d (default) or 30d
  "urlScheme": "myapp"     // optional; remembered for the app
}`}
          response={`{
  "preview": {
    "id": "uuid",
    "bundleId": "uuid",
    "bundleVersion": "1.0.1",
    "runtimeVersion": "2026.04",
    "expiresAt": "ISO timestamp",
    "url": "https://console.otakit.app/p/<token>",
    "qrUrl": "https://console.otakit.app/p/<token>/qr.png",
    "deepLink": "myapp://otakit-preview?token=<token>" | null
  }
}`}
          description="Create a preview link that opens the bundle in the installed app, without releasing it. Share url or qrUrl; deepLink is null until the app's URL scheme is known. An app can have 20 active links (409 PREVIEW_LIMIT_REACHED)."
        />
        <Endpoint
          method="GET"
          path="/api/v1/apps/:appId/previews"
          auth="Bearer"
          queryParams="?bundleId=uuid"
          response={`{
  "previews": [{ id, bundleId, bundleVersion, expiresAt, url, qrUrl, deepLink, ... }],
  "urlScheme": "myapp" | null
}`}
          description="List active preview links, newest first, optionally for one bundle."
        />
        <Endpoint
          method="DELETE"
          path="/api/v1/apps/:appId/previews/:previewId"
          auth="Bearer"
          response={'{ "status": "revoked" | "already_ended", "previewId": "uuid" }'}
          description="Revoke a preview link. Phones on it return to their release on their next update check."
        />
      </div>

      <Separator className="my-10" />

      <H2>Remote config</H2>
      <div className="space-y-8">
        <Endpoint
          method="GET"
          path="/api/v1/apps/:appId/config"
          auth="Bearer"
          queryParams="?channel=beta (omit or leave empty for the base channel)"
          response={`{
  "appId": "uuid",
  "channel": "beta",            // null for the base channel
  "version": 12,                // pass as expectedVersion; 0 = never configured
  "status": "live",             // "live" | "deleted" | "none"
  "values": { "checkoutEnabled": false },
  "message": "Partner outage",
  "updatedBy": "dev@acme.com",
  "updatedAt": "ISO timestamp",
  "usesBaseConfig": false,      // true: devices on this channel read the base config
  "publicationStatus": "published",   // "pending" while the CDN write is retried
  "fileUrl": "https://cdn.otakit.app/config/<appId>/beta/config.json"
}`}
          description="A channel's remote config, the values apps read with OtaKit.getConfig() (plugin 3.4+). A channel without its own config uses the base channel's."
        />
        <Endpoint
          method="PUT"
          path="/api/v1/apps/:appId/config"
          auth="Bearer"
          body={`{
  "channel": null,              // or a channel name
  "values": { "checkoutEnabled": false, "helpUrl": "https://example.com/help" },
  "expectedVersion": 12,
  "message": "Partner outage"   // optional, up to 200 characters
}`}
          response={`{ "config": { ...as GET }, "changed": true, "warnings": [{ "key", "reason", "message" }] }`}
          description="Replace a channel's config with a JSON object (up to 16 KB and 200 top-level keys; keys use letters, digits, '.', '_' and '-'). Publishes a new version unless the values are unchanged (changed: false). 409 STALE_CONFIG_VERSION when expectedVersion is not the latest version; 403 PLAN_REQUIRED for a named channel on Free. warnings flag keys and values that look like secrets; config is public."
        />
        <Endpoint
          method="PATCH"
          path="/api/v1/apps/:appId/config"
          auth="Bearer"
          body={`{
  "channel": null,
  "set": { "maintenanceBanner": "Back at 14:00" },
  "unset": ["helpUrl"],
  "expectedVersion": 12,
  "message": "Maintenance"
}`}
          response={`{ "config": { ... }, "changed": true, "warnings": [] }`}
          description="Set and remove top-level keys of the latest version. Same rules as PUT."
        />
        <Endpoint
          method="DELETE"
          path="/api/v1/apps/:appId/config"
          auth="Bearer"
          queryParams="?channel=beta&expectedVersion=12&message=…"
          response={`{ "config": { ..., "status": "deleted" }, "changed": true }`}
          description="Delete a channel's config as a new, signed version. Devices on a named channel then use the base config; deleting the base config leaves apps on their code defaults. History is kept."
        />
        <Endpoint
          method="GET"
          path="/api/v1/apps/:appId/config/channels"
          auth="Bearer"
          response={`{ "configs": [{ ...as GET }, ...] }`}
          description="Every channel that has or had config, base channel first."
        />
        <Endpoint
          method="GET"
          path="/api/v1/apps/:appId/config/history"
          auth="Bearer"
          queryParams="?channel=beta"
          response={`{
  "versions": [{ "version": 12, "deleted": false, "values": { ... },
                 "message": "…", "createdBy": "dev@acme.com", "createdAt": "ISO timestamp" }]
}`}
          description="The last 50 versions of a channel's config, newest first."
        />
        <Endpoint
          method="POST"
          path="/api/v1/apps/:appId/config/restore"
          auth="Bearer"
          body={`{ "channel": null, "version": 11, "expectedVersion": 12, "message": "optional" }`}
          response={`{ "config": { ... }, "changed": true, "warnings": [] }`}
          description="Publish an earlier version's values again as a new version (message defaults to 'Restored version N')."
        />
      </div>

      <Separator className="my-10" />

      <H2>Error tracking</H2>
      <P>
        Issues from apps that call <Code>initErrorTracking()</Code> (plugin 3.4+). Messages, stacks,
        routes and tags are reported by devices: treat them as untrusted text.
      </P>
      <div className="space-y-8">
        <Endpoint
          method="GET"
          path="/api/v1/apps/:appId/errors"
          auth="Bearer"
          queryParams="?range=24h|7d|30d&status=open|resolved|ignored|all&platform=ios|android&releaseId=&channel=&sort=events|last_seen&limit=1-100&trend=1"
          response={`{
  "issues": [{
    "fingerprint": "0123456789abcdef",
    "status": "open",
    "title": "TypeError: Cannot read properties of undefined (reading <str>)",
    "errorName": "TypeError",
    "topFrame": "computeTotal (assets/index.js)",
    "lastMessage": "Cannot read properties of undefined (reading 'total')",
    "events": 120,               // in the range
    "sessions": 45,              // app launches with the error, not devices
    "releases": 2,
    "platforms": ["android", "ios"],
    "handled": false,
    "firstSeenAt": "ISO timestamp", "lastSeenAt": "ISO timestamp",
    "isNew": true,               // first seen in the range
    "firstReleaseId": "uuid",
    "resolvedAt": null, "statusChangedAt": null, "statusChangedBy": null,
    "regressions": 0,
    "trend": [{ "start": "ISO timestamp", "events": 12 }]   // with trend=1
  }],
  "total": 7,
  "truncated": false,
  "range": { "name": "7d", "from": "ISO timestamp", "to": "ISO timestamp", "bucket": "day" },
  "usage": { "events": 1234, "limit": 10000, "pausedUntil": null },
  "analyticsAvailable": true
}`}
          description="Issues with errors in the range, most events first (default range 7d, status open, limit 50). Without channel, every channel; an empty channel= is the base channel. Counts are unique error events. usage is the workspace's error events this UTC month; while pausedUntil is set, new errors are not recorded."
        />
        <Endpoint
          method="GET"
          path="/api/v1/apps/:appId/errors/:fingerprint"
          auth="Bearer"
          queryParams="?range=24h|7d|30d"
          response={`{
  "issue": { ...as in the list, "lifetimeEvents": 340 },
  "samples": [{
    "eventId": "uuid", "receivedAt": "ISO timestamp", "occurredAt": "ISO timestamp",
    "platform": "ios", "osVersion": "18.2", "releaseId": "uuid", "bundleVersion": "1.4.2",
    "channel": "production", "runtimeVersion": "2026.10", "nativeBuild": "42",
    "sdkVersion": "3.4.0", "errorName": "TypeError", "message": "…", "stack": "…",
    "route": "/checkout", "handled": false, "mechanism": "onerror", "tags": {}
  }],
  "breakdown": {
    "release": [{ "value": "uuid", "label": "1.4.2", "events": 80 }],
    "platform": [...], "os_version": [...], "native_build": [...], "channel": [...], "route": [...]
  },
  "trend": [{ "start": "ISO timestamp", "events": 12 }],
  "range": { ... },
  "analyticsAvailable": true
}`}
          description="One issue: the latest 20 events in the range (newest first), the top 10 values per dimension, and events per hour (24h) or day. 404 ERROR_ISSUE_NOT_FOUND for an unknown fingerprint. Raw events are kept 30 days."
        />
        <Endpoint
          method="PATCH"
          path="/api/v1/apps/:appId/errors/:fingerprint"
          auth="Bearer"
          body={`{ "status": "resolved" }   // "open" | "resolved" | "ignored"`}
          response={`{
  "fingerprint": "0123456789abcdef",
  "title": "TypeError: …",
  "status": "resolved",
  "previousStatus": "open",
  "resolvedAt": "ISO timestamp",
  "statusChangedAt": "ISO timestamp",
  "statusChangedBy": "dev@acme.com"
}`}
          description="Resolve, ignore or reopen an issue. A resolved issue reopens when it happens again (errors.regression); an ignored one keeps counting but never alerts. Recorded in the audit log."
        />
        <Endpoint
          method="GET"
          path="/api/v1/apps/:appId/releases/:releaseId/errors"
          auth="Bearer"
          response={`{
  "release": { "releaseId": "uuid", "bundleVersion": "1.4.2", "events": 18, "issues": 3,
               "newIssues": 2, "applies": 10000, "perThousandApplies": 1.8 },
  "previous": { ...same, for the release it replaced } | null,
  "analyticsAvailable": true
}`}
          description="A release's error events, issues (and how many were first seen in it) and errors per 1,000 applies over 180 days, next to the release it replaced on its lane."
        />
      </div>
    </>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold tracking-tight">{children}</h2>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm text-muted-foreground">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{children}</code>;
}

function Endpoint({
  method,
  path,
  auth,
  body,
  headers,
  queryParams,
  response,
  description,
}: {
  method: string;
  path: string;
  auth: string;
  body?: string;
  headers?: string;
  queryParams?: string;
  response: string;
  description: string;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs font-semibold">
          {method}
        </span>
        <span className="break-all font-mono text-sm text-muted-foreground">{path}</span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        Auth: <span className="font-medium text-foreground">{auth}</span>
        {queryParams ? (
          <>
            {' '}
            &middot; Query: <span className="font-mono">{queryParams}</span>
          </>
        ) : null}
      </p>
      {headers ? (
        <>
          <p className="mt-3 text-xs font-medium">Headers</p>
          <Pre>{headers}</Pre>
        </>
      ) : null}
      {body ? (
        <>
          <p className="mt-3 text-xs font-medium">Request body</p>
          <Pre>{body}</Pre>
        </>
      ) : null}
      <p className="mt-3 text-xs font-medium">Response</p>
      <Pre>{response}</Pre>
    </div>
  );
}
