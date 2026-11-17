import { describe, it, expect, vi, afterEach } from "vitest";
import { fakeUrl } from "../test/fake-repo.js";
import { resolveParents } from "../hierarchy.js";
import { resolveGroups } from "../groups.js";
import { CONTROLS_TOOL, commandsFor, documentsFor, inspectorDocuments } from "./inspector-model.js";
import { plugins } from "../index.js";

// The inspector's documents (STAGE.md, "The interface"): every related
// document of an object is a section, and documentsFor is the one rule for
// which sections show, in which order.

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

describe("documentsFor's sources: one doc, three sections, each its own fold", () => {
  const U = fakeUrl();
  const scene = snap({ x: obj({ sourceUrl: U }) });
  // what the stage routed x to → the one section its source is (a section is its extension and id)
  const ROUTED = [
    ["built", "source", "Source", false],
    ["file", "file", "File", true],
    ["scene", "link", "Linked scene", true],
    [null, "source", "Source", true],
  ];
  it.each(ROUTED)("routed to %s → %s (%s, folded %s)", (kind, id, label, folded) => {
    const own = inspectorDocuments(() => kind);
    expect(documentsFor(own, "x", { scene }, ME).map((d) => [d.id, d.label, d.folded])).toEqual([[id, label, folded]]);
  });
});

describe("commandsFor: what's contributed", () => {
  it("a command whose state throws doesn't apply, and says so", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const boom = () => {
      throw new Error("boom");
    };
    const commands = [{ id: "t.x", value: [{ id: "bad", run() {}, state: boom }, { id: "ok", run() {}, state: () => ({}) }] }];
    expect(commandsFor(commands, "x", {}, null).map((c) => c.command.id)).toEqual(["ok"]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("the build controls' tool id", () => {
  it("is the one this package registers the controls under (src/index.js)", () => {
    const tool = plugins.find((p) => p.type === "patchwork:tool" && p.id === CONTROLS_TOOL);
    expect(tool?.supportedDatatypes).toEqual(["scene-render"]);
  });
});
