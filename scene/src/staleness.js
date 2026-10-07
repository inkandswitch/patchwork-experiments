// Staleness and build scheduling, per the scene contract. Pure; no automerge.

/** JSON.stringify with object keys sorted at every level. */
export function stableStringify(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (ArrayBuffer.isView(value)) return stableStringify(Array.from(value));
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/** paramsKey = stable JSON of params with sorted keys. */
export function paramsKey(params) {
  return stableStringify(params ?? {});
}

export function sortedHeads(heads) {
  return [...(heads ?? [])].map(String).sort();
}

export function sameHeads(a, b) {
  const x = sortedHeads(a);
  const y = sortedHeads(b);
  return x.length === y.length && x.every((h, i) => h === y[i]);
}

// ─── dependencies ───────────────────────────────────────────────────────────
// A provider's optional dependencies(doc) lists other docs its build() reads.
// builtFrom.deps records each one's sorted heads as read for that build:
// { [url]: string[] }. A dependency that isn't loaded counts as having no heads
// ([]), so a render built without it goes stale once it arrives. Old render
// docs have no `deps`; that reads as {}.

/** { url: sorted heads } from anything shaped like it; junk entries dropped. */
export function normalizeDeps(deps) {
  const out = {};
  if (!deps || typeof deps !== "object") return out;
  for (const url of Object.keys(deps).sort()) {
    const heads = deps[url];
    if (typeof url === "string" && url && (Array.isArray(heads) || heads == null)) out[url] = sortedHeads(heads);
  }
  return out;
}

/** Same dependency URLs, each at the same heads. */
export function sameDeps(a, b) {
  const x = normalizeDeps(a);
  const y = normalizeDeps(b);
  const kx = Object.keys(x);
  const ky = Object.keys(y);
  return kx.length === ky.length && kx.every((u, i) => u === ky[i] && sameHeads(x[u], y[u]));
}

/** A stable string for a deps map; "" when there are none. */
export function depsKey(deps) {
  const d = normalizeDeps(deps);
  return Object.keys(d)
    .map((u) => `${u}=${d[u].join(",")}`)
    .join(";");
}

/**
 * Why a render is stale, or null if it is fresh.
 * @param {object} render   the scene-render doc
 * @param {object} source   { heads: string[], fingerprint: string | null | undefined, deps?: { [url]: string[] } }
 *                          fingerprint undefined/null = provider has no fingerprint();
 *                          deps = current heads of each doc the provider says it reads (absent = none)
 * @returns {null | "never-built" | "params" | "fingerprint" | "heads" | "deps"}
 */
export function staleReason(render, source) {
  const built = render?.builtFrom;
  if (!built) return "never-built";
  if (built.paramsKey !== paramsKey(render.params)) return "params";
  const fp = source?.fingerprint;
  if (fp != null) {
    if (fp !== built.fingerprint) return "fingerprint";
  } else if (!sameHeads(source?.heads, built.heads)) {
    return "heads";
  }
  return sameDeps(source?.deps, built.deps) ? null : "deps";
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

export function isStale(render, source) {
  return staleReason(render, source) !== null;
}

/** Params with every ParamSpec default filled in (existing values win). */
export function withDefaults(specs, params) {
  const out = {};
  for (const spec of specs ?? []) {
    if (spec?.key && spec.default !== undefined) out[spec.key] = spec.default;
  }
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Just the defaults, for seeding a new render doc. */
export function defaultParams(specs) {
  return withDefaults(specs, {});
}

/** Keys whose values differ between two param objects. */
export function changedKeys(a, b) {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  return [...keys].filter((k) => stableStringify(a?.[k]) !== stableStringify(b?.[k]));
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
  return `${paramsKey(render?.params)}|${fp != null ? `fp:${fp}` : `h:${sortedHeads(source?.heads).join(",")}`}${deps ? `|d:${deps}` : ""}`;
}
