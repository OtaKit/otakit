import type { Metadata } from 'next';

import { site } from '@/lib/site';

export type BlogPostMeta = {
  slug: string;
  title: string;
  /** Title used in <title> / OG. Defaults to `title` when omitted. */
  seoTitle?: string;
  description: string;
  category: 'Guides' | 'Comparison' | 'Compliance' | 'Migration';
  publishedAt: string;
  updatedAt?: string;
  readingTime: string;
  keywords: string[];
  order: number;
  featured?: boolean;
  relatedDocs: Array<{
    href: string;
    label: string;
  }>;
};

export const BLOG_POSTS: BlogPostMeta[] = [
  {
    slug: 'how-ota-works-for-capacitor-apps',
    title: 'How OTA updates work in Capacitor apps',
    seoTitle: 'How OTA Updates Work in Capacitor Apps',
    description:
      'What actually happens when a Capacitor app updates over the air: bundles, channels, signed manifests, delta downloads, safe activation, and automatic rollback.',
    category: 'Guides',
    publishedAt: '2026-07-02',
    readingTime: '9 min read',
    keywords: [
      'Capacitor OTA updates',
      'over-the-air updates',
      'Capacitor live updates',
      'how OTA works',
      'app update rollback',
      'update channels',
    ],
    order: 3,
    relatedDocs: [
      { href: '/docs/setup', label: 'Setup' },
      { href: '/docs/update-strategies', label: 'Update strategies' },
      { href: '/docs/security', label: 'Security' },
    ],
  },
  {
    slug: 'ota-policies-for-app-store-and-google-play',
    title: 'Are OTA updates allowed? App Store and Google Play rules, explained',
    seoTitle: 'Are OTA Updates Allowed? App Store & Google Play Rules Explained',
    description:
      'What Apple and Google actually say about over-the-air updates, quoted from the primary sources — and the practical line between compliant web-layer updates and rejection territory.',
    category: 'Compliance',
    publishedAt: '2026-07-02',
    readingTime: '9 min read',
    keywords: [
      'are OTA updates allowed',
      'App Store OTA policy',
      'Google Play OTA policy',
      'guideline 2.5.2',
      'Apple 3.3.1B interpreted code',
      'Capacitor app store compliance',
      'CodePush legal',
    ],
    order: 4,
    relatedDocs: [
      { href: '/docs/setup', label: 'Setup' },
      { href: '/docs/plugin', label: 'Plugin API' },
      { href: '/docs/security', label: 'Security' },
    ],
  },
  {
    slug: 'best-live-update-frameworks-for-capacitor-apps',
    title: 'The best live update tools for Capacitor apps in 2026',
    seoTitle: 'Best Live Update Tools for Capacitor Apps in 2026 (Compared)',
    description:
      'OtaKit vs Capgo vs Capawesome, compared honestly: pricing models, delta updates, encryption, rollback safety, and which one fits your Capacitor release process.',
    category: 'Comparison',
    publishedAt: '2026-07-02',
    readingTime: '10 min read',
    keywords: [
      'best Capacitor live update',
      'Capacitor OTA comparison',
      'OtaKit vs Capgo',
      'OtaKit vs Capawesome',
      'Capgo vs Capawesome',
      'CodePush alternative Capacitor',
    ],
    order: 5,
    relatedDocs: [
      { href: '/docs/channels', label: 'Channels & runtime version' },
      { href: '/docs/cli', label: 'CLI reference' },
      { href: '/docs/plugin', label: 'Plugin API' },
    ],
  },
  {
    slug: 'the-1-alternative-to-capgo-capawesome',
    title: 'The #1 alternative to Capgo and Capawesome',
    seoTitle: 'The Best Capgo Alternative for Capacitor Live Updates (2026)',
    description:
      'Why teams switch to OtaKit: pricing that ignores MAU entirely, CDN-direct delivery, delta updates, end-to-end encryption, and a fully MIT-licensed stack you can self-host.',
    category: 'Comparison',
    publishedAt: '2026-07-02',
    readingTime: '7 min read',
    keywords: [
      'Capgo alternative',
      'Capawesome alternative',
      'Capacitor live update pricing',
      'open source OTA updates',
      'self-hosted live updates',
    ],
    order: 6,
    relatedDocs: [
      { href: '/docs/setup', label: 'Setup' },
      { href: '/docs/channels', label: 'Channels & runtime version' },
      { href: '/docs/security', label: 'Security' },
    ],
  },
  {
    slug: 'vibe-code-an-app-from-your-mobile-with-claude-code-remote-and-otakit',
    title: 'Vibe code your app from your phone with Claude Code and OtaKit',
    seoTitle: 'Vibe Code an App From Your Phone With Claude Code + OTA Updates',
    description:
      'A real mobile-only dev loop: drive Claude Code from your phone, build in the cloud, and ship the result straight into your installed Capacitor app with an OTA update.',
    category: 'Guides',
    publishedAt: '2026-07-02',
    readingTime: '7 min read',
    keywords: [
      'Claude Code mobile',
      'vibe coding',
      'code from phone',
      'Capacitor OTA workflow',
      'Claude Code Capacitor',
      'ship app updates from phone',
    ],
    order: 1,
    featured: true,
    relatedDocs: [
      { href: '/docs/react', label: 'React guide' },
      { href: '/docs/guide', label: 'Next.js guide' },
      { href: '/docs/ci', label: 'CI automation' },
    ],
  },
  {
    slug: 'migrate-from-capgo-and-capawesome',
    title: 'How to migrate from Capgo or Capawesome to OtaKit',
    seoTitle: 'Migrate From Capgo or Capawesome to OtaKit: Complete Guide',
    description:
      'A production-grade migration guide: exact config and API translations from Capgo and Capawesome to OtaKit, what maps cleanly, and a safe cutover plan for your install base.',
    category: 'Migration',
    publishedAt: '2026-07-02',
    readingTime: '14 min read',
    keywords: [
      'migrate from Capgo',
      'migrate from Capawesome',
      'Capgo migration guide',
      'Capacitor updater migration',
      'switch OTA provider',
    ],
    order: 2,
    featured: true,
    relatedDocs: [
      { href: '/docs/setup', label: 'Setup' },
      { href: '/docs/cli', label: 'CLI reference' },
      { href: '/docs/update-strategies', label: 'Update strategies' },
    ],
  },
];

export function getBlogPosts() {
  return [...BLOG_POSTS].sort((a, b) => a.order - b.order);
}

export function getBlogPost(slug: string) {
  return BLOG_POSTS.find((post) => post.slug === slug);
}

/** Build full Next.js metadata (canonical, OG article, Twitter) for a post. */
export function blogPostMetadata(slug: string): Metadata {
  const post = getBlogPost(slug);
  if (!post) return {};

  const url = `${site.url}/blog/${post.slug}`;
  const title = post.seoTitle ?? post.title;

  return {
    title,
    description: post.description,
    keywords: post.keywords,
    alternates: { canonical: url },
    openGraph: {
      title,
      description: post.description,
      url,
      siteName: site.name,
      type: 'article',
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt ?? post.publishedAt,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: post.description,
    },
  };
}
