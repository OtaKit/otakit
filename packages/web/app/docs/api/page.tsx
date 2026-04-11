import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'REST API — OtaKit Docs',
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
Authorization: Bearer otakit_sk_...   # or OTAKIT_ACCESS_TOKEN`}</Pre>

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
  "channel": "staging"   // optional; omit or null for base channel
}`}
          response={`{
  "release": {
    "id": "uuid",
    "channel": null,
    "runtimeVersion": "2026.04",
    "bundleId": "uuid",
    "bundleVersion": "1.0.1",
    "promotedAt": "ISO timestamp"
  },
  "previousRelease": { ... } | null
}`}
          description="Release a bundle to the base channel or a named channel. The runtimeVersion comes from the bundle itself, so current resolution is per (channel, runtimeVersion)."
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

function Pre({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-lg border bg-muted px-4 py-3 font-mono text-xs leading-6 text-muted-foreground">
      {children}
    </pre>
  );
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
