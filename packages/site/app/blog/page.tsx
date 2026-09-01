import type { Metadata } from 'next';

import { BlogCard } from './_components/BlogCard';
import { getBlogPosts } from '@/lib/blog';
import { site } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Blog — OTA updates, live update comparisons & store policy',
  description:
    'Practical guides on Capacitor OTA updates: AI agent workflows, release safety, store policy, tool comparisons, and production migration guides.',
  alternates: { canonical: `${site.url}/blog` },
  openGraph: {
    title: 'OtaKit Blog — Capacitor OTA updates, explained',
    description:
      'Practical guides on Capacitor OTA updates: AI agent workflows, release safety, store policy, comparisons, and migrations.',
    url: `${site.url}/blog`,
    siteName: site.name,
    type: 'website',
  },
};

export default function BlogIndexPage() {
  const posts = getBlogPosts();

  return (
    <div>
      <section className="relative overflow-hidden border-b border-border bg-muted/20 px-6 py-12 sm:px-10 sm:py-16">
        <div
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(var(--color-border)_1px,transparent_1px),linear-gradient(90deg,var(--color-border)_1px,transparent_1px)] bg-[size:36px_36px] opacity-35"
          aria-hidden="true"
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-background to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent" />
        <div className="relative">
          <p className="text-sm font-medium uppercase tracking-[0.25em] text-muted-foreground">
            OtaKit Blog
          </p>
          <h1 className="mt-4 max-w-4xl text-4xl font-bold tracking-tight sm:text-5xl">
            Capacitor OTA updates, explained properly
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            Agent-driven release workflows, how live updates work, what Apple and Google actually
            allow, honest comparisons, and battle-tested migration guides.
          </p>
        </div>
      </section>

      <section>
        <div className="grid gap-px bg-border">
          {posts.map((post) => (
            <BlogCard key={post.slug} post={post} />
          ))}
        </div>
      </section>
    </div>
  );
}
