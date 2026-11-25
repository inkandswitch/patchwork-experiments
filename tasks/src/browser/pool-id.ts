// Which pool is this browser's, for the pool host and for views that mark it.

/** Where a browser profile keeps its pool's id. */
export const POOL_ID_KEY = 'patchwork-tasks-pool-id';

let fallback: string | undefined;

/**
 * This browser profile's pool id: made once and kept in localStorage, so the
 * pool of whichever tab holds the pool's lock next has the same id and
 * records as lost the runs the last one did not finish.
 *
 * Where localStorage cannot be used (blocked site data, a sandboxed frame),
 * each page makes an id of its own. Runs a pool loses are then never recorded
 * lost by anyone: they stay open and unheard, read `stalled`, and are taken
 * again after the lapse.
 */
export function browserPoolId(): string {
  try {
    if (!localStorage.getItem(POOL_ID_KEY)) {
      localStorage.setItem(POOL_ID_KEY, crypto.randomUUID());
    }
    const id = localStorage.getItem(POOL_ID_KEY);
    if (id) {
      return id;
    }
  } catch {
    // no localStorage here: see above
  }
  return (fallback ??= crypto.randomUUID());
}

/**
 * A name a person recognises for this browser among the pools serving a
 * queue: the browser and its system, and the start of the pool's id to tell
 * two such browsers apart.
 */
export function browserPoolName(id: string, userAgent = navigator.userAgent): string {
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'A browser';
  const system = /iPhone|iPad/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(userAgent)
        ? 'macOS'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Linux|CrOS/.test(userAgent)
            ? 'Linux'
            : null;
  return `${browser}${system ? ` on ${system}` : ''} (${id.slice(0, 4)})`;
}
