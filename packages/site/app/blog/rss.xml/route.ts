import { getBlogPosts } from '@/lib/blog';
import { site } from '@/lib/site';

export const dynamic = 'force-static';

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

const rfc822 = (date: string) => new Date(`${date}T12:00:00Z`).toUTCString();

/**
 * Every blog post, newest first. Feed readers, dev.to's RSS import (which can mark
 * these URLs canonical), daily.dev and newsletters pick posts up from here.
 */
export function GET() {
  const posts = getBlogPosts().sort(
    (left, right) => right.publishedAt.localeCompare(left.publishedAt) || right.order - left.order,
  );

  const items = posts.map((post) => {
    const link = `${site.url}/blog/${post.slug}`;
    return [
      '    <item>',
      `      <title>${escapeXml(post.title)}</title>`,
      `      <link>${escapeXml(link)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
      `      <pubDate>${rfc822(post.publishedAt)}</pubDate>`,
      `      <category>${escapeXml(post.category)}</category>`,
      `      <description>${escapeXml(post.description)}</description>`,
      '    </item>',
    ].join('\n');
  });

  const latest = posts
    .map((post) => post.updatedAt ?? post.publishedAt)
    .sort()
    .at(-1);

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>OtaKit Blog</title>',
    `    <link>${site.url}/blog</link>`,
    `    <atom:link href="${site.url}/blog/rss.xml" rel="self" type="application/rss+xml" />`,
    '    <description>Guides on Capacitor live updates: release safety, store policy, tool comparisons and migrations.</description>',
    '    <language>en</language>',
    ...(latest ? [`    <lastBuildDate>${rfc822(latest)}</lastBuildDate>`] : []),
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
