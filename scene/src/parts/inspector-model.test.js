import { describe, it, expect } from "vitest";
import { fakeUrl } from "../test/fake-repo.js";
import { resolveParents } from "../hierarchy.js";
import { resolveGroups } from "../groups.js";
import { CONTROLS_TOOL, documentsFor, inspectorDocuments, ago, buildSummary } from "./inspector-model.js";

// The inspector's documents (EDITOR.md, "The interface"): every related
// document of an object is a section, and documentsFor is the one rule for
// which sections show, in which order.

const ME = "scene.inspector";
const snap = (objects) => ({ objects, ids: Object.keys(objects), parents: resolveParents(objects), groups: resolveGroups(objects) });
const obj = (extra = {}) => ({ name: "Object", sourceUrl: null, renderUrl: null, parent: null, group: null, visible: true, ...extra });
const grp = (name, extra = {}) => ({ kind: "group", name, group: null, visible: true, opacity: 1, ...extra });

describe("documentsFor: the inspector's own documents, by kind of selection", () => {
  const SRC = fakeUrl();
  const RENDER = fakeUrl();
  const GLB = fakeUrl();
  const LINKED = fakeUrl();
  const GINFO = fakeUrl();
  const OWNINFO = fakeUrl();
  const scene = snap({
    built: obj({ name: "Built", sourceUrl: SRC, renderUrl: RENDER }),
    file: obj({ name: "File", sourceUrl: GLB }),
    link: obj({ name: "Link", sourceUrl: LINKED, providerId: "scene.link" }),
    plain: grp("Plain"),
    info: grp("Boat", { infoUrl: GINFO }),
    inInfo: obj({ name: "Hull", group: "info" }),
    ownInfo: obj({ name: "Cleat", infoUrl: OWNINFO }),
  });
  // what the stage routed each to (api.loadState(id).content)
  const routed = { built: "built", file: "file", link: "scene" };
  const own = inspectorDocuments((id) => routed[id] ?? null);
  const shown = (target) => documentsFor(own, target, { scene }, ME).map((d) => [d.id, d.label, d.folded, d.url, d.toolId]);

  // kind → [(id, label, folded, url, toolId)], in order
  const TABLE = [
    ["built (sourceUrl + renderUrl)", "built", [["source", "Source", false, SRC, null], ["build", "Build", false, RENDER, CONTROLS_TOOL]]],
    ["a GLB file", "file", [["file", "File", true, GLB, null]]],
    ["a link (content scene)", "link", [["link", "Linked scene", true, LINKED, null]]],
    ["a plain group", "plain", []],
    ["a group with an infoUrl", "info", [["about", "About", false, GINFO, null]]],
    ["an object in a group with an infoUrl", "inInfo", [["about", "About Boat", false, GINFO, null]]],
    ["an object with its own infoUrl", "ownInfo", [["about", "About", false, OWNINFO, null]]],
    ["nothing selected", null, []],
  ];
  it.each(TABLE)("%s", (_name, target, want) => {
    expect(shown(target)).toEqual(want);
  });

  it("a source the stage routed nowhere (its provider isn't installed) is a folded Source", () => {
    const none = inspectorDocuments(() => null);
    expect(documentsFor(none, "built", { scene }, ME).map((d) => [d.id, d.label, d.folded])).toEqual([["source", "Source", true], ["build", "Build", false]]);
  });
});

describe("buildSummary: a built object's build in a line", () => {
  const NOW = 10_000_000;
  const built = (o) => ({ content: "built", builtAt: NOW - 120_000, state: { state: "fresh" }, ...o });
  const stale = { state: "stale", reason: "heads", hold: null };
  it.each([
    ["a file isn't built", { content: "file" }, null],
    ["a link isn't built", { content: "scene" }, null],
    ["no load state", null, null],
    ["a missing provider is the status line's", built({ state: { state: "no-provider", providerId: "p" } }), null],
    ["building", built({ state: { state: "building", by: "here" } }), "Building…"],
    ["never built", built({ builtAt: null, state: { ...stale, reason: "never-built" } }), "Not built yet"],
    ["never built, pinned", built({ builtAt: null, pinned: true, state: { ...stale, reason: "never-built", hold: "pinned" } }), "Not built (pinned)"],
    ["up to date", built({}), "Up to date · built 2 min ago"],
    ["out of date", built({ state: stale }), "Built 2 min ago · out of date"],
    ["out of date, pinned", built({ pinned: true, state: { ...stale, hold: "pinned" } }), "Built 2 min ago · out of date (pinned)"],
    ["fixed (never out of date)", built({ at: { heads: ["h"], deps: {} }, state: stale }), "Built 2 min ago · fixed version"],
  ])("%s", (_name, load, want) => {
    expect(buildSummary(load, NOW)).toBe(want);
  });
  it("ago: each unit at its edges", () => {
    const at = (ms) => ago(0, ms);
    // (rounded to the nearest second, then minute, hour and day)
    expect([at(0), at(4_499), at(4_500), at(59_499), at(59_500), at(60 * 60_000 - 31_000), at(60 * 60_000 - 30_000), at(47 * 3_600_000), at(48 * 3_600_000)]).toEqual(["just now", "just now", "5 s ago", "59 s ago", "1 min ago", "59 min ago", "1 h ago", "47 h ago", "2 days ago"]);
    expect(ago(1000, 0)).toBe("just now"); // a clock behind: never negative
  });
});
