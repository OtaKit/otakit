/**
 * Builds a Better Auth instance on first use and builds a new one when its startup
 * fails, instead of keeping a broken one.
 *
 * Better Auth runs every plugin's init once, when betterAuth() is called, and every
 * auth call awaits that single promise. With remote MCP enabled, the OAuth provider's
 * init queries the database (it seeds the MCP resource row). If that query fails,
 * Better Auth keeps the rejected promise, and every later sign-in check on the
 * instance fails with the same error until Vercel retires the instance. On
 * 2026-11-04 that broke /login and /dashboard on one instance for an hour while the
 * database was fine.
 *
 * Building on first use also moves the startup query into a request that waits for
 * it, rather than module load, where nothing keeps a Vercel instance awake for it.
 */
export function restartOnFailedStart<T extends { $context: Promise<unknown> }>(
  create: () => T,
  onFailedStart: (error: unknown) => void,
): T {
  let current: T | undefined;

  const instance = (): T => {
    if (current) return current;
    const created = create();
    current = created;
    created.$context.catch((error: unknown) => {
      if (current === created) current = undefined;
      onFailedStart(error);
    });
    return created;
  };

  // Callers read auth.api, auth.handler and auth.$context per request, so each
  // read reaches whichever instance is current. Nothing enumerates the object.
  return new Proxy({} as T, {
    get: (_target, property) => Reflect.get(instance(), property),
    has: (_target, property) => Reflect.has(instance(), property),
  });
}
