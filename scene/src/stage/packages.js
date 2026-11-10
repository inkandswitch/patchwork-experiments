// The stage's side of a scene's packages (STAGE.md, "Packages"): keeping the
// doc's list true to what the doc calls for, and loading the listed packages
// this viewer doesn't have. The rules are src/packages.js (pure); this is
// when they're applied.
//
//   - reconcile: after every doc change and every registry change, add
//     `{ url }` for each package that a registered plugin the doc calls for
//     comes from and the list doesn't name (packagesToList). Appends only:
//     never removes, never rewrites, never makes the list. The same pass
//     writes the scene package's own URL as `@patchwork.suggestedImportUrl`
//     on a doc that names nothing loadable there.
//   - loading: once the registry has been quiet for a moment (the shell is
//     still registering this viewer's own packages as the scene opens), the
//     listed packages that aren't registered are published as
//     local.packages for the prompt (the scene.packages part), except those
//     this viewer accepted before, which load unasked. Nothing loads without
//     one or the other: a click, or a remembered click for that URL.
//
// A load is the module watcher's two steps, on this thread: the package at
// its folder doc's current heads through importPackage, then registerPlugins
// with the bare URL. Both come from the host's importmap, by dynamic import.
// Nothing is written to the viewer's module settings: what a scene brings
// lasts until the page is reloaded.

import { answeringPlugins, listedPackages, missingPackages, packageTitle, packageUrl, packagesToList, registeredPackages, suggestedImportToSet, triage } from "../packages.js";

/** How long the registry must be quiet, after the scene opens, before anything is offered or loaded. */
export const PACKAGE_SETTLE_MS = 1_000;
/** How long to wait for a package's folder doc. */
export const PACKAGE_FIND_MS = 30_000;
/** localStorage: the package URLs this viewer has accepted, as a JSON list. */
export const ACCEPTED_KEY = "scene-packages:accepted";
/** The registries whose changes are watched (the ones a scene reads, and the two every package may register in). */
const WATCHED = ["scene:extension", "scene:source", "scene:part", "scene:template", "patchwork:tool", "patchwork:datatype"];

// Shared by every scene on the page: one registry, so one load per package.
const loading = new Map(); // url → the load in flight
const loaded = new Set(); // urls loaded here this page (a package with no plugins registers nothing to find it by)
const names = new Map(); // url → its name for people, or null; a promise while it's being read
const watchers = new Set(); // every stage's check, called when a load or a name settles

const listOf = (reg) => {
  try {
    return reg?.filter?.(() => true) ?? [];
  } catch {
    return [];
  }
};

/** The accepted package URLs, from localStorage. */
export function readAccepted() {
  try {
    const list = JSON.parse(globalThis.localStorage?.getItem(ACCEPTED_KEY) ?? "[]");
    return new Set((Array.isArray(list) ? list : []).map(packageUrl).filter(Boolean));
  } catch {
    return new Set(); // private window: accepted for this page only
  }
}

function rememberAccepted(url) {
  try {
    const next = readAccepted();
    if (next.has(url)) return;
    next.add(url);
    globalThis.localStorage?.setItem(ACCEPTED_KEY, JSON.stringify([...next]));
  } catch {
    // private window, or full: asked again next time
  }
}

const within = (promise, ms, what) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(what)), ms);
    Promise.resolve(promise).then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      },
    );
  });

/** Load one package and register its plugins, once per page however many scenes ask. */
function loadPackage(url, { repo, plugins }) {
  let p = loading.get(url);
  if (p) return p;
  p = (async () => {
    const fs = await import("@inkandswitch/patchwork-filesystem");
    let at = url;
    if (url.startsWith("automerge:")) {
      // at its heads now, as the module watcher loads it: the entry and every chunk from one version
      const folder = await within(repo.find(url), PACKAGE_FIND_MS, "its folder couldn't be found");
      at = folder.view(folder.heads()).url;
    }
    const pkg = await fs.importPackage(at);
    if (!Array.isArray(pkg?.plugins)) throw new Error("it has no plugins list");
    plugins.registerPlugins(pkg.plugins, url);
    loaded.add(url);
  })().finally(() => {
    loading.delete(url);
    for (const w of [...watchers]) w();
  });
  loading.set(url, p);
  return p;
}

/** A package's own name (its package.json's), read from its folder doc. Null for an https package: asking would tell its host who is looking. */
function nameOf(url, repo) {
  if (names.has(url)) {
    const n = names.get(url);
    return typeof n === "string" ? n : null;
  }
  if (!url.startsWith("automerge:")) {
    names.set(url, null);
    return null;
  }
  const reading = (async () => {
    const folder = await within(repo.find(url), PACKAGE_FIND_MS, "not found");
    const link = (folder.doc()?.docs ?? []).find((d) => d?.name === "package.json" && typeof d.url === "string");
    if (!link) return null;
    const file = await within(repo.find(link.url), PACKAGE_FIND_MS, "not found");
    const c = file.doc()?.content;
    return packageTitle(c instanceof Uint8Array ? new TextDecoder().decode(c) : String(c ?? ""));
  })()
    .catch(() => null)
    .then((name) => {
      names.set(url, name);
      if (name) for (const w of [...watchers]) w();
    });
  names.set(url, reading);
  return null;
}

/** Forget what this page has loaded and read (between tests). */
export function resetPackages() {
  loading.clear();
  loaded.clear();
  names.clear();
  watchers.clear();
}

/**
 * @param {{
 *   repo: object,
 *   handle: object,                              // the scene doc's
 *   plugins: Promise<object | null>,             // the host's @inkandswitch/patchwork-plugins
 *   local: { get(): object, swap(fn): object },  // the stage's local atom (local.packages out)
 *   providerIds?: () => Iterable<string>,        // the providers render docs have asked the stage for
 *   settleMs?: number,
 * }} o
 */
export function createPackages({ repo, handle, plugins, local, providerIds = () => [], settleMs = PACKAGE_SETTLE_MS }) {
  let dead = false;
  let mod = null; // the plugins module, once it's here
  let settled = !(settleMs > 0);
  let settleTimer = null;
  let queued = false;
  const used = new Set(); // importUrls of the parts and templates run in this view
  const declined = new Set(); // "Not now", until the scene is opened again
  const failed = new Map(); // url → what went wrong
  const accepted = readAccepted();
  const offs = [];

  const registries = () => {
    const out = {};
    try {
      for (const [type, reg] of mod.getAllRegistries?.() ?? []) out[type] = listOf(reg);
    } catch {
      // an older host: the watched ones below
    }
    for (const type of WATCHED) out[type] ??= listOf(mod.getRegistry?.(type));
    return out;
  };

  function settle() {
    if (settled || dead) return;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settled = true;
      check();
    }, settleMs);
  }

  /** Look again, once, after whatever is happening now. */
  function check() {
    if (queued || dead) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!dead && mod) checkNow();
    });
  }

  function checkNow() {
    const doc = handle.doc() ?? {};
    const regs = registries();

    // reconcile: name what the doc calls for and this viewer has, and the
    // scene package itself as the doc's suggested import, if it names none
    const readOnly = !!handle.isReadOnly?.();
    const add = readOnly ? [] : packagesToList({ doc, registries: regs, used, providerIds: providerIds() });
    const suggest = readOnly ? null : suggestedImportToSet(doc, regs);
    if (add.length || suggest) {
      try {
        handle.change((d) => {
          // (only the list init made: STAGE.md, "Shared maps")
          if (Array.isArray(d.packages)) for (const url of add) if (!d.packages.some((e) => e?.url === url)) d.packages.push({ url });
          // a scalar in the map the doc was made with: nothing two peers could each create
          if (suggest && d["@patchwork"] && typeof d["@patchwork"] === "object" && !packageUrl(d["@patchwork"].suggestedImportUrl)) d["@patchwork"].suggestedImportUrl = suggest;
        });
      } catch (err) {
        console.warn("[scene] couldn't list the scene's packages", err);
      }
      // the change comes back through the doc loop, which checks again
    }

    // what's listed and isn't here
    const here = registeredPackages(regs);
    for (const url of loaded) here.add(url);
    const missing = missingPackages(handle.doc() ?? {}, here);
    for (const url of [...failed.keys()]) if (!missing.includes(url)) failed.delete(url);
    const t = triage(missing, { loading: new Set(loading.keys()), failed, accepted, declined });
    const named = (url) => ({ url, name: nameOf(url, repo) });
    const next = {
      // nothing is offered until the registry has settled: the viewer's own packages may still be on their way
      ask: settled ? t.ask.map(named) : [],
      loading: t.loading.map(named),
      failed: t.failed.map((url) => ({ ...named(url), error: failed.get(url) })),
    };
    const key = JSON.stringify(next);
    local.swap((m) => (JSON.stringify(m.packages) === key ? m : { ...m, packages: Object.freeze({ ask: Object.freeze(next.ask), loading: Object.freeze(next.loading), failed: Object.freeze(next.failed) }) }));
    if (settled && t.load.length) void run(t.load);
  }

  /** Load these, each on its own: one failing doesn't stop the rest. */
  async function run(urls, { remember = false } = {}) {
    const jobs = urls.map(async (url) => {
      failed.delete(url);
      try {
        await loadPackage(url, { repo, plugins: mod });
        if (remember) {
          accepted.add(url);
          rememberAccepted(url);
        }
      } catch (err) {
        console.warn(`[scene] couldn't load the package ${url}`, err);
        if (!dead) failed.set(url, String(err?.message ?? err));
      }
    });
    check(); // they're loading now: say so
    await Promise.all(jobs);
    check();
  }

  /** Only what the doc lists, isn't here and isn't loading: [urls] or everything asked about and failed. */
  const choose = (urls, among) => {
    const want = Array.isArray(urls) ? new Set(urls.map(packageUrl)) : null;
    return among.filter((url) => !want || want.has(url));
  };
  const open = () => {
    const p = local.get().packages ?? {};
    return [...(p.ask ?? []), ...(p.failed ?? [])].map((e) => e.url);
  };

  watchers.add(check);
  Promise.resolve(plugins).then((m) => {
    if (dead || !m) return;
    mod = m;
    for (const type of WATCHED) {
      try {
        const off = m.getRegistry?.(type)?.on?.("changed", () => {
          settle();
          check();
        });
        if (typeof off === "function") offs.push(off);
      } catch {
        // a registry without change events: what's registered at each doc change is what counts
      }
    }
    settle();
    check();
  });

  return {
    check,
    /** A part or template was run here: its package belongs on the list too. */
    used(type, id) {
      if (dead || !mod) return;
      let importUrl = null;
      try {
        importUrl = mod.getRegistry?.(type)?.get?.(id)?.importUrl ?? listOf(mod.getRegistry?.(type)).find((p) => p?.id === id)?.importUrl ?? null;
      } catch {
        // unknown: nothing to note
      }
      if (typeof importUrl !== "string" || used.has(importUrl)) return;
      used.add(importUrl);
      check();
    },
    /**
     * The viewer said yes: load these (default: all that are asked about or
     * failed), and remember each that loads. Only packages the doc lists.
     * @param {string[]} [urls]
     */
    load(urls) {
      if (dead || !mod) return Promise.resolve();
      const go = choose(urls, open());
      for (const url of go) declined.delete(url);
      return run(go, { remember: true });
    },
    /** The viewer said not now: don't ask about these (default: all) again in this view. */
    dismiss(urls) {
      if (dead) return;
      for (const url of choose(urls, open())) {
        failed.delete(url);
        declined.add(url);
      }
      check();
    },
    /** for probes: what the doc calls for and who answers, what's listed, what's missing */
    inspect() {
      const doc = handle.doc() ?? {};
      const regs = mod ? registries() : {};
      const here = registeredPackages(regs);
      for (const url of loaded) here.add(url);
      return { answering: answeringPlugins(doc, regs, { providerIds: providerIds() }), listed: listedPackages(doc), missing: missingPackages(doc, here), settled, declined: [...declined], accepted: [...accepted] };
    },
    dispose() {
      dead = true;
      clearTimeout(settleTimer);
      watchers.delete(check);
      for (const off of offs) off();
      offs.length = 0;
    },
  };
}
