import type { MetadataRoute } from 'next';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { site } from '@/lib/site';

const APP_DIR = join(process.cwd(), 'app');
const PAGE_RE = /^page\.(tsx|ts|jsx|js|mdx)$/;

// Walk the App Router tree and collect every static, publicly routable path
// (any folder that holds a page file). Route groups — folders in parens — are
// unwrapped without adding a segment; dynamic ([param]), private (_foo),
// parallel/intercepting (@slot), and hidden (.foo) segments are skipped since
// they can't be enumerated for a sitemap. New pages appear automatically.
function collectRoutes(dir = APP_DIR, segments: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const routes: string[] = [];

  if (entries.some((e) => e.isFile() && PAGE_RE.test(e.name))) {
    routes.push(`/${segments.join('/')}`);
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (/^[_[@.]/.test(name)) continue;
    const isGroup = name.startsWith('(') && name.endsWith(')');
    routes.push(...collectRoutes(join(dir, name), isGroup ? segments : [...segments, name]));
  }

  return routes;
}

type Hint = { changeFrequency: 'weekly' | 'monthly' | 'yearly'; priority: number };

function hintFor(route: string): Hint {
  if (route === '/') return { changeFrequency: 'weekly', priority: 1 };
  if (route === '/docs') return { changeFrequency: 'weekly', priority: 0.8 };
  if (route.startsWith('/docs/')) return { changeFrequency: 'monthly', priority: 0.7 };
  if (route === '/blog') return { changeFrequency: 'weekly', priority: 0.8 };
  if (route.startsWith('/blog/')) return { changeFrequency: 'monthly', priority: 0.7 };
  if (route === '/policy' || route === '/terms') {
    return { changeFrequency: 'yearly', priority: 0.3 };
  }
  return { changeFrequency: 'monthly', priority: 0.6 };
}

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return collectRoutes()
    .sort()
    .map((route) => ({
      url: route === '/' ? site.url : `${site.url}${route}`,
      lastModified: now,
      ...hintFor(route),
    }));
}
