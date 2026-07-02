import Link from 'next/link';

import type { BlogPostMeta } from '@/lib/blog';

export function BlogCard({ post }: { post: BlogPostMeta }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group block bg-background p-6 transition-colors hover:bg-muted/30 sm:p-8"
    >
      <div className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">
        <span>{post.category}</span>
        <span className="h-1 w-1 rounded-full bg-border" />
        <span>{formatDate(post.publishedAt)}</span>
      </div>
      <h2 className="mt-4 max-w-2xl text-xl font-semibold tracking-tight group-hover:underline">
        {post.title}
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{post.description}</p>
      <div className="mt-5 text-sm text-muted-foreground">{post.readingTime}</div>
    </Link>
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
