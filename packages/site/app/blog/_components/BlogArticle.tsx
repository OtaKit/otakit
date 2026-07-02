import Link from 'next/link';

import { Separator } from '@/components/ui/separator';
import type { BlogPostMeta } from '@/lib/blog';

export function BlogArticle({
  post,
  lastReviewed,
  children,
}: {
  post: BlogPostMeta;
  lastReviewed?: string;
  children: React.ReactNode;
}) {
  return (
    <article className="mx-auto max-w-3xl px-6 py-10 sm:px-10 sm:py-12">
      <header>
        <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          <span>{post.category}</span>
          <span className="h-1 w-1 rounded-full bg-border" />
          <span>{formatDate(post.publishedAt)}</span>
          <span className="h-1 w-1 rounded-full bg-border" />
          <span>{post.readingTime}</span>
        </div>
        <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">{post.title}</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
          {post.description}
        </p>
        {lastReviewed ? (
          <p className="mt-4 text-sm text-muted-foreground">Last reviewed: {lastReviewed}</p>
        ) : null}
      </header>

      <Separator className="my-8" />

      <div className="[&>*+*]:mt-4 text-sm leading-7 text-muted-foreground [&_h2]:mt-9 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-7 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:tracking-tight [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_p]:leading-7 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_strong]:font-semibold [&_strong]:text-foreground">
        {children}
      </div>

      <Separator className="my-8" />

      <section>
        <h2 className="text-lg font-semibold tracking-tight">Related docs</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          {post.relatedDocs.map((doc) => (
            <Link
              key={doc.href}
              href={doc.href}
              className="rounded-full border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {doc.label}
            </Link>
          ))}
        </div>
      </section>
    </article>
  );
}

export function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-border bg-muted/40 px-5 py-4 text-sm leading-7 text-foreground">
      {children}
    </div>
  );
}

export function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">{children}</code>;
}

export function Pre({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-border bg-muted px-4 py-3 text-xs leading-6 text-foreground">
      {children}
    </pre>
  );
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
