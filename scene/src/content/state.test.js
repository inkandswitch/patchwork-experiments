// An object's content state (README.md, "Content"; ./state.js): one value
// from what is known, a closed set of states, and what local.status says of
// each. Every reader takes this value; these are its cases.
import { describe, it, expect } from "vitest";
import { STATES, contentState, statusOf, wantsBuild } from "./state.js";
import { builtInputsKey, paramsKey } from "./staleness.js";

const H = ["h1"];
const builtFrom = (o = {}) => ({ heads: H, fingerprint: null, paramsKey: paramsKey({}), deps: {}, ...o });
const render = (o = {}) => ({ providerId: "p", params: {}, builtFrom: builtFrom(), pinned: false, status: "idle", ...o });
const source = (o = {}) => ({ heads: H, fingerprint: null, deps: {}, ...o });
const known = (o = {}) => ({ route: "built", render: render(), source: source(), building: null, behind: false, lastBuilt: null, deps: {}, failure: null, ...o });

describe("contentState: every state, and which wins", () => {
  const D = "automerge:dep";
  it.each([
    ["file loading", { route: "file", file: { phase: "parsing" } }, { state: "loading" }],
    ["file shown", { route: "file", file: { phase: "ready" } }, { state: "fresh" }],
    ["file that failed", { route: "file", file: { phase: "error", error: "x" } }, { state: "failed", in: "load", error: "x" }],
    ["file not asked for", { route: "file" }, null],
    ["a link (a stage draws it)", { route: "scene" }, null],
    ["nothing to load", { route: null }, null],
    ["routed nowhere: its provider isn't here", { route: null, missing: "q" }, { state: "no-provider", providerId: "q" }],
    ["render not loaded", known({ render: null }), { state: "loading" }],
    ["its documents couldn't be opened", known({ render: null, shownError: "Could not open" }), { state: "failed", in: "load" }],
    ["provider not installed", known({ providerMissing: true, source: null }), { state: "no-provider", providerId: "p" }],
    ["source not here", known({ source: null }), { state: "loading" }],
    ["its fixed version not here", known({ source: null, version: true }), { state: "loading", version: true }],
    ["fresh", known(), { state: "fresh" }],
    ["fresh, with an error left in the doc", known({ render: render({ status: "error", error: "old" }) }), { state: "fresh" }],
    ["built from changes not synced here", known({ source: source({ heads: ["h0"] }), behind: true }), { state: "fresh", behind: true }],
    ["never built", known({ render: render({ builtFrom: null }) }), { state: "stale", reason: "never-built", hold: null }],
    ["params moved", known({ render: render({ params: { a: 1 } }) }), { state: "stale", reason: "params", hold: null }],
    ["source moved", known({ source: source({ heads: ["h2"] }) }), { state: "stale", reason: "heads", hold: null }],
    ["source moved, pinned", known({ source: source({ heads: ["h2"] }), render: render({ pinned: true }) }), { state: "stale", reason: "heads", hold: "pinned" }],
    ["building here", known({ source: source({ heads: ["h2"] }), building: { by: "here" } }), { state: "building", by: "here" }],
    ["building wins over a failure", known({ source: source({ heads: ["h2"] }), building: { by: "b" }, failure: { error: "x" } }), { state: "building", by: "b" }],
    ["a build of these inputs failed", known({ source: source({ heads: ["h2"] }), failure: { error: "x", retryAt: 9 } }), { state: "failed", in: "build", error: "x", retryAt: 9 }],
    ["what was built can't be shown", known({ shownError: "bad GLB" }), { state: "failed", in: "load", error: "bad GLB" }],
    ["a dependency still on its first load", known({ source: source({ heads: ["h2"], deps: { [D]: [] } }), deps: { notReady: [D], loading: [D] } }), { state: "waiting", on: [D] }],
    ["built from a dependency not loaded here yet", known({ render: render({ builtFrom: builtFrom({ deps: { [D]: ["d1"] } }) }), source: source({ deps: { [D]: [] } }), deps: { notReady: [D] } }), { state: "waiting", on: [D] }],
    ["built from a dependency that can't be loaded here", known({ render: render({ builtFrom: builtFrom({ deps: { [D]: ["d1"] } }) }), source: source({ deps: { [D]: [] } }), deps: { notReady: [D], failed: [D] } }), { state: "stale", reason: "deps", hold: "unavailable" }],
    ["contested: the same inputs this replica built, judged otherwise by a peer's", known({ render: render({ builtFrom: builtFrom({ fingerprint: "theirs" }) }), source: source({ fingerprint: "mine" }), lastBuilt: builtInputsKey(builtFrom()) }), { state: "stale", reason: "fingerprint", hold: "contested" }],
  ])("%s", (_name, k, want) => {
    const st = contentState(k);
    if (want === null) return expect(st).toBeNull();
    expect(st).toMatchObject(want);
    expect(STATES).toContain(st.state);
    expect(Object.isFrozen(st)).toBe(true);
  });

  it("wants a build exactly when stale with nothing holding it back", () => {
    for (const st of [{ state: "stale", hold: null }, { state: "stale", hold: "pinned" }, { state: "fresh" }, { state: "waiting" }, { state: "building" }, null])
      expect(wantsBuild(st)).toBe(st?.state === "stale" && st.hold === null);
  });
});

describe("statusOf: what local.status says of each state", () => {
  it.each([
    [{ state: "loading" }, { state: "loading" }],
    [{ state: "no-provider", providerId: "p" }, { state: "warn", title: "Provider “p” is not installed" }],
    [{ state: "building", by: "here" }, { state: "building" }],
    [{ state: "failed", in: "build", error: "boom", retryAt: 5 }, { state: "error", title: "boom · retrying automatically" }],
    [{ state: "failed", in: "build", error: "boom", retryAt: null }, { state: "error", title: "boom" }],
    [{ state: "stale", reason: "heads", hold: null }, { state: "stale", reason: "out-of-date" }],
    [{ state: "stale", reason: "heads", hold: "pinned" }, { state: "stale", reason: "pinned" }],
    [{ state: "stale", reason: "fingerprint", hold: "contested" }, { state: "stale", reason: "contested" }],
    [{ state: "stale", reason: "deps", hold: "unavailable" }, { state: "stale", reason: "deps" }],
    [{ state: "waiting", on: ["u"] }, null],
    [{ state: "fresh" }, null],
    [null, null],
  ])("%j", (st, want) => {
    if (want === null) return expect(statusOf(st)).toBeNull();
    expect(statusOf(st)).toMatchObject(want);
  });
});
