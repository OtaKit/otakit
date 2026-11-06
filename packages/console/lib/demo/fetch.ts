import type { DemoConsole } from './api';

/**
 * Routes the dashboard's same-origin `/api/v1/` requests to the demo console
 * while the demo is open; every other request goes out as usual. Returns the
 * function that restores the original fetch.
 */
export function installDemoFetch(demo: DemoConsole): () => void {
  const original = window.fetch;
  const demoFetch: typeof window.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/v1/')) {
      return original(input, init);
    }
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    const body = typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : undefined;
    // A short, varied delay, so loading states look like the real console.
    await new Promise((resolve) => setTimeout(resolve, 80 + Math.random() * 120));
    const response = await demo.handle(method, url, body, Date.now());
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  window.fetch = demoFetch;
  return () => {
    if (window.fetch === demoFetch) window.fetch = original;
  };
}
