#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

const DOCS = [
  { label: 'Overview', route: '/docs', file: 'packages/site/app/docs/page.tsx' },
  { label: 'Setup', route: '/docs/setup', file: 'packages/site/app/docs/setup/page.tsx' },
  { label: 'CLI Reference', route: '/docs/cli', file: 'packages/site/app/docs/cli/page.tsx' },
  { label: 'Plugin API', route: '/docs/plugin', file: 'packages/site/app/docs/plugin/page.tsx' },
  { label: 'REST API', route: '/docs/api', file: 'packages/site/app/docs/api/page.tsx' },
  { label: 'Next.js Guide', route: '/docs/guide', file: 'packages/site/app/docs/guide/page.tsx' },
  { label: 'React Guide', route: '/docs/react', file: 'packages/site/app/docs/react/page.tsx' },
  { label: 'Channels', route: '/docs/channels', file: 'packages/site/app/docs/channels/page.tsx' },
  { label: 'Rollouts', route: '/docs/rollouts', file: 'packages/site/app/docs/rollouts/page.tsx' },
  { label: 'Previews', route: '/docs/previews', file: 'packages/site/app/docs/previews/page.tsx' },
  {
    label: 'Update Strategies',
    route: '/docs/update-strategies',
    file: 'packages/site/app/docs/update-strategies/page.tsx',
  },
  {
    label: 'Events & Listeners',
    route: '/docs/events',
    file: 'packages/site/app/docs/events/page.tsx',
  },
  {
    label: 'Webhooks & Alerts',
    route: '/docs/webhooks',
    file: 'packages/site/app/docs/webhooks/page.tsx',
  },
  {
    label: 'Push Notifications',
    route: '/docs/push',
    file: 'packages/site/app/docs/push/page.tsx',
  },
  { label: 'CI Automation', route: '/docs/ci', file: 'packages/site/app/docs/ci/page.tsx' },
  {
    label: 'MCP & Agent Skills',
    route: '/docs/agents',
    file: 'packages/site/app/docs/agents/page.tsx',
  },
  { label: 'Security', route: '/docs/security', file: 'packages/site/app/docs/security/page.tsx' },
  {
    label: 'Self-hosting',
    route: '/docs/self-host',
    file: 'packages/site/app/docs/self-host/page.tsx',
  },
];

const OUTPUTS = [path.join(ROOT, 'llms.txt'), path.join(ROOT, 'packages/site/public/llms.txt')];

const ENTITY_MAP = new Map([
  ['&apos;', "'"],
  ['&quot;', '"'],
  ['&gt;', '>'],
  ['&lt;', '<'],
  ['&amp;', '&'],
  ['&middot;', '·'],
]);

const CHANGELOG_FILE = 'packages/site/lib/changelog.json';
const CHANGELOG_TYPES = new Set(['launch', 'feature', 'improvement', 'fix']);
const PACKAGE_LABELS = { plugin: 'Plugin', cli: 'CLI', push: 'Push SDK' };

// JSX expression identifiers that leak into extracted text as-is.
const CONSTANT_MAP = new Map([['SUPPORT_EMAIL', 'support@otakit.app']]);

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const sections = [];

  for (const page of DOCS) {
    sections.push(await renderPage(page));
  }

  const changelog = await readChangelog();
  const output = buildDocument(sections, changelog);

  for (const target of OUTPUTS) await emit(target, output);
}

async function emit(target, content) {
  if (CHECK) {
    const current = await readFile(target, 'utf8').catch(() => null);
    if (current !== content) {
      throw new Error(`${path.relative(ROOT, target)} is stale; run pnpm docs:llms`);
    }
    return;
  }

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

async function renderPage(page) {
  const absolutePath = path.join(ROOT, page.file);
  const sourceText = await readFile(absolutePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    absolutePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  const metadata = findMetadata(sourceFile);
  const jsx = findDefaultPageJsx(sourceFile);
  const lines = [];
  const state = { skippedPageHeading: false };

  renderBlock(jsx, lines, state);

  return {
    label: page.label,
    route: page.route,
    title: metadata.title ?? page.label,
    description: metadata.description ?? '',
    content: cleanLines(lines),
  };
}

async function readChangelog() {
  const data = JSON.parse(await readFile(path.join(ROOT, CHANGELOG_FILE), 'utf8'));
  validateChangelog(data);
  return data;
}

/** The changelog page, its RSS feed and this file all read changelog.json; catch mistakes in CI. */
function validateChangelog({ entries, packages }) {
  const fail = (message) => {
    throw new Error(`${CHANGELOG_FILE}: ${message}`);
  };
  const isDate = (value) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') && !Number.isNaN(Date.parse(value));
  const isVersion = (value) => /^\d+\.\d+\.\d+$/.test(value ?? '');
  if (!Array.isArray(entries) || entries.length === 0) fail('entries must be a non-empty array');
  if (!Array.isArray(packages) || packages.length === 0) fail('packages must be a non-empty array');

  const slugs = new Set();
  const newestEntryVersion = {};
  let previousDate = '9999-12-31';
  for (const entry of entries) {
    const where = `entry "${entry?.slug ?? entry?.title ?? '?'}"`;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug ?? ''))
      fail(`${where}: slug must be kebab-case`);
    if (slugs.has(entry.slug)) fail(`${where}: duplicate slug`);
    slugs.add(entry.slug);
    if (!isDate(entry.date)) fail(`${where}: date must be YYYY-MM-DD`);
    if (entry.date > previousDate) fail(`${where}: entries must be sorted newest first`);
    previousDate = entry.date;
    if (!CHANGELOG_TYPES.has(entry.type)) fail(`${where}: unknown type "${entry.type}"`);
    for (const key of ['title', 'summary']) {
      if (typeof entry[key] !== 'string' || entry[key].trim() === '')
        fail(`${where}: ${key} is required`);
    }
    if (!Array.isArray(entry.areas) || entry.areas.length === 0)
      fail(`${where}: areas is required`);
    for (const [key, version] of Object.entries(entry.versions ?? {})) {
      if (!(key in PACKAGE_LABELS) || !isVersion(version))
        fail(`${where}: bad version ${key} ${version}`);
      if (!newestEntryVersion[key] || compareVersions(version, newestEntryVersion[key]) > 0) {
        newestEntryVersion[key] = version;
      }
    }
    const texts = [
      entry.summary,
      ...(entry.highlights ?? []),
      entry.requires ?? '',
      ...(entry.upgrade ?? []),
    ];
    if (texts.some((text) => (text.match(/`/g) ?? []).length % 2 !== 0)) {
      fail(`${where}: unbalanced backticks`);
    }
    for (const link of entry.links ?? []) {
      if (!link.label || !/^(\/|https:\/\/)/.test(link.href ?? '')) {
        fail(`${where}: links need a label and a "/" or "https://" href`);
      }
    }
  }

  for (const pkg of packages) {
    if (!(pkg.key in PACKAGE_LABELS) || !pkg.name || !pkg.label || !pkg.install) {
      fail(`package "${pkg.key}": key, name, label and install are required`);
    }
    if (!isVersion(pkg.version) || !isDate(pkg.date))
      fail(`package "${pkg.key}": bad version or date`);
    const newest = newestEntryVersion[pkg.key];
    if (newest && compareVersions(newest, pkg.version) > 0) {
      fail(`package "${pkg.key}" shows ${pkg.version}, but an entry mentions ${newest}`);
    }
  }
}

function compareVersions(a, b) {
  const [x, y] = [a, b].map((value) => value.split('.').map(Number));
  for (let index = 0; index < 3; index += 1) {
    if (x[index] !== y[index]) return x[index] - y[index];
  }
  return 0;
}

function renderChangelog({ entries, packages }) {
  const lines = [
    '',
    '## Changelog',
    '',
    'Route: /changelog',
    '',
    'New features, improvements and fixes, newest first. Plugin features need the plugin version shown.',
    '',
    `Latest versions: ${packages.map((pkg) => `${pkg.name} ${pkg.version} (${pkg.date})`).join(', ')}.`,
  ];
  for (const entry of entries) {
    const versions = Object.entries(entry.versions ?? {}).map(
      ([key, version]) => `${PACKAGE_LABELS[key]} ${version}`,
    );
    lines.push(
      '',
      `### ${entry.title} (${[entry.date, ...versions].join(', ')})`,
      '',
      entry.summary,
    );
    if (entry.highlights?.length) lines.push('', ...entry.highlights.map((item) => `- ${item}`));
    if (entry.code) lines.push('', '```', entry.code, '```');
    if (entry.requires) lines.push('', `Requires: ${entry.requires}`);
    if (entry.upgrade?.length) {
      lines.push('', 'Upgrade notes:', ...entry.upgrade.map((item) => `- ${item}`));
    }
    if (entry.links?.length) {
      lines.push(
        '',
        `Docs: ${entry.links.map((link) => `${link.label} (${link.href})`).join(', ')}`,
      );
    }
  }
  return lines;
}

function buildDocument(sections, changelog) {
  const lines = [
    '# OtaKit Docs',
    '',
    'Canonical documentation: https://otakit.app/docs',
    '',
    'Generated from the public docs pages in `packages/site/app/docs`.',
    '',
    '## Pages',
    '',
    ...sections.map((section) => `- ${section.label}: ${section.route}`),
    '- Changelog: /changelog',
  ];

  for (const section of sections) {
    lines.push('', `## ${section.label}`, '', `Route: ${section.route}`);
    if (section.description) {
      lines.push('', section.description);
    }
    if (section.content.length > 0) {
      lines.push('', ...section.content);
    }
  }

  lines.push(...renderChangelog(changelog));

  lines.push(
    '',
    '## Related',
    '',
    'Building the native iOS shell of a Capacitor app needs a Mac with Xcode. NoMac (https://nomac.app), from friends of OtaKit, gives developers and AI agents a cloud Mac for those builds, billed by the second.',
  );

  return `${cleanLines(lines).join('\n')}\n`;
}

function findMetadata(sourceFile) {
  let metadataNode = null;

  sourceFile.forEachChild((node) => {
    if (metadataNode || !ts.isVariableStatement(node)) {
      return;
    }

    for (const declaration of node.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === 'metadata' &&
        declaration.initializer &&
        ts.isObjectLiteralExpression(declaration.initializer)
      ) {
        metadataNode = declaration.initializer;
        break;
      }
    }
  });

  if (!metadataNode) {
    return {};
  }

  return {
    title: getObjectProperty(metadataNode, 'title'),
    description: getObjectProperty(metadataNode, 'description'),
  };
}

function findDefaultPageJsx(sourceFile) {
  let jsx = null;

  sourceFile.forEachChild((node) => {
    if (jsx || !ts.isFunctionDeclaration(node)) {
      return;
    }

    const isDefaultExport =
      node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) &&
      node.body;

    if (!isDefaultExport) {
      return;
    }

    for (const statement of node.body.statements) {
      if (ts.isReturnStatement(statement) && statement.expression) {
        jsx = statement.expression;
        break;
      }
    }
  });

  if (!jsx) {
    throw new Error(`Could not find default page JSX in ${sourceFile.fileName}`);
  }

  while (ts.isParenthesizedExpression(jsx) || ts.isAsExpression(jsx)) {
    jsx = jsx.expression;
  }

  return jsx;
}

function renderBlock(node, lines, state) {
  if (!node) {
    return;
  }

  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
    renderBlock(node.expression, lines, state);
    return;
  }

  if (ts.isJsxFragment(node)) {
    for (const child of node.children) {
      renderBlock(child, lines, state);
    }
    return;
  }

  if (ts.isJsxText(node)) {
    const text = normalizeInline(node.getFullText());
    if (text) {
      lines.push(text);
    }
    return;
  }

  if (ts.isJsxElement(node)) {
    renderElement(
      node.openingElement.tagName.getText(),
      node.children,
      node.openingElement.attributes,
      lines,
      state,
    );
    return;
  }

  if (ts.isJsxSelfClosingElement(node)) {
    renderSelfClosing(node.tagName.getText(), node.attributes, lines, state);
    return;
  }

  if (ts.isJsxExpression(node) && node.expression) {
    if (ts.isJsxElement(node.expression) || ts.isJsxFragment(node.expression)) {
      renderBlock(node.expression, lines, state);
      return;
    }

    const text = toInlineText(node.expression);
    if (text) {
      lines.push(text);
    }
  }
}

function renderElement(tagName, children, attributes, lines, state) {
  if (tagName === 'Separator') {
    return;
  }

  if (tagName === 'h1' || tagName === 'H1') {
    if (!state.skippedPageHeading) {
      state.skippedPageHeading = true;
      return;
    }
    pushHeading(lines, 3, extractInline(children));
    return;
  }

  if (tagName === 'h2' || tagName === 'H2') {
    pushHeading(lines, 3, extractInline(children));
    return;
  }

  if (tagName === 'h3' || tagName === 'H3') {
    pushHeading(lines, 4, extractInline(children));
    return;
  }

  if (tagName === 'p' || tagName === 'P') {
    pushParagraph(lines, extractInline(children));
    return;
  }

  if (tagName === 'Notice') {
    pushParagraph(lines, extractInline(children));
    return;
  }

  if (tagName === 'Step') {
    const number = getAttributeValue(attributes, 'number');
    const title = getAttributeValue(attributes, 'title');
    pushHeading(lines, 3, `${number}. ${title}`);
    for (const child of children) {
      renderBlock(child, lines, state);
    }
    return;
  }

  if (tagName === 'ul' || tagName === 'ol') {
    renderList(children, lines, tagName === 'ol');
    return;
  }

  if (tagName === 'pre' || tagName === 'Pre') {
    pushCodeBlock(lines, extractCode(children));
    return;
  }

  if (tagName === 'code' || tagName === 'Code' || tagName === 'Link') {
    pushParagraph(lines, extractInline(children));
    return;
  }

  if (tagName === 'div' || tagName === 'span') {
    if (hasOnlyInlineChildren(children)) {
      pushParagraph(lines, extractInline(children));
      return;
    }

    for (const child of children) {
      renderBlock(child, lines, state);
    }
    return;
  }

  for (const child of children) {
    renderBlock(child, lines, state);
  }
}

function renderSelfClosing(tagName, attributes, lines) {
  if (tagName === 'Feature' || tagName === 'NavCard') {
    const title = getAttributeValue(attributes, 'title');
    const description = getAttributeValue(attributes, 'description');
    pushBullet(lines, formatLabel(title, description));
    return;
  }

  if (tagName === 'SummaryCard') {
    const title = getAttributeValue(attributes, 'title');
    const description = getAttributeValue(attributes, 'description');
    pushBullet(lines, formatLabel(title, description));
    return;
  }

  if (tagName === 'CapabilityRow') {
    const capability = getAttributeValue(attributes, 'capability');
    const local = getAttributeValue(attributes, 'local');
    const remote = getAttributeValue(attributes, 'remote');
    pushBullet(lines, `**${capability}**: Local MCP — ${local}; Remote MCP — ${remote}`);
    return;
  }

  if (tagName === 'Workflow') {
    const title = getAttributeValue(attributes, 'title');
    const prompt = getAttributeValue(attributes, 'prompt');
    pushHeading(lines, 4, title);
    pushParagraph(lines, `Prompt: “${prompt}”`);
    return;
  }

  if (tagName === 'ConfigRow') {
    const field = getAttributeValue(attributes, 'field');
    const type = getAttributeValue(attributes, 'type');
    const description = getAttributeValue(attributes, 'description');
    pushBullet(lines, `\`${field}\` (${type}): ${description}`);
    return;
  }

  if (tagName === 'Method') {
    const name = getAttributeValue(attributes, 'name');
    const returns = getAttributeValue(attributes, 'returns');
    const description = getAttributeValue(attributes, 'description');
    pushBullet(lines, `\`${name}\` -> \`${returns}\`: ${description}`);
    return;
  }

  if (tagName === 'EventRow') {
    const name = getAttributeValue(attributes, 'event');
    const payload = getAttributeValue(attributes, 'payload');
    const description = getAttributeValue(attributes, 'description');
    pushBullet(
      lines,
      payload ? `\`${name}\` (${payload}): ${description}` : `\`${name}\`: ${description}`,
    );
    return;
  }

  if (tagName === 'Endpoint') {
    const method = getAttributeValue(attributes, 'method');
    const endpointPath = getAttributeValue(attributes, 'path');
    const description = getAttributeValue(attributes, 'description');
    const auth = getAttributeValue(attributes, 'auth');
    const queryParams = getAttributeValue(attributes, 'queryParams');
    const headers = getAttributeValue(attributes, 'headers');
    const body = getAttributeValue(attributes, 'body');
    const response = getAttributeValue(attributes, 'response');

    pushHeading(lines, 3, `${method} ${endpointPath}`);
    pushParagraph(lines, description);
    pushBullet(lines, `Auth: ${auth}`);

    if (queryParams) {
      pushBullet(lines, `Query: ${queryParams}`);
    }
    if (headers) {
      pushParagraph(lines, 'Headers');
      pushCodeBlock(lines, headers);
    }
    if (body) {
      pushParagraph(lines, 'Request body');
      pushCodeBlock(lines, body);
    }

    pushParagraph(lines, 'Response');
    pushCodeBlock(lines, response);
    return;
  }

  if (tagName === 'Command') {
    const name = getAttributeValue(attributes, 'name');
    const args = getAttributeValue(attributes, 'args');
    const description = getAttributeValue(attributes, 'description');
    const example = getAttributeValue(attributes, 'example');
    const options = getAttributeValue(attributes, 'options');

    pushHeading(lines, 3, [name, args].filter(Boolean).join(' '));
    pushParagraph(lines, description);

    if (Array.isArray(options) && options.length > 0) {
      pushParagraph(lines, 'Options');
      for (const option of options) {
        pushBullet(lines, `\`${option.flag}\`: ${option.desc}`);
      }
    }

    if (example) {
      pushParagraph(lines, 'Example');
      pushCodeBlock(lines, example);
    }
    return;
  }

  if (tagName === 'Step') {
    const number = getAttributeValue(attributes, 'number');
    const title = getAttributeValue(attributes, 'title');
    pushHeading(lines, 3, `${number}. ${title}`);
  }
}

function renderList(children, lines, ordered) {
  let index = 1;

  for (const child of children) {
    if (!ts.isJsxElement(child) || child.openingElement.tagName.getText() !== 'li') {
      continue;
    }

    const text = extractInline(child.children);
    if (!text) {
      continue;
    }

    pushListItem(lines, ordered ? `${index}.` : '-', text);
    index += 1;
  }
}

function extractInline(children) {
  const parts = [];

  for (const child of children) {
    if (ts.isJsxText(child)) {
      parts.push(child.getFullText());
      continue;
    }

    if (ts.isJsxExpression(child)) {
      if (!child.expression) {
        continue;
      }

      if (ts.isJsxElement(child.expression) || ts.isJsxFragment(child.expression)) {
        parts.push(extractInline(child.expression.children));
        continue;
      }

      const text = toInlineText(child.expression);
      if (text) {
        parts.push(text);
      }
      continue;
    }

    if (ts.isJsxElement(child)) {
      const tagName = child.openingElement.tagName.getText();

      if (tagName === 'Code' || tagName === 'code') {
        const code = extractInline(child.children);
        if (code) {
          parts.push(`\`${code}\``);
        }
        continue;
      }

      parts.push(extractInline(child.children));
    }
  }

  return normalizeInline(joinInlineParts(parts));
}

function extractCode(children) {
  for (const child of children) {
    if (ts.isJsxText(child)) {
      const text = decodeEntities(child.getText()).trim();
      if (text) {
        return text;
      }
    }

    if (ts.isJsxExpression(child) && child.expression) {
      const value = toLiteralValue(child.expression);
      if (typeof value === 'string') {
        return value.trim();
      }
    }
  }

  return '';
}

function getObjectProperty(objectLiteral, key) {
  for (const property of objectLiteral.properties) {
    if (ts.isPropertyAssignment(property) && property.name && property.name.getText() === key) {
      const value = toLiteralValue(property.initializer);
      return typeof value === 'string' ? value : '';
    }
  }

  return '';
}

function getAttributeValue(attributes, key) {
  for (const property of attributes.properties) {
    if (!ts.isJsxAttribute(property) || property.name.text !== key) {
      continue;
    }

    if (!property.initializer) {
      return true;
    }

    if (ts.isStringLiteral(property.initializer)) {
      return property.initializer.text;
    }

    if (ts.isJsxExpression(property.initializer) && property.initializer.expression) {
      return toLiteralValue(property.initializer.expression);
    }
  }

  return '';
}

function toLiteralValue(node) {
  if (!node) {
    return '';
  }

  if (ts.isStringLiteralLike(node)) {
    return node.text;
  }

  if (ts.isNumericLiteral(node)) {
    return node.text;
  }

  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  if (ts.isTemplateExpression(node)) {
    let result = node.head.text;
    for (const span of node.templateSpans) {
      result += `\${${span.expression.getText()}}${span.literal.text}`;
    }
    return result;
  }

  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element) => toLiteralValue(element));
  }

  if (ts.isObjectLiteralExpression(node)) {
    const object = {};
    for (const property of node.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      ) {
        object[property.name.text] = toLiteralValue(property.initializer);
      }
    }
    return object;
  }

  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
    return toLiteralValue(node.expression);
  }

  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }

  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }

  if (node.kind === ts.SyntaxKind.NullKeyword) {
    return null;
  }

  if (ts.isIdentifier(node) && node.text === 'undefined') {
    return '';
  }

  return normalizeInline(node.getText());
}

function toInlineText(node) {
  const value = toLiteralValue(node);
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return decodeEntities(value);
  }
  return String(value);
}

function pushHeading(lines, level, text) {
  const content = normalizeInline(text);
  if (!content) {
    return;
  }
  lines.push('', `${'#'.repeat(level)} ${content}`);
}

function pushParagraph(lines, text) {
  const content = normalizeInline(text);
  if (!content) {
    return;
  }
  lines.push('', content);
}

function pushBullet(lines, text) {
  const content = normalizeInline(text);
  if (!content) {
    return;
  }
  lines.push(`- ${content}`);
}

function pushListItem(lines, prefix, text) {
  const content = normalizeInline(text);
  if (!content) {
    return;
  }
  lines.push(`${prefix} ${content}`);
}

function pushCodeBlock(lines, code) {
  const content = code?.trim();
  if (!content) {
    return;
  }
  lines.push('', '```txt', content, '```');
}

function formatLabel(title, description) {
  if (title && description) {
    return `**${title}**: ${description}`;
  }
  return title || description || '';
}

function normalizeInline(text) {
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

function joinInlineParts(parts) {
  let output = '';

  for (const rawPart of parts) {
    const part = decodeEntities(rawPart);
    if (!part) {
      continue;
    }

    if (!output) {
      output = part;
      continue;
    }

    const prev = output.at(-1);
    const next = part[0];
    const needsSpace =
      prev &&
      next &&
      !/\s/.test(prev) &&
      !/\s/.test(next) &&
      !/[([{/]$/.test(prev) &&
      !/^[)\]}.,;:!?/]/.test(next);

    output += needsSpace ? ` ${part}` : part;
  }

  return output;
}

function hasOnlyInlineChildren(children) {
  return children.every((child) => {
    if (ts.isJsxText(child) || ts.isJsxExpression(child)) {
      return true;
    }

    if (ts.isJsxElement(child)) {
      const tagName = child.openingElement.tagName.getText();
      return ['span', 'Link', 'Code', 'code', 'strong', 'em'].includes(tagName);
    }

    return false;
  });
}

function decodeEntities(text) {
  let output = text;
  for (const [entity, value] of ENTITY_MAP.entries()) {
    output = output.replaceAll(entity, value);
  }
  for (const [identifier, value] of CONSTANT_MAP.entries()) {
    output = output.replaceAll(identifier, value);
  }
  return output;
}

function cleanLines(lines) {
  const output = [];
  let previousBlank = true;

  for (const line of lines) {
    const value = typeof line === 'string' ? line.replace(/\s+$/g, '') : '';
    const isBlank = value.trim() === '';

    if (isBlank) {
      if (!previousBlank) {
        output.push('');
      }
    } else {
      output.push(value);
    }

    previousBlank = isBlank;
  }

  while (output.length > 0 && output.at(-1) === '') {
    output.pop();
  }

  return output;
}
