import Link from 'next/link';

import { Separator } from '@/components/ui/separator';
import type { BlogPostMeta } from '@/lib/blog';
import { site } from '@/lib/site';

export function BlogArticle({ post, children }: { post: BlogPostMeta; children: React.ReactNode }) {
  const url = `${site.url}/blog/${post.slug}`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.description,
      datePublished: post.publishedAt,
      dateModified: post.updatedAt ?? post.publishedAt,
      url,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      author: { '@type': 'Organization', name: site.name, url: site.url },
      publisher: { '@type': 'Organization', name: site.name, url: site.url },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: site.url },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: `${site.url}/blog` },
        { '@type': 'ListItem', position: 3, name: post.title, item: url },
      ],
    },
  ];

  return (
    <article className="mx-auto max-w-3xl px-6 py-10 sm:px-10 sm:py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header>
        <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          <span>{post.category}</span>
          <span className="h-1 w-1 rounded-full bg-border" />
          <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
          <span className="h-1 w-1 rounded-full bg-border" />
          <span>{post.readingTime}</span>
        </div>
        <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">{post.title}</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
          {post.description}
        </p>
        {post.updatedAt ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Last updated: {formatDate(post.updatedAt)}
          </p>
        ) : null}
      </header>

      <Separator className="my-8" />

      <div className="[&>*+*]:mt-4 text-sm leading-7 text-muted-foreground [&_h2]:mt-9 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_h3]:mt-7 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:tracking-tight [&_h3]:text-foreground [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_p]:leading-7 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_strong]:font-semibold [&_strong]:text-foreground">
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

export function A({ href, children }: { href: string; children: React.ReactNode }) {
  const external = href.startsWith('http');
  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-foreground underline underline-offset-4 hover:opacity-80"
      >
        {children}
      </a>
    );
  }
  return (
    <Link
      href={href}
      className="font-medium text-foreground underline underline-offset-4 hover:opacity-80"
    >
      {children}
    </Link>
  );
}

export function DataTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="mt-4 overflow-x-auto border border-border">
      <table className="min-w-full border-collapse text-left text-sm text-muted-foreground">
        <thead className="bg-muted/50 text-foreground">
          <tr>
            {headers.map((header) => (
              <th key={header} className="border-b border-border px-4 py-3 font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_tr:last-child_td]:border-b-0">
          {rows.map((row, index) => (
            <tr key={`${row[0]}-${index}`} className="align-top">
              {row.map((cell, cellIndex) => (
                <td key={`${row[0]}-${cellIndex}`} className="border-b border-border px-4 py-3">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
