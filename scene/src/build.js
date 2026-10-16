// One build of one scene-render doc: call the provider, store the GLB as a new
// immutable file doc, repoint the render doc at it. The source doc is only read.
// A build whose bytes are identical to the current GLB's keeps the current file
// doc (builtFrom.glbHash), so a rebuild that changes nothing makes no new doc.

import { parseGLB } from "./glb.js";
import { isRenderDoc, renderKey } from "./render-read.js";
import { effectiveParams, normalizeDeps, paramsKey, providerVersionOf, sameDeps, sameHeads, sortedHeads, stableStringify } from "./staleness.js";

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

/**
 * A narrower key than heads for one dependency doc (SourceImpl's optional
 * fingerprintDependency(url, doc)), or null to use its heads. A provider
 * without one still gets a key for a scene-render dependency: its glbUrl, so a
 * consumer of a render rebuilds when the render does, not when its status flips.
 */
export function dependencyKeyOf(impl, url, doc) {
  if (!doc) return null;
  if (typeof impl?.fingerprintDependency === "function") {
    try {
      const k = impl.fingerprintDependency(url, doc);
      if (k != null) return String(k);
    } catch (err) {
      console.warn("[scene] provider fingerprintDependency() threw; using heads", err);
      return null;
    }
  }
  if (isRenderDoc(doc)) return renderKey(doc);
  return null;
}

/** A bounds box worth keeping: { min: [x,y,z], max: [x,y,z] } of finite numbers, else null. */
export function validBounds(b) {
  const ok = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(Number(n)));
  return b && ok(b.min) && ok(b.max) ? { min: b.min.map(Number), max: b.max.map(Number) } : null;
}

/** A content hash of GLB bytes: SHA-256 hex where WebCrypto exists, else a 53-bit hash. */
export async function hashBytes(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
    return `sha256:${Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  }
  let h1 = 0xdeadbeef ^ bytes.length;
  let h2 = 0x41c6ce57 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 2654435761);
    h2 = Math.imul(h2 ^ bytes[i], 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `c53:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)}`;
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
 * @param {object} o.provider       { id, name, params: ParamSpec[], version?: number, module: SourceImpl }
 * @param {{ [url]: string[] }} [o.deps]  heads of each dependency as this build reads it
 *        ([] for one that couldn't be loaded); recorded as builtFrom.deps
 * @param {(deps: { [url]: string[] }) => { [url]: string[] }} [o.depsAfter]
 *        called once build() resolves, with the snapshot above: may fill in a
 *        dependency that finished loading during the build (build() read it)
 * @param {() => number} [o.now]
 * @returns {Promise<{ ok: true, glbUrl, builtFrom, meta, reused?: boolean, superseded?: boolean } | { ok: false, error: string, aborted?: true }>}
 *        aborted: build() rejected with an AbortError (the provider cancelled it); not recorded as an error
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
    const params = effectiveParams(provider.params, storedParams);
    const providerVersion = providerVersionOf(provider.version);
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
    const glbHash = await hashBytes(glb);
    const bounds = validBounds(result.meta?.bounds);
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
      providerVersionOf(theirs.providerVersion) === providerVersion &&
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

    // Same bytes as the GLB already shown (a rename, a provider bump that changed
    // nothing, a param that doesn't affect this doc): keep that file doc.
    const reused = !!current?.glbUrl && current?.builtFrom?.glbHash === glbHash;
    const glbUrl = reused ? current.glbUrl : (await repo.create2(glbFileDoc(render.title, glb))).url;
    const builtFrom = { heads, fingerprint, paramsKey: key, deps: depHeads, glbHash };
    if (providerVersion != null) builtFrom.providerVersion = providerVersion;
    renderHandle.change((d) => {
      d.glbUrl = glbUrl;
      d.builtFrom = {
        ...builtFrom,
        heads: [...heads],
        deps: Object.fromEntries(Object.entries(depHeads).map(([u, h]) => [u, [...h]])),
      };
      if (bounds) d.bounds = { min: [...bounds.min], max: [...bounds.max] };
      else if (d.bounds != null) d.bounds = null;
      d.builtAt = now();
      d.status = "idle";
      d.error = null;
    });
    return { ok: true, glbUrl, builtFrom, meta: result.meta ?? null, reused };
  } catch (err) {
    if (err?.name === "AbortError") {
      // The provider cancelled it (a newer build of the same doc superseded it):
      // not a failure. Put the status back; the caller re-evaluates.
      if (renderHandle.doc()?.status === "building") {
        renderHandle.change((d) => {
          d.status = "idle";
        });
      }
      return { ok: false, aborted: true, error: errorMessage(err) };
    }
    const error = errorMessage(err);
    console.warn(`[scene] build failed (${provider?.id ?? "?"})`, err);
    renderHandle.change((d) => {
      d.status = "error";
      d.error = error;
    });
    return { ok: false, error };
  }
}
