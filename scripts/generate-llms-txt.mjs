#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DOCS = [
  { label: 'Overview', route: '/docs', file: 'packages/site/app/docs/page.tsx' },
  { label: 'Setup', route: '/docs/setup', file: 'packages/site/app/docs/setup/page.tsx' },
  { label: 'CLI Reference', route: '/docs/cli', file: 'packages/site/app/docs/cli/page.tsx' },
  { label: 'Plugin API', route: '/docs/plugin', file: 'packages/site/app/docs/plugin/page.tsx' },
  { label: 'REST API', route: '/docs/api', file: 'packages/site/app/docs/api/page.tsx' },
  { label: 'Next.js Guide', route: '/docs/guide', file: 'packages/site/app/docs/guide/page.tsx' },
  { label: 'React Guide', route: '/docs/react', file: 'packages/site/app/docs/react/page.tsx' },
  {
    label: 'Loading Screen Guide',
    route: '/docs/loading-screen',
    file: 'packages/site/app/docs/loading-screen/page.tsx',
  },
  { label: 'Channels', route: '/docs/channels', file: 'packages/site/app/docs/channels/page.tsx' },
  { label: 'CI Automation', route: '/docs/ci', file: 'packages/site/app/docs/ci/page.tsx' },
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const sections = [];

  for (const page of DOCS) {
    sections.push(await renderPage(page));
  }

  const output = buildDocument(sections);

  for (const target of OUTPUTS) {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, output, 'utf8');
  }
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

function buildDocument(sections) {
  const lines = [
    '# OtaKit Docs',
    '',
    'Generated from the public docs pages in `packages/site/app/docs`.',
    '',
    '## Pages',
    '',
    ...sections.map((section) => `- ${section.label}: ${section.route}`),
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
