import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('reduce-capacitor-app-bundle-size')!;

export const metadata = blogPostMetadata(post.slug);

export default function ReduceBundleSizePage() {
  return (
    <BlogArticle post={post}>
      <p>
        A smaller web bundle helps a Capacitor app twice: it starts faster on device, and it ships
        faster over the air. Every megabyte you cut is a megabyte devices don&apos;t download on each
        update. This guide walks through the highest-leverage ways to shrink a Capacitor bundle,
        roughly in order of impact.
      </p>

      <Callout>
        <p>
          Mental model: startup speed and OTA update speed are the same problem &mdash; both are
          gated by bundle size. Optimize once, win twice.
        </p>
      </Callout>

      <h2>1. Measure first</h2>
      <p>
        Don&apos;t guess. Run a bundle analyzer to see what&apos;s actually big. For Vite:
      </p>
      <Pre>{`npm install -D rollup-plugin-visualizer
# add visualizer() to your Vite plugins, build, and open the report`}</Pre>
      <p>
        Nine times out of ten the culprits are a heavy dependency you can drop, a giant image bundled
        as a module, or a library imported whole when you use one function.
      </p>

      <h2>2. Code-split and lazy-load routes</h2>
      <p>
        Ship only what the first screen needs; load the rest on demand. Route-level lazy loading is
        the biggest single win for most apps:
      </p>
      <Pre>{`// React example
const Settings = lazy(() => import("./routes/Settings"));

// dynamic import anywhere
const heavy = await import("./heavyThing");`}</Pre>

      <h2>3. Trim and tree-shake dependencies</h2>
      <ul>
        <li>
          Import named exports, not whole libraries: <Code>import {'{'} debounce {'}'} from
          &quot;lodash-es&quot;</Code>, not the entire package.
        </li>
        <li>
          Replace heavy libraries with lighter ones &mdash; a date library you use for one format
          call is rarely worth 60&nbsp;KB.
        </li>
        <li>Drop dependencies you no longer use; they accumulate silently.</li>
      </ul>

      <h2>4. Optimize assets</h2>
      <p>
        Images are usually the biggest non-code weight. Serve modern formats (WebP/AVIF), size them
        to their real display dimensions, and load large or below-the-fold images lazily. Consider
        hosting truly large media remotely and fetching at runtime rather than bundling it &mdash;
        that also keeps it out of every OTA update.
      </p>

      <h2>5. Let production builds do their job</h2>
      <p>
        Make sure you ship minified production builds with source maps stripped (or uploaded
        separately), and that any dev-only tooling is excluded. It sounds obvious, but shipping a
        dev build to a native app is a surprisingly common size leak.
      </p>

      <h2>6. Then let deltas finish the job</h2>
      <p>
        Once the bundle is lean, delta updates ensure devices download only what changed between
        releases &mdash; so a small code change is a small download even if the total bundle is a few
        megabytes. Turn them on with:
      </p>
      <Pre>{`otakit upload --release --strategy deltas`}</Pre>
      <p>
        See <A href="/blog/delta-updates-explained-capacitor">delta updates explained</A> for how
        that works.
      </p>

      <Callout>
        <p>
          The compounding effect: a leaner bundle makes every full download faster, and deltas make
          every incremental update tiny. Do both.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        Read <A href="/blog/how-ota-works-for-capacitor-apps">how OTA works</A> to see where bundle
        size affects delivery, and the <A href="/docs/update-strategies">update strategies docs</A>{' '}
        for delta configuration.
      </p>
    </BlogArticle>
  );
}
