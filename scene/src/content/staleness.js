// Staleness and build scheduling, per the scene contract (README.md,
// "Content"). Pure; no automerge.

import { stableStringify } from "../params.js";
import { depsKey, isFpKey, normalizeDeps, sameHeads, sortedHeads } from "../versions.js";

/** paramsKey = stable JSON of params with sorted keys. */
export function paramsKey(params) {
  return stableStringify(params ?? {});
}

// ─── dependencies ───────────────────────────────────────────────────────────
// A provider's optional dependencies(doc) lists other docs its build() reads.
// builtFrom.deps records each one's sorted heads as read for that build:
// { [url]: string[] }. A dependency that isn't loaded counts as having no heads
// ([]), so a render built without it goes stale once it arrives.

/** Same dependency URLs, each at the same heads. */
export function sameDeps(a, b) {
  const x = normalizeDeps(a);
  const y = normalizeDeps(b);
  const kx = Object.keys(x);
  const ky = Object.keys(y);
  return kx.length === ky.length && kx.every((u, i) => u === ky[i] && sameHeads(x[u], y[u]));
}

/**
 * Why a render is stale, or null if it is fresh.
 * @param {object} render   the scene-render doc
 * @param {object} source   { heads: string[], fingerprint: string | null | undefined, deps?: { [url]: string[] },
 *                            providerVersion?: number }
 *                          fingerprint undefined/null = provider has no fingerprint();
 *                          deps = current heads of each doc the provider says it reads (absent = none),
 *                            or ["fp:<key>"] for one the provider (or the host) fingerprints;
 *                          providerVersion = the installed provider's `version`, if it declares one
 * @returns {null | "never-built" | "params" | "provider" | "fingerprint" | "heads" | "deps"}
 */
export function staleReason(render, source) {
  const built = render?.builtFrom;
  if (!built) return "never-built";
  if (built.paramsKey !== paramsKey(render.params)) return "params";
  if (olderVersion(built.providerVersion, source?.providerVersion)) return "provider";
  const fp = source?.fingerprint;
  if (fp != null) {
    if (fp !== built.fingerprint) return "fingerprint";
  } else if (!sameHeads(source?.heads, built.heads)) {
    return "heads";
  }
  return sameDeps(source?.deps, built.deps) ? null : "deps";
}

// ─── fixed versions (`at`): ../versions.js ───────────────────────────────────

/**
 * The `at` that freezes exactly what a build was made from: its source heads,
 * and every dependency it recorded by heads. Keyed dependencies are left out
 * (they have no heads; see normalizeAt) unless `keyedHeads` gives heads for
 * one. null when it was never built.
 * @param {object} builtFrom
 * @param {{ [url]: string[] }} [keyedHeads]  heads to fix a keyed dependency at
 */
export function atFromBuilt(builtFrom, keyedHeads = {}) {
  const heads = sortedHeads(builtFrom?.heads);
  if (!heads.length) return null;
  const deps = {};
  const recorded = normalizeDeps(builtFrom.deps);
  for (const url of Object.keys(recorded)) {
    const h = isFpKey(recorded[url]) ? sortedHeads(keyedHeads?.[url]) : recorded[url];
    if (h.length && !isFpKey(h)) deps[url] = h;
  }
  return { heads, deps };
}

// ─── provider versions ──────────────────────────────────────────────────────
// A provider may declare an integer `version` and bump it whenever build()
// would produce different output from the same inputs. builtFrom records it.
// Only a build by an OLDER version (or by one that declared none) is stale:
// a peer with an older provider installed leaves a newer build alone instead
// of rebuilding over it, so two versions can't ping-pong.

/** A provider version as an integer, or null if it doesn't declare a usable one. */
export function providerVersionOf(v) {
  const n = Number(v);
  return v != null && Number.isInteger(n) && n >= 0 ? n : null;
}

/** True when `current` is a version and what was built is older (or unversioned). */
export function olderVersion(built, current) {
  const cur = providerVersionOf(current);
  if (cur == null) return false;
  const b = providerVersionOf(built);
  return b == null || b < cur;
}

/**
 * What a build was made from, apart from the fingerprint: params, source heads
 * and dependency heads. Two builds with the same key read the very same docs
 * with the same params.
 */
export function builtInputsKey(builtFrom) {
  if (!builtFrom) return null;
  const deps = depsKey(builtFrom.deps);
  return `${builtFrom.paramsKey}|${sortedHeads(builtFrom.heads).join(",")}${deps ? `|d:${deps}` : ""}`;
}

/** builtInputsKey of what a build would record right now. */
export function currentInputsKey(render, source) {
  return builtInputsKey({ paramsKey: paramsKey(render?.params), heads: source?.heads, deps: source?.deps });
}

/**
 * True when a render is stale only by its fingerprint or its dependencies, and
 * what this client would build right now (params, source heads, dependency
 * heads) is exactly what it already built (`lastBuilt`, a builtInputsKey).
 * That means another peer rebuilt over us from a different view of the same
 * inputs: a different provider version or fingerprint scheme, a provider that
 * lists different dependencies, or dependency heads we don't have (yet).
 * Auto-rebuilding then would ping-pong between the two peers forever (or put
 * an older build over a newer one); the caller should leave it to a manual
 * rebuild. It stops being contested as soon as anything we read moves.
 */
export function isContested(render, source, lastBuilt) {
  const built = render?.builtFrom;
  if (!built || lastBuilt == null) return false;
  const reason = staleReason(render, source);
  if (reason !== "fingerprint" && reason !== "deps") return false;
  return currentInputsKey(render, source) === lastBuilt;
}

/**
 * Dependencies the render was built from (recorded with real heads) that this
 * client lists too but can't read: still on their first load, or failed to
 * load. Rebuilding over those would replace a build that had the dependency
 * with one that doesn't (and the peer that can read it would rebuild straight
 * back), so a "deps" staleness involving any of them is not auto-rebuilt.
 * @param {object} builtDeps          render.builtFrom.deps
 * @param {object} currentDeps        source.deps (this client's snapshot)
 * @param {(url: string) => boolean} isLoaded
 * @returns {string[]}
 */
export function heldDeps(builtDeps, currentDeps, isLoaded) {
  const built = normalizeDeps(builtDeps);
  const cur = normalizeDeps(currentDeps);
  return Object.keys(built).filter((u) => built[u].length > 0 && u in cur && !isLoaded(u));
}

export const DEBOUNCE = Object.freeze({ cheap: 150, expensive: 800 });

/**
 * How long to wait before rebuilding.
 *  - never built: build now (0)
 *  - params changed: cheap only if every changed key is marked cheap
 *  - source (or a dependency) changed: cheap only if the provider says so (an
 *    optional top-level `cost` on the provider), or every one of its params is cheap
 */
export function debounceFor(reason, { specs = [], providerCost, changed = [] } = {}) {
  if (reason === "never-built") return 0;
  const costOf = (key) => specs.find((s) => s.key === key)?.cost ?? "expensive";
  if (reason === "params") {
    const cheap = changed.length > 0 && changed.every((k) => costOf(k) === "cheap");
    return cheap ? DEBOUNCE.cheap : DEBOUNCE.expensive;
  }
  if (providerCost === "cheap") return DEBOUNCE.cheap;
  if (providerCost === "expensive") return DEBOUNCE.expensive;
  const cheap = specs.length > 0 && specs.every((s) => (s.cost ?? "expensive") === "cheap");
  return cheap ? DEBOUNCE.cheap : DEBOUNCE.expensive;
}

/**
 * A key for "these exact inputs": used to avoid retrying a build that already
 * failed until something it reads changes.
 */
export function inputsKey(render, source) {
  const fp = source?.fingerprint;
  const deps = depsKey(source?.deps);
  const v = providerVersionOf(source?.providerVersion);
  return `${paramsKey(render?.params)}|${fp != null ? `fp:${fp}` : `h:${sortedHeads(source?.heads).join(",")}`}${deps ? `|d:${deps}` : ""}${v != null ? `|v:${v}` : ""}`;
}
