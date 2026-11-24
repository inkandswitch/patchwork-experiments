// An object's content state (README.md, "Content"): the one definition of
// whether what is drawn for an object is built and current. A pure function
// of what is known of it; everything that shows freshness or acts on it (the
// render manager, api.content(id).state, local.status, the inspector, the build
// controls) reads this value and nothing else.

import { heldDeps, isContested, staleReason } from "./staleness.js";

/**
 * The states, a closed set:
 *   loading      its documents (or the fixed version it's read at: `version`) are on their way
 *   no-provider  the provider it names (`providerId`) isn't installed here
 *   building     a build is in progress (`by`: "here", or the builder's id); only a
 *                builder heard on the render's channel counts, never a status in the doc
 *   failed       it couldn't be built (`in: "build"`) or what it has couldn't be loaded or
 *                shown (`in: "load"`), with the `error`; `retrying`: it will be tried again
 *   waiting      it can't be judged or built until a linked document loads (`on`: their urls)
 *   stale        built from inputs other than the current ones (`reason`: "never-built",
 *                "params", "provider", "fingerprint", "heads" or "deps"); `hold` says why it
 *                won't be rebuilt on its own: "pinned", "contested" (a collaborator built the
 *                same inputs differently), "unavailable" (built from a document that can't
 *                be loaded here), or null (it will be)
 *   fresh        what is drawn is built from the current inputs, or from newer ones a
 *                peer has and this replica hasn't synced (`behind`)
 */
export const STATES = Object.freeze(["loading", "no-provider", "building", "failed", "waiting", "stale", "fresh"]);

const LOADING = Object.freeze({ state: "loading" });
const FRESH = Object.freeze({ state: "fresh" });
const freeze = (o) => Object.freeze(o);

/**
 * @param {object} k  what is known of the object:
 *   route        "built", "file", "scene" or null (content/providers.js routeOf)
 *   missing      the provider an unrouted object names, when it isn't installed
 *   file         a file's load, the GLB queue's word: { phase, error } (route "file")
 *   shownError   why its documents couldn't be opened, or the GLB it has loaded or parsed; or null
 *   render       the render doc, or null until it has loaded (route "built")
 *   providerMissing  the render doc names a provider that isn't installed
 *   source       { heads, fingerprint, deps, providerVersion } as build() would read it
 *                now, or null until the source (at its fixed version: `version`) is here
 *   version      waiting for a fixed version of the source to sync
 *   building     null, or { by }: who is building it
 *   behind       built from source (or dependency) changes this replica lacks
 *   lastBuilt    what this replica last built it from (staleness.js builtInputsKey), or null
 *   deps         { notReady: urls not loaded (or not at their fixed heads), failed: urls that
 *                failed to load, loading: urls on their first load within the wait }
 *   failure      null, or { error, retrying }: a build of the current inputs failed
 *   file.retrying  a file that couldn't be found is looked for again
 * @returns {object | null} the state, frozen; null: nothing to say (nothing to load, or not asked for)
 */
export function contentState(k) {
  if (k.route === "file") {
    if (k.file?.phase === "error") return freeze({ state: "failed", in: "load", error: k.file.error ?? null, retrying: !!k.file.retrying });
    if (k.shownError) return freeze({ state: "failed", in: "load", error: k.shownError, retrying: false });
    if (!k.file) return null;
    return k.file.phase === "ready" ? FRESH : LOADING;
  }
  if (k.route !== "built") return k.route == null && k.missing ? freeze({ state: "no-provider", providerId: k.missing }) : null;
  if (k.render && k.providerMissing) return freeze({ state: "no-provider", providerId: k.render.providerId ?? null });
  if (!k.render && k.shownError) return freeze({ state: "failed", in: "load", error: k.shownError, retrying: false });
  if (!k.render || !k.source) return k.version ? freeze({ state: "loading", version: true }) : LOADING;
  if (k.building) return freeze({ state: "building", by: k.building.by });
  if (k.shownError) return freeze({ state: "failed", in: "load", error: k.shownError, retrying: false });
  const reason = staleReason(k.render, k.source);
  if (!reason) return FRESH;
  if (k.behind) return freeze({ state: "fresh", behind: true });
  if (k.failure) return freeze({ state: "failed", in: "build", error: k.failure.error ?? null, retrying: !!k.failure.retrying });
  const deps = k.deps ?? {};
  const notReady = new Set(deps.notReady ?? []);
  const failed = new Set(deps.failed ?? []);
  const held = heldDeps(k.render.builtFrom?.deps, k.source.deps, (u) => !notReady.has(u));
  const pending = held.filter((u) => !failed.has(u));
  if (pending.length) return freeze({ state: "waiting", on: Object.freeze(pending) });
  const stale = (hold) => freeze({ state: "stale", reason, hold });
  if (held.length) return stale("unavailable");
  if (isContested(k.render, k.source, k.lastBuilt)) return stale("contested");
  if (k.render.pinned) return stale("pinned");
  if (deps.loading?.length) return freeze({ state: "waiting", on: Object.freeze([...deps.loading]) });
  return stale(null);
}

/** Does this state want a build of its own accord (stale, with nothing holding it back)? */
export const wantsBuild = (st) => st?.state === "stale" && st.hold == null;

const CONTESTED_TEXT = "A collaborator built it differently (another provider version, or linked documents at other versions)";

/**
 * A state as local.status says it to people: { state, reason?, text, title },
 * or null when there's nothing to say. `state` is "loading", "building",
 * "error", "warn" or "stale"; a stale one's `reason` ("deps", "contested",
 * "pinned", "out-of-date") is what code branches on. `writable`: may this
 * viewer rebuild it (else nothing is offered or promised).
 */
export function statusOf(st, { writable = true } = {}) {
  switch (st?.state) {
    case "loading":
      return { state: "loading", text: "loading", title: "Loading…" };
    case "no-provider":
      return { state: "warn", text: "no provider", title: `Provider “${st.providerId}” is not installed` };
    case "building":
      return { state: "building", text: "building", title: "Rebuilding…" };
    case "failed":
      return { state: "error", text: "error", title: st.retrying ? `${st.error} · retrying automatically` : st.error };
    case "stale":
      if (st.hold === "unavailable") return { state: "stale", reason: "deps", text: "stale", title: `Built from a linked document that can't be loaded here${writable ? "; Rebuild to build without it" : ""}` };
      if (st.hold === "contested") return { state: "stale", reason: "contested", text: "stale", title: `${CONTESTED_TEXT}${writable ? "; Rebuild to use yours" : ""}` };
      if (st.hold === "pinned") return { state: "stale", reason: "pinned", text: "pinned", title: "Out of date; pinned, so it won't rebuild on its own" };
      return { state: "stale", reason: "out-of-date", text: "stale", title: writable ? "Out of date; rebuilding soon" : "Out of date" };
    default:
      return null;
  }
}
