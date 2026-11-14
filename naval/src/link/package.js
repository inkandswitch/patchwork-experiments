// The package a linked hull names for itself. A camber hull doc carries
// `@patchwork.suggestedImportUrl` (camber's wrapper): the package whose
// scene:source builds it and whose chartroom:source gives its statics. A rig
// opened where that package isn't installed can't read its hull, and the
// rig doc can suggest only one package (naval's own, its tool's), so the
// rig follows the link: it offers the hull's own suggestion, which works for
// any hull from any package without the rig knowing which.
//
// Loading is the scene stage's (scene/src/stage/packages.js loadPackage),
// copied (packages never import each other): an automerge: package is its
// folder doc at its heads now, imported with patchwork-filesystem's
// importPackage, its plugins registered under its url. Nothing loads without
// the person saying yes (the tool asks, naming the url, as Patchwork does
// for a doc's own suggestion): a package is arbitrary code a document names.

const FIND_MS = 30_000;

/**
 * The package a doc suggests for itself, when it names one that can be
 * imported (an http(s) module or an automerge: folder doc, as Patchwork's own
 * rule: core/filesystem metadata.ts isImportableSuggestedUrl); else null. Pure.
 */
export function suggestedPackageOf(doc) {
  const url = doc?.["@patchwork"]?.suggestedImportUrl;
  if (typeof url !== "string" || !url) return null;
  // an automerge: url exactly (a base58 document id), no heads or path
  if (/^automerge:[1-9A-HJ-NP-Za-km-z]{20,60}$/.test(url)) return url;
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

const loading = new Map(); // url → the load in flight

const within = (promise, ms, what) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(what)), ms);
    Promise.resolve(promise).then(
      (v) => (clearTimeout(t), resolve(v)),
      (err) => (clearTimeout(t), reject(err)),
    );
  });

/** Load a package and register its plugins, once per page however often it's asked. Rejects saying why. */
export function loadPackage(url, { repo } = {}) {
  let p = loading.get(url);
  if (p) return p;
  p = (async () => {
    const [fs, plugins] = await Promise.all([import("@inkandswitch/patchwork-filesystem"), import("@inkandswitch/patchwork-plugins")]);
    let at = url;
    if (url.startsWith("automerge:")) {
      if (!repo?.find) throw new Error("no repo to find its folder in");
      // at its heads now, as the module watcher loads it: the entry and every chunk from one version
      const folder = await within(repo.find(url), FIND_MS, "its folder couldn't be found");
      at = folder.view(folder.heads()).url;
    }
    const pkg = await fs.importPackage(at);
    if (!Array.isArray(pkg?.plugins)) throw new Error("it has no plugins list");
    plugins.registerPlugins(pkg.plugins, url);
  })().catch((err) => {
    loading.delete(url);
    throw err;
  });
  loading.set(url, p);
  return p;
}
