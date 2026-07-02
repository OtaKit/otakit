# Blog Section Plan

## Goal

Add a first-class blog section to `packages/site` for editorial, comparison, legal/policy, and educational content that supports OtaKit's existing docs and landing page.

Recommended initial posts:

- `the-1-alternative-to-capgo-capawesome`
- `vibe-code-an-app-from-your-mobile-with-claude-code-remote-and-otakit`
- `best-live-update-frameworks-for-capacitor-apps`
- `ota-policies-for-app-store-and-google-play`
- `migrate-from-capgo-and-capawesome`
- `how-ota-works-for-capacitor-apps`

Use cleaned-up public titles:

- `The #1 Alternative to Capgo / Capawesome`
- `How to vibe code an app from your mobile using Claude Code Remote and OtaKit`
- `The best live update frameworks for Capacitor apps`
- `OTA policies for App Store and Google Play: what is legal and illegal`
- `Migrating from Capgo and Capawesome`
- `How OTA works in general`

## Current repo constraints

The current site does not use MDX, a CMS, or markdown-driven routing.

- `packages/site/app/docs/*` are hand-authored TSX pages.
- `packages/site/app/docs/layout.tsx` and `packages/site/app/docs/DocsSidebar.tsx` implement a docs-specific shell.
- `packages/site/app/page.tsx` owns the public nav and footer links.
- `scripts/generate-llms-txt.mjs` has a hard-coded list of docs pages only.

That means the lowest-risk path is to build the blog as another static route tree in App Router, not to introduce a content system in the same change.

## Recommendation

Build `/blog` as a parallel section to `/docs`, with a small shared article system:

- `/blog` for the index page
- `/blog/[slug]` for article pages
- `app/blog/layout.tsx` for a blog-specific shell
- `lib/blog.ts` for post metadata and article ordering
- shared article primitives for headings, prose, callouts, code blocks, and comparison tables

Do not introduce MDX yet.

Reason:

- The existing site already uses typed TSX pages successfully.
- Only six launch posts are needed.
- The fastest path is consistent with the current codebase and avoids adding parser/build complexity.
- A later MDX migration stays possible if the blog grows beyond ~10-15 posts.

## Scope

### Phase 1: blog foundation

1. Add `app/blog/page.tsx` for the blog index.
2. Add `app/blog/layout.tsx` with:
   - top nav back to home and docs
   - article container width matching the current site feel
   - optional mobile nav if article count grows
3. Add `lib/blog.ts` with:
   - slug
   - title
   - description
   - publish status
   - publish date
   - category
   - reading time
   - related docs links
4. Add reusable blog UI helpers, likely under `packages/site/app/blog/_components/`:
   - `BlogArticle`
   - `BlogCard`
   - `BlogToc` or simple in-page nav
   - `Callout`
   - `ComparisonTable`
5. Update landing page nav/footer in `packages/site/app/page.tsx` to link to `/blog`.

### Phase 2: launch content

Create six launch articles as TSX pages under `app/blog/[slug]/page.tsx` or `app/blog/<slug>/page.tsx`.

Recommended publishing order:

1. `how-ota-works-for-capacitor-apps`
2. `ota-policies-for-app-store-and-google-play`
3. `best-live-update-frameworks-for-capacitor-apps`
4. `the-1-alternative-to-capgo-capawesome`
5. `migrate-from-capgo-and-capawesome`
6. `vibe-code-an-app-from-your-mobile-with-claude-code-remote-and-otakit`

Reason:

- Start with explanatory posts that define the category and link cleanly to existing docs.
- Then publish comparison and migration posts once the neutral framing exists.
- Keep the Claude Code Remote article last unless there is already internal material or a reproducible workflow to document.

### Phase 3: SEO and discoverability

1. Add per-post `metadata` with:
   - title
   - description
   - canonical
   - open graph
2. Add a blog index hero plus article cards.
3. Add internal links:
   - landing page -> blog
   - docs overview -> selected blog posts
   - blog posts -> setup, plugin, CLI, channels, security docs
4. Add related-post blocks at the bottom of each article.
5. Add machine-readable discovery:
   - extend `scripts/generate-llms-txt.mjs` to include blog pages, or
   - create a second generated output specifically for blog content

Recommended approach: expand the generator to a site-wide knowledge output instead of keeping it docs-only.

## Content plan by article

### 1. How OTA works in general

Purpose:

- Top-of-funnel educational piece
- Gives shared vocabulary for every other article

Use existing repo material from:

- root `README.md`
- `packages/capacitor-plugin/README.md`
- `packages/site/app/docs/page.tsx`
- `packages/site/app/docs/plugin/page.tsx`
- `packages/site/app/docs/security/page.tsx`

Outline:

1. What OTA is and is not
2. Bundle, manifest, channel, runtime version
3. Download -> stage -> activate -> confirm -> rollback
4. Why `notifyAppReady()` matters
5. What changes require store review vs OTA
6. Link out to setup, plugin, channels, and security docs

### 2. OTA policies for App Store and Google Play

Purpose:

- Build trust
- Support existing landing-page compliance claims

This post requires fresh external research before writing.

Required sources:

- Apple App Store Review Guidelines
- Apple developer/license language relevant to interpreted code or app updates
- Google Play Developer Program Policies
- Google Play guidance relevant to code downloading and app behavior changes

Rules for this article:

- Use only primary sources for policy claims
- Quote sparingly
- Include a visible "last reviewed" date
- Keep legal framing factual, not advisory
- Separate "allowed", "risky", and "not allowed" examples
- Have one final legal-review pass before publish

### 3. The best live update frameworks for Capacitor apps

Purpose:

- Comparison / buyer-intent page

Required inputs:

- Current OtaKit docs and features
- Current Capgo docs
- Current Capawesome docs

Comparison dimensions:

- hosted vs self-hosted
- open source surface area
- update model
- rollback model
- runtime compatibility support
- channels / rollout support
- dashboard quality
- CLI quality
- security model
- pricing and lock-in

Rules:

- Source every competitor claim from current public docs
- Avoid unverifiable superlatives
- Prefer a criteria table plus short analysis

### 4. The #1 Alternative to Capgo / Capawesome

Purpose:

- Commercial conversion page

This should reuse the same source pack as the comparison article, but with a stronger point of view.

Recommended structure:

1. Who this is for
2. Where Capgo / Capawesome feel limited
3. Why OtaKit is the better fit
4. Side-by-side summary table
5. CTA into setup / dashboard

Do not publish this before the neutral comparison article exists.

### 5. Migrating from Capgo and Capawesome

Purpose:

- Mid- to bottom-funnel migration page

Needs both product and docs validation.

Migration content should cover:

- concept mapping: app id, channel, runtime version, release flow
- package install / uninstall steps
- config replacement in `capacitor.config.*`
- upload and release workflow changes
- rollback and app-ready differences
- checklist for first production cutover

Recommended output:

- one shared article with separate sections for Capgo and Capawesome
- plus optional follow-up docs page later if migration demand is high

### 6. How to vibe code an app from your mobile using Claude Code Remote and OtaKit

Purpose:

- Distinctive thought-leadership / workflow post
- Likely strong social distribution piece

Dependency:

- Needs a real reproducible workflow, screenshots, and a credible end-to-end demo

Recommended structure:

1. What "vibe coding from mobile" actually means
2. Remote coding loop with Claude Code Remote
3. Build / sync / deploy path to a Capacitor app
4. Use OtaKit to ship the web layer instantly
5. Constraints, caveats, and where the workflow breaks

This article is the least connected to existing docs, so it should be written only after the workflow is validated.

## File plan

Expected new files:

- `packages/site/app/blog/layout.tsx`
- `packages/site/app/blog/page.tsx`
- `packages/site/app/blog/_components/BlogArticle.tsx`
- `packages/site/app/blog/_components/BlogCard.tsx`
- `packages/site/lib/blog.ts`
- one page per article slug

Expected modified files:

- `packages/site/app/page.tsx`
- `packages/site/app/layout.tsx` if metadata needs improvement
- `packages/site/README.md`
- `scripts/generate-llms-txt.mjs`
- `packages/site/public/llms.txt` via build output regeneration

Optional later files:

- `packages/site/app/blog/rss.xml/route.ts`
- `packages/site/app/sitemap.ts`

## Implementation sequence

1. Add `lib/blog.ts` and settle slug/title/ordering.
2. Build the blog layout and index page.
3. Add shared article primitives so the six posts stay visually consistent.
4. Publish `how-ota-works-for-capacitor-apps` first using existing docs material.
5. Publish the policy article only after current Apple/Google source review.
6. Publish comparison and alternative articles from the same source set.
7. Publish the migration guide after validating exact competitor terminology and config mapping.
8. Publish the Claude Code Remote workflow article after hands-on verification.
9. Update nav/footer and add internal links from docs and landing pages.
10. Extend `llms.txt` generation and regenerate outputs.

## Acceptance criteria

- `/blog` exists and is linked from the landing page
- all six posts have stable slugs and metadata
- each post links to at least two relevant docs pages
- comparison and policy posts are source-backed
- no new content system dependency is introduced
- `pnpm --filter @otakit/site build` succeeds after `llms.txt` changes

## Risks

- The policy article can go stale quickly; it needs date-stamped citations and periodic review.
- Competitor claims will drift; comparison pages need a source refresh process.
- If article volume grows, hand-authored TSX pages will become harder to maintain and MDX may become worth it later.
- The Claude Code Remote article is weak unless backed by a real tested workflow and visuals.
