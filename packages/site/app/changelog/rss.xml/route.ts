import { changelogEntries, stripInlineCode, TYPE_LABELS, versionLabels } from '@/lib/changelog';
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

export function GET() {
  const items = changelogEntries.map((entry) => {
    const link = `${site.url}/changelog#${entry.slug}`;
    const versions = versionLabels(entry);
    const description = [
      stripInlineCode(entry.summary),
      ...(entry.highlights ?? []).map((item) => `• ${stripInlineCode(item)}`),
      versions.length > 0 ? versions.join(' · ') : '',
    ]
      .filter(Boolean)
      .join('\n');
    return [
      '    <item>',
      `      <title>${escapeXml(entry.title)}</title>`,
      `      <link>${escapeXml(link)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
      `      <pubDate>${new Date(`${entry.date}T12:00:00Z`).toUTCString()}</pubDate>`,
      `      <category>${escapeXml(TYPE_LABELS[entry.type])}</category>`,
      `      <description>${escapeXml(description)}</description>`,
      '    </item>',
    ].join('\n');
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>OtaKit Changelog</title>',
    `    <link>${site.url}/changelog</link>`,
    `    <atom:link href="${site.url}/changelog/rss.xml" rel="self" type="application/rss+xml" />`,
    '    <description>New features, improvements and fixes in OtaKit.</description>',
    '    <language>en</language>',
    `    <lastBuildDate>${new Date(`${changelogEntries[0].date}T12:00:00Z`).toUTCString()}</lastBuildDate>`,
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
