export type BlogPostMeta = {
  slug: string;
  title: string;
  description: string;
  category: 'Guides' | 'Comparison' | 'Compliance' | 'Migration';
  publishedAt: string;
  readingTime: string;
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
    title: 'How OTA works in general',
    description:
      'A practical explanation of how Capacitor OTA delivery works: manifests, bundles, rollout lanes, safe activation, and rollback.',
    category: 'Guides',
    publishedAt: '2026-04-18',
    readingTime: '8 min read',
    order: 3,
    relatedDocs: [
      { href: '/docs', label: 'Docs overview' },
      { href: '/docs/plugin', label: 'Plugin API' },
      { href: '/docs/security', label: 'Security' },
    ],
  },
  {
    slug: 'ota-policies-for-app-store-and-google-play',
    title: 'OTA policies for App Store and Google Play: what is legal and illegal',
    description:
      'A narrow, source-backed explanation of where OTA updates fit inside Apple and Google policy, and where teams get into trouble.',
    category: 'Compliance',
    publishedAt: '2026-04-18',
    readingTime: '9 min read',
    order: 4,
    relatedDocs: [
      { href: '/docs/setup', label: 'Setup' },
      { href: '/docs/plugin', label: 'Plugin API' },
      { href: '/docs/security', label: 'Security' },
    ],
  },
  {
    slug: 'best-live-update-frameworks-for-capacitor-apps',
    title: 'The best live update frameworks for Capacitor apps',
    description:
      'A practical short list for Capacitor teams comparing OtaKit, Capawesome, and Capgo in 2026.',
    category: 'Comparison',
    publishedAt: '2026-04-18',
    readingTime: '8 min read',
    order: 5,
    relatedDocs: [
      { href: '/docs/channels', label: 'Channels & runtime version' },
      { href: '/docs/cli', label: 'CLI reference' },
      { href: '/docs/plugin', label: 'Plugin API' },
    ],
  },
  {
    slug: 'the-1-alternative-to-capgo-capawesome',
    title: 'The #1 Alternative to Capgo / Capawesome',
    description:
      'Why OtaKit is the strongest fit for teams that want a focused, open-source Capacitor OTA stack instead of a broader but heavier toolchain.',
    category: 'Comparison',
    publishedAt: '2026-04-18',
    readingTime: '6 min read',
    order: 6,
    relatedDocs: [
      { href: '/docs/setup', label: 'Setup' },
      { href: '/docs/channels', label: 'Channels & runtime version' },
      { href: '/docs/security', label: 'Security' },
    ],
  },
  {
    slug: 'vibe-code-an-app-from-your-mobile-with-claude-code-remote-and-otakit',
    title: 'How to vibe code an app from your mobile using Claude Code Remote and OtaKit',
    description:
      'A mobile-first workflow for editing remotely, rebuilding the web layer, and shipping the result into a Capacitor app with OTA.',
    category: 'Guides',
    publishedAt: '2026-04-18',
    readingTime: '7 min read',
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
    title: 'Migrating from Capgo and Capawesome',
    description:
      'A production-grade migration guide for Capgo and Capawesome teams moving to OtaKit, including config translations, feature gaps, and a safe cutover plan.',
    category: 'Migration',
    publishedAt: '2026-04-18',
    readingTime: '14 min read',
    order: 2,
    featured: true,
    relatedDocs: [
      { href: '/docs/setup', label: 'Setup' },
      { href: '/docs/cli', label: 'CLI reference' },
      { href: '/docs/channels', label: 'Channels & runtime version' },
    ],
  },
];

export function getBlogPosts() {
  return [...BLOG_POSTS].sort((a, b) => a.order - b.order);
}

export function getBlogPost(slug: string) {
  return BLOG_POSTS.find((post) => post.slug === slug);
}
