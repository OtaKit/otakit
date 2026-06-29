import type { MetadataRoute } from 'next';

// The console is an authenticated dashboard — keep it out of search indexes
// entirely. Public content (landing, docs, legal) lives on the marketing site.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: '/',
    },
  };
}
