import { describe, it, expect, vi, afterEach } from "vitest";
import { fakeUrl } from "../test/fake-repo.js";
import { resolveParents } from "../hierarchy.js";
import { resolveGroups } from "../groups.js";
import { CONTROLS_TOOL, documentsFor, inspectorDocuments } from "./inspector-model.js";

// The inspector's documents (STAGE.md "A document"; TOOLS.md §6): every
// related document of an object is a section, and documentsFor is the one
// rule for which sections show, in which order.

const ME = "scene.inspector";
const snap = (objects) => ({ objects, ids: Object.keys(objects), parents: resolveParents(objects), groups: resolveGroups(objects) });
const obj = (extra = {}) => ({ name: "Object", sourceUrl: null, renderUrl: null, parent: null, group: null, visible: true, ...extra });
const grp = (name, extra = {}) => ({ kind: "group", name, group: null, visible: true, opacity: 1, ...extra });

afterEach(() => vi.restoreAllMocks());

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
  const own = [{ id: ME, value: inspectorDocuments((id) => routed[id] ?? null) }];
  const shown = (target) => documentsFor(own, target, { scene }, ME).map((d) => [d.id, d.label, d.folded, d.url, d.toolId]);

  // kind → [(id, label, folded, url, toolId)], in order
  const TABLE = [
    ["built (sourceUrl + renderUrl)", "built", [["source", "Source", false, SRC, null], ["build", "Build", false, RENDER, CONTROLS_TOOL]]],
    ["a GLB file", "file", [["source", "File", true, GLB, null]]],
    ["a link (content scene)", "link", [["source", "Linked scene", true, LINKED, null]]],
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
    const none = [{ id: ME, value: inspectorDocuments(() => null) }];
    expect(documentsFor(none, "built", { scene }, ME).map((d) => [d.id, d.label, d.folded])).toEqual([["source", "Source", true], ["build", "Build", false]]);
  });
});

describe("documentsFor: what another extension contributes", () => {
  const A = fakeUrl();
  const B = fakeUrl();
  const scene = snap({ x: obj({ name: "X", sourceUrl: A }) });
  const own = { id: ME, value: inspectorDocuments((id) => (id === "x" ? "built" : null)) };
  // one entry from a second extension, given what its state answers
  const other = (state) => ({ id: "t.other", value: [{ id: "doc", name: "Other", state }] });
  const keys = (list) => list.map((d) => `${d.ext}/${d.id}`);

  // contribution → what the inspector shows for x (or, last row, for the scene)
  const TABLE = [
    ["returns null", () => null, "x", [`${ME}/source`]],
    ['a url that isn\'t automerge ("https://x")', () => ({ url: "https://x" }), "x", [`${ME}/source`]],
    ["state throws (warned, dropped)", () => { throw new Error("boom"); }, "x", [`${ME}/source`]],
    ["the same url and tool as the inspector's Source (the first one stays)", () => ({ url: A }), "x", [`${ME}/source`]],
    ["a valid doc on target null (the scene)", (t) => (t == null ? { url: B, toolId: "notes" } : null), null, ["t.other/doc"]],
  ];
  it.each(TABLE)("%s", (_name, state, target, want) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // the other extension runs first: the inspector's own still come first
    const list = documentsFor([other(state), own], target, { scene }, ME);
    expect(keys(list)).toEqual(want);
    expect(warn).toHaveBeenCalledTimes(_name.startsWith("state throws") ? 1 : 0);
  });

  it("the same url in another tool is another section; the inspector's own come first, then running order", () => {
    const t1 = { id: "t.one", value: [{ id: "a", state: () => ({ url: A, toolId: "markdown" }) }] };
    const t2 = { id: "t.two", value: [{ id: "b", name: "Notes", state: () => ({ url: B, folded: true }) }] };
    const list = documentsFor([t1, own, t2], "x", { scene }, ME);
    expect(list.map((d) => [d.ext, d.id, d.label, d.url, d.toolId, d.folded])).toEqual([
      [ME, "source", "Source", A, null, false],
      ["t.one", "a", "a", A, "markdown", false],
      ["t.two", "b", "Notes", B, null, true],
    ]);
  });

  it("a url is normalised (heads dropped) before it's compared", () => {
    const t1 = { id: "t.one", value: [{ id: "a", state: () => ({ url: `${A}#abc` }) }] };
    expect(keys(documentsFor([own, t1], "x", { scene }, ME))).toEqual([`${ME}/source`]);
  });
});
