// One build of one scene-render doc: call the provider, store the GLB as a new
// immutable file doc, repoint the render doc at it. The source doc is only read.

import { parseGLB } from "./glb.js";
import { normalizeDeps, paramsKey, sameDeps, sameHeads, sortedHeads, stableStringify, withDefaults } from "./staleness.js";

export function errorMessage(err) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  return err.message || String(err);
}

/** The provider's fingerprint for a doc, or null if it has none (or it threw). */
export function fingerprintOf(impl, doc) {
  if (typeof impl?.fingerprint !== "function" || !doc) return null;
  try {
    const fp = impl.fingerprint(doc);
    return fp == null ? null : String(fp);
  } catch (err) {
    console.warn("[scene] provider fingerprint() threw; falling back to heads", err);
    return null;
  }
}

/**
 * The other docs the provider says build() reads (its optional, synchronous
 * dependencies(doc)): distinct non-empty strings, sorted, never the source
 * itself. [] if it has none, or it threw.
 */
export function dependenciesOf(impl, doc, sourceUrl = null) {
  if (typeof impl?.dependencies !== "function" || !doc) return [];
  try {
    const list = impl.dependencies(doc);
    if (!Array.isArray(list) && !(list && typeof list === "object" && typeof list[Symbol.iterator] === "function")) return [];
    const urls = new Set();
    for (const u of list) if (typeof u === "string" && u && u !== sourceUrl) urls.add(u);
    return [...urls].sort();
  } catch (err) {
    console.warn("[scene] provider dependencies() threw; treating as none", err);
    return [];
  }
}

export function glbFileDoc(title, glb) {
  // "part.stl" → "part.glb"
  const base = String(title || "render").replace(/\.[a-z0-9]{2,4}$/i, "") || "render";
  return {
    "@patchwork": { type: "file" },
    name: `${base}.glb`,
    extension: "glb",
    mimeType: "model/gltf-binary",
    content: glb,
  };
}

/**
 * @param {object} o
 * @param {object} o.repo
 * @param {object} o.renderHandle   the scene-render doc
 * @param {object} o.sourceHandle   the source doc (never written)
 * @param {object} o.provider       { id, name, params: ParamSpec[], module: SourceImpl }
 * @param {{ [url]: string[] }} [o.deps]  heads of each dependency as this build reads it
 *        ([] for one that couldn't be loaded); recorded as builtFrom.deps
 * @param {(deps: { [url]: string[] }) => { [url]: string[] }} [o.depsAfter]
 *        called once build() resolves, with the snapshot above: may fill in a
 *        dependency that finished loading during the build (build() read it)
 * @param {() => number} [o.now]
 * @returns {Promise<{ ok: true, glbUrl, builtFrom, meta } | { ok: false, error: string }>}
 */
export async function runBuild({ repo, renderHandle, sourceHandle, provider, deps = {}, depsAfter, now = Date.now }) {
  const render = renderHandle.doc();
  const source = sourceHandle.doc();
  const impl = provider?.module;
  if (!render) return { ok: false, error: "render document is not available" };
  try {
    if (!impl || typeof impl.build !== "function") throw new Error(`provider ${provider?.id ?? "?"} has no build()`);
    if (!source) throw new Error("source document is not available");

    // Snapshot the inputs before building; if they move during the build the
    // result is recorded against what it was actually built from, and the next
    // staleness check picks up the difference.
    const heads = sortedHeads(sourceHandle.heads?.() ?? []);
    const fingerprint = fingerprintOf(impl, source);
    const storedParams = JSON.parse(JSON.stringify(render.params ?? {}));
    const key = paramsKey(storedParams);
    const params = withDefaults(provider.params, storedParams);
    const builtFromBefore = stableStringify(render.builtFrom ?? null);
    const depsBefore = normalizeDeps(deps);

    renderHandle.change((d) => {
      d.status = "building";
      d.error = null;
    });

    const result = await impl.build({ doc: source, handle: sourceHandle, url: sourceHandle.url, params, repo });
    if (!result || result.kind !== "glb") throw new Error(`provider returned ${result?.kind ?? "nothing"}, expected kind "glb"`);
    let glb = result.glb;
    if (glb instanceof ArrayBuffer) glb = new Uint8Array(glb);
    if (!(glb instanceof Uint8Array)) throw new Error("provider result has no glb bytes");
    parseGLB(glb); // throws on a malformed GLB
    const depHeads = normalizeDeps(typeof depsAfter === "function" ? depsAfter(depsBefore) ?? depsBefore : depsBefore);

    // Two open scenes can start the same build within one relay round trip, before
    // either hears the other's "building" broadcast. If a peer committed a build of
    // exactly these inputs while ours ran, keep theirs: no second GLB doc, no second
    // repoint. (builtFrom must have *changed* during the build, so a forced rebuild
    // of an already-fresh render still goes ahead.)
    const current = renderHandle.doc();
    const theirs = current?.builtFrom;
    if (
      current?.glbUrl &&
      theirs &&
      stableStringify(theirs) !== builtFromBefore &&
      theirs.paramsKey === key &&
      (theirs.fingerprint ?? null) === (fingerprint ?? null) &&
      sameHeads(theirs.heads, heads) &&
      sameDeps(theirs.deps, depHeads)
    ) {
      if (current.status === "building") {
        renderHandle.change((d) => {
          d.status = "idle";
          d.error = null;
        });
      }
      return { ok: true, glbUrl: current.glbUrl, builtFrom: { heads, fingerprint, paramsKey: key, deps: depHeads }, meta: result.meta ?? null, superseded: true };
    }

    const fileHandle = await repo.create2(glbFileDoc(render.title, glb));
    const builtFrom = { heads, fingerprint, paramsKey: key, deps: depHeads };
    renderHandle.change((d) => {
      d.glbUrl = fileHandle.url;
      d.builtFrom = {
        ...builtFrom,
        heads: [...heads],
        deps: Object.fromEntries(Object.entries(depHeads).map(([u, h]) => [u, [...h]])),
      };
      d.builtAt = now();
      d.status = "idle";
      d.error = null;
    });
    return { ok: true, glbUrl: fileHandle.url, builtFrom, meta: result.meta ?? null };
  } catch (err) {
    const error = errorMessage(err);
    console.warn(`[scene] build failed (${provider?.id ?? "?"})`, err);
    renderHandle.change((d) => {
      d.status = "error";
      d.error = error;
    });
    return { ok: false, error };
  }
}
