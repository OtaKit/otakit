export type DocumentationPage = {
  title: string;
  label: string;
  path: string;
  description: string;
  markdown: string;
};

export type DocumentationSearchResult = {
  title: string;
  path: string;
  heading: string | null;
  excerpt: string;
  score: number;
};

function queryTokens(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{N}._-]+/u)
        .map((token) => token.trim())
        .filter((token) => token.length > 1),
    ),
  );
}

function findExcerpt(
  page: DocumentationPage,
  tokens: string[],
): {
  heading: string | null;
  excerpt: string;
} {
  const lines = page.markdown.split('\n');
  let bestLine = 0;
  let bestMatches = -1;
  let heading: string | null = null;
  let activeHeading: string | null = null;

  for (const [index, line] of lines.entries()) {
    if (/^#{2,6}\s/.test(line)) {
      activeHeading = line.replace(/^#{2,6}\s+/, '').trim();
    }
    const normalized = line.toLocaleLowerCase();
    const matches = tokens.filter((token) => normalized.includes(token)).length;
    if (matches > bestMatches) {
      bestLine = index;
      bestMatches = matches;
      heading = activeHeading;
    }
  }

  return {
    heading,
    excerpt: lines
      .slice(Math.max(0, bestLine - 1), Math.min(lines.length, bestLine + 4))
      .join(' ')
      .replace(/\s+/g, ' ')
      .slice(0, 500),
  };
}

export function searchDocumentation(
  pages: readonly DocumentationPage[],
  query: string,
  limit = 5,
): DocumentationSearchResult[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) {
    return [];
  }

  return pages
    .map((page) => {
      const title = `${page.title} ${page.label} ${page.description}`.toLocaleLowerCase();
      const body = page.markdown.toLocaleLowerCase();
      const score = tokens.reduce((total, token) => {
        const titleMatches = title.split(token).length - 1;
        const bodyMatches = body.split(token).length - 1;
        return total + titleMatches * 10 + Math.min(bodyMatches, 20);
      }, 0);
      return { page, score, ...findExcerpt(page, tokens) };
    })
    .filter((result) => result.score > 0)
    .sort(
      (left, right) => right.score - left.score || left.page.path.localeCompare(right.page.path),
    )
    .slice(0, Math.max(1, Math.min(limit, 8)))
    .map(({ page, score, heading, excerpt }) => ({
      title: page.title,
      path: page.path,
      heading,
      excerpt,
      score,
    }));
}

export function readDocumentationPage(
  pages: readonly DocumentationPage[],
  path: string,
  cursor?: string,
  chunkSize = 6000,
): { page: Omit<DocumentationPage, 'markdown'>; markdown: string; nextCursor: string | null } {
  const page = pages.find((entry) => entry.path === path);
  if (!page) {
    throw new Error(`Unknown OtaKit documentation path: ${path}`);
  }
  const offset = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > page.markdown.length) {
    throw new Error('Invalid documentation cursor');
  }
  const markdown = page.markdown.slice(offset, offset + chunkSize);
  const nextOffset = offset + markdown.length;
  return {
    page: {
      title: page.title,
      label: page.label,
      path: page.path,
      description: page.description,
    },
    markdown,
    nextCursor: nextOffset < page.markdown.length ? String(nextOffset) : null,
  };
}
