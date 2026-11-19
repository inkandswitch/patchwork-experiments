// Loading a package this viewer doesn't have, as the scene does for a
// scene's listed packages (scene/src/stage/packages.js, "A load is the
// module watcher's two steps"; copied, since packages don't import each
// other): its folder doc at its heads once it has stopped changing, through
// importPackage, then registerPlugins under the bare URL, so the scene
// counts it as here. Nothing is written to the viewer's module settings:
// what's loaded lasts until the page is reloaded. Once per page per URL.

/** How long to wait for a package's folder doc. */
export const FIND_MS = 30_000;
/** How long a found folder must go without a change before it's loaded at its heads (a doc found fresh is still catching up). */
export const FOLDER_QUIET_MS = 500;

const loading = new Map(); // url → the load in flight, or done

const within = (promise, ms, what) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(what)), ms);
    Promise.resolve(promise).then(
      (v) => (clearTimeout(t), resolve(v)),
      (err) => (clearTimeout(t), reject(err)),
    );
  });

/** Resolves once `handle` has gone `ms` without a change, or after `max` whatever it does. */
function quiet(handle, ms, max) {
  return new Promise((resolve) => {
    let timer = null;
    const done = () => {
      clearTimeout(timer);
      clearTimeout(cap);
      handle.off?.("change", changed);
      resolve();
    };
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(done, ms);
    };
    const cap = setTimeout(done, max);
    handle.on?.("change", changed);
    changed();
  });
}

/**
 * Load the package at `url` (`automerge:` bare, or public `https:`) and
 * register its plugins. Rejects with what went wrong.
 * @param {string} url  @param {{ repo: object }} host
 */
export function loadPackage(url, { repo }) {
  let p = loading.get(url);
  if (p) return p;
  p = (async () => {
    const [fs, plugins] = await Promise.all([import("@inkandswitch/patchwork-filesystem"), import("@inkandswitch/patchwork-plugins")]);
    let at = url;
    if (url.startsWith("automerge:")) {
      const folder = await within(repo.find(url), FIND_MS, "its folder couldn't be found");
      await quiet(folder, FOLDER_QUIET_MS, FIND_MS);
      at = folder.view(folder.heads()).url;
    }
    const pkg = await fs.importPackage(at);
    if (!Array.isArray(pkg?.plugins)) throw new Error("it has no plugins list");
    plugins.registerPlugins(pkg.plugins, url);
  })();
  loading.set(url, p);
  p.catch(() => loading.delete(url)); // (a failed load may be tried again)
  return p;
}
