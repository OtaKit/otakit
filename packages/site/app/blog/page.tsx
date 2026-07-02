import type { Metadata } from 'next';

import { BlogCard } from './_components/BlogCard';
import { getBlogPosts } from '@/lib/blog';

export const metadata: Metadata = {
  title: 'OtaKit — Blog',
  description:
    'Guides, comparisons, compliance notes, and migration advice for OTA updates in Capacitor apps.',
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
            Practical writing about Capacitor OTA, rollout safety, and store policy
          </h1>
        </div>
      </section>

      <section>
        <div className="border-b border-border px-6 py-8 sm:px-10">
          <h2 className="text-2xl font-semibold tracking-tight">Posts</h2>
        </div>
        <div className="grid gap-px bg-border">
          {posts.map((post) => (
            <BlogCard key={post.slug} post={post} />
          ))}
        </div>
      </section>
    </div>
  );
}
