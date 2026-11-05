import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import { FakeRepo, flush } from "../test/fake-repo.js";
import outline, { peerColor, peerMarks, readRowDrag, ROW_MIME } from "./outline.js";

// A stand-in for scene.sidebar: mounts every collected panel in a section of
// its own and updates them on every pass.
const sidebar = {
  create(api) {
    const edge = api.edge("right");
    const mounted = new Map();
    const sync = (scene, local) => {
      for (const { value } of api.collect("panels")) {
        for (const p of value ?? []) {
          if (mounted.has(p.id)) continue;
          const section = document.createElement("section");
          section.dataset.panel = p.id;
          edge.append(section);
          mounted.set(p.id, p.mount(section) ?? {});
        }
      }
      for (const m of mounted.values()) m.update?.(scene, local);
    };
    return {
      update: (scene, local) => sync(scene, local),
      dispose: () => {
        for (const m of mounted.values()) m.dispose?.();
      },
    };
  },
};

// A stand-in for scene.select's Remove command.
function fakeSelect(calls) {
  return {
    create: () => ({
      commands: [{ id: "remove", name: "Remove", state: (t, { scene }) => (t != null && scene.objects[t] ? {} : null), run: (t) => calls.push(t) }],
    }),
  };
}

const grp = (name, inGroup = null, extra = {}) => ({ kind: "group", name, group: inGroup, visible: true, opacity: 1, ...extra });
const leaf = (name, extra = {}) => object({ kind: "object", name, ...extra });

/**
 * vessel (group) ─┬─ body (group) ─┬─ hull
 *                 │                └─ deck
 *                 └─ bhd (hidden)
 * battery (group, hidden) ── cell
 */
function vessel() {
  const objects = {
    vessel: grp("Solander 38"),
    body: grp("BODY", "vessel"),
    hull: leaf("HULL", { group: "body" }),
    deck: leaf("DECK", { group: "body" }),
    bhd: leaf("console bhd", { group: "vessel", visible: false }),
    battery: grp("Battery (display)", null, { visible: false }),
    cell: leaf("CELL", { group: "battery" }),
  };
  return { objects, order: Object.keys(objects) };
}

let s = null;
async function mount(doc, { extra = [], repo } = {}) {
  const exts = [{ meta: { id: "scene.outline" }, module: outline }, { meta: { id: "t.sidebar" }, module: sidebar }, ...extra];
  s = await mountStage({
    repo,
    extensions: exts,
    doc,
  });
  return s;
}
const $ = (sel) => s.root.querySelector(sel);
const rows = () => [...s.root.querySelectorAll(".object-row")].map((r) => r.dataset.id);
const row = (id) => s.root.querySelector(`.object-row[data-id="${id}"]`);
const pass = () => settle(3);

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    localStorage.clear();
  } catch {
    // none
  }
});
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

describe("scene.outline", () => {
  it("is the sidebar's 'objects' panel", async () => {
    await mount(vessel());
    expect($('[data-panel="objects"] .object-list')).toBeTruthy();
    const panels = s.instance("scene.outline").panels;
    expect(panels.map((p) => [p.id, p.title])).toEqual([["objects", "Objects"]]);
  });

  it("roots open, deeper groups closed, per-viewer state in localStorage; ←/→ on a focused row", async () => {
    const doc = vessel();
    await mount(doc);
    expect(rows()).toEqual(["vessel", "body", "bhd", "battery"]);
    expect(row("vessel").getAttribute("aria-expanded")).toBe("true");
    expect(row("body").dataset.depth).toBe("1");
    row("body").querySelector(".twisty").click();
    expect(rows()).toEqual(["vessel", "body", "hull", "deck", "bhd", "battery"]);
    expect(JSON.parse(localStorage.getItem(`scene-outline:${s.handle.url}`))).toEqual({ body: true });
    expect(s.doc().objects.body).not.toHaveProperty("expanded"); // never in the doc
    row("vessel").querySelector(".row-main").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(rows()).toEqual(["vessel", "battery"]);
    // a second mount (same viewer, same scene) remembers
    const { repo, handle } = s;
    s.unmount();
    s = await mountStage({ repo, handle });
    // (handle given: the registry is the same as before)
    await pass();
    expect(rows()).toEqual(["vessel", "battery"]);
    row("vessel").querySelector(".row-main").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(rows()).toEqual(["vessel", "body", "hull", "deck", "bhd", "battery"]);
  });

  it("↑/↓ move focus between rows and don't reach the scene's keys", async () => {
    const keys = [];
    const keymap = { create: () => ({ input: { key: (ev) => (keys.push(ev.key), true) } }) };
    await mount(vessel(), { extra: [{ meta: { id: "t.keys" }, module: keymap }] });
    const main = row("vessel").querySelector(".row-main");
    main.focus();
    main.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(row("body").querySelector(".row-main"));
    expect(keys).toEqual([]);
  });

  it("a click selects (local.selected); the selection is marked", async () => {
    await mount(vessel());
    row("bhd").querySelector(".row-main").click();
    expect(s.local.get().selected).toBe("bhd");
    await pass();
    expect(row("bhd").hasAttribute("data-selected")).toBe(true);
    const framed = [];
    const api = s.api("scene.outline");
    api.camera = { ...api.camera, frame: (box) => framed.push(box) };
    api.groupBox = (id) => ({ min: [0, 0, 0], max: [1, 1, 1], id });
    row("battery").querySelector(".row-main").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(s.local.get().selected).toBe("battery");
    expect(framed).toEqual([{ min: [0, 0, 0], max: [1, 1, 1], id: "battery" }]); // a double-click frames it too
  });

  it("reveals a selection made elsewhere: its ancestors open", async () => {
    await mount(vessel());
    expect(row("hull")).toBeNull();
    s.local.swap((l) => ({ ...l, selected: "hull" }));
    await pass();
    expect(rows()).toEqual(["vessel", "body", "hull", "deck", "bhd", "battery"]);
    expect(row("hull").hasAttribute("data-selected")).toBe(true);
    // a selection that isn't an object (a dimension's ref) marks no row
    s.local.swap((l) => ({ ...l, selected: "dimension:d1" }));
    await pass();
    expect(s.root.querySelectorAll(".object-row[data-selected]").length).toBe(0);
  });

  it("shows the viewport's hover on its row", async () => {
    await mount(vessel());
    s.local.swap((l) => ({ ...l, hovered: "bhd" }));
    await pass();
    expect(row("bhd").hasAttribute("data-hover")).toBe(true);
    s.local.swap((l) => ({ ...l, hovered: "battery" }));
    await pass();
    expect(row("bhd").hasAttribute("data-hover")).toBe(false);
    expect(row("battery").hasAttribute("data-hover")).toBe(true);
  });

  it("a group's checkbox writes group.visible once and shows indeterminate when something below is hidden", async () => {
    await mount(vessel());
    const vis = row("vessel").querySelector('input[type="checkbox"]');
    expect(vis.checked).toBe(true);
    expect(vis.indeterminate).toBe(true); // bhd is hidden
    expect(row("body").querySelector('input[type="checkbox"]').indeterminate).toBe(false);
    let writes = 0;
    s.handle.on("change", () => writes++);
    vis.checked = false;
    vis.dispatchEvent(new Event("change"));
    expect(writes).toBe(1);
    expect(s.doc().objects.vessel.visible).toBe(false);
    expect(s.doc().objects.hull.visible).toBe(true); // children keep their own flags
    await pass();
    expect(row("body").hasAttribute("data-hidden")).toBe(true); // but read as hidden
    expect(row("battery").hasAttribute("data-hidden")).toBe(true);
    expect(row("battery").querySelector(".count").textContent).toBe("1");
  });

  it("keeps rows (and the colour input being dragged) across doc changes", async () => {
    await mount({ objects: { a: leaf("A") }, order: ["a"] });
    const swatch = row("a").querySelector(".swatch");
    expect(swatch.hasAttribute("data-auto")).toBe(true);
    swatch.value = "#ff0000";
    swatch.dispatchEvent(new Event("input"));
    expect(s.doc().objects.a.color).toBe("#ff0000");
    await pass();
    expect(row("a").querySelector(".swatch")).toBe(swatch);
    expect(swatch.hasAttribute("data-auto")).toBe(false);
    s.change((d) => (d.objects.a.name = "renamed"));
    await pass();
    expect(row("a").querySelector(".name").textContent).toBe("renamed");
    expect(row("a").querySelector(".swatch")).toBe(swatch);
  });

  it("shows names through lenses", async () => {
    const lens = { create: () => ({ looks: () => new Map([["a", { name: "Ace of spades" }]]) }) };
    await mount({ objects: { a: leaf("Card"), b: leaf("Card") }, order: ["a", "b"] }, { extra: [{ meta: { id: "t.lens" }, module: lens }] });
    await pass();
    expect(row("a").querySelector(".name").textContent).toBe("Ace of spades");
    expect(row("b").querySelector(".name").textContent).toBe("Card");
  });

  it("status pills come from local.status, never on groups", async () => {
    await mount(vessel());
    s.local.swap((l) => ({ ...l, status: { bhd: { state: "error", text: "error", title: "boom" }, vessel: { state: "loading", text: "loading" } } }));
    await pass();
    const pill = row("bhd").querySelector(".pill");
    expect(pill.textContent).toBe("error");
    expect(pill.dataset.state).toBe("error");
    expect(pill.title).toBe("boom");
    expect(row("vessel").querySelector(".pill")).toBeNull();
    s.local.swap((l) => ({ ...l, status: {} }));
    await pass();
    expect(row("bhd").querySelector(".pill")).toBeNull();
  });

  it("filters over name and path from 8 objects, with a count; Enter selects the first match, Esc clears", async () => {
    const doc = vessel();
    for (let i = 0; i < 6; i++) {
      doc.objects[`x${i}`] = leaf(`extra ${i}`, { group: "battery" });
      doc.order.push(`x${i}`);
    }
    await mount(doc);
    expect($(".outline-search").hidden).toBe(false);
    const input = $(".outline-filter");
    input.value = "body hul";
    input.dispatchEvent(new Event("input"));
    expect(rows()).toEqual(["vessel", "body", "hull"]);
    expect(row("vessel").hasAttribute("data-context")).toBe(true);
    expect(row("hull").hasAttribute("data-context")).toBe(false);
    expect($(".match-count").textContent).toBe("1 of 13");
    const framed = [];
    const api = s.api("scene.outline");
    api.camera = { ...api.camera, frame: (box) => framed.push(box) };
    api.box = (id) => ({ min: [0, 0, 0], max: [1, 1, 1], id });
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(s.local.get().selected).toBe("hull");
    expect(framed.map((b) => b.id)).toEqual(["hull"]); // and frames it
    await pass();
    expect(row("hull").hasAttribute("data-selected")).toBe(true);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(input.value).toBe("");
    expect(rows()).toEqual(["vessel", "body", "hull", "deck", "bhd", "battery"]); // body was revealed for the selection
    expect(s.local.get().selected).toBe("hull"); // Esc in the field doesn't deselect
    input.value = "nothing like it";
    input.dispatchEvent(new Event("input"));
    expect($(".object-list").textContent).toContain("No matches.");
  });

  it("hides the filter under 8 objects; an empty scene says so", async () => {
    await mount({ objects: {}, order: [] });
    expect($(".outline-search").hidden).toBe(true);
    expect($(".object-list").textContent).toContain("Nothing here yet.");
  });

  it("New group goes inside the selected group, opened and selected", async () => {
    await mount(vessel());
    s.local.swap((l) => ({ ...l, selected: "body" }));
    await pass();
    $(".new-group").click();
    const before = Object.keys(vessel().objects);
    const added = Object.keys(s.doc().objects).find((k) => !before.includes(k));
    expect(added).toMatch(/^g/);
    expect(s.doc().objects[added]).toEqual({ kind: "group", name: "Group", group: "body", visible: true, opacity: 1 });
    expect(s.local.get().selected).toBe(added);
    await pass();
    expect(row(added)).toBeTruthy(); // body opened to show it
    expect(JSON.parse(localStorage.getItem(`scene-outline:${s.handle.url}`))[added]).toBe(true);
  });

  it("Remove runs scene.select's command when it's running", async () => {
    const calls = [];
    await mount(vessel(), { extra: [{ meta: { id: "scene.select" }, module: fakeSelect(calls) }] });
    row("bhd").querySelector(".icon-button").click();
    expect(calls).toEqual(["bhd"]);
    expect(s.doc().objects.bhd).toBeTruthy();
  });

  it("without scene.select, Remove asks for a group with contents and goes through api.remove", async () => {
    await mount(vessel());
    const ask = vi.spyOn(globalThis, "confirm").mockReturnValue(false);
    row("vessel").querySelector(".icon-button").click();
    expect(ask).toHaveBeenCalledWith(expect.stringContaining("and the 4 objects in it"));
    expect(s.doc().objects.vessel).toBeTruthy();
    ask.mockReturnValue(true);
    row("vessel").querySelector(".icon-button").click();
    expect(Object.keys(s.doc().objects).sort()).toEqual(["battery", "cell"]);
    expect(s.doc().order).toEqual(["battery", "cell"]);
  });

  it("marks peers' selections and hovers in their colour", async () => {
    await mount(vessel());
    const say = (session, viewer, seq, keys) => s.handle.emit("ephemeral-message", { message: { type: "scene:presence", session, viewer, seq, at: 0, keys } });
    say("peer-1", "viewer:bob", 1, { "scene.select": { selected: "bhd", hovered: "battery" } });
    await pass();
    expect(row("bhd").hasAttribute("data-remote-selected")).toBe(true);
    expect(row("battery").hasAttribute("data-remote-hover")).toBe(true);
    const remote = s.local.get().theme?.remote;
    expect(row("bhd").style.getPropertyValue("--peer-colour")).toBe(peerColor(remote, "viewer:bob"));
    say("peer-1", "viewer:bob", 2, { "scene.select": { selected: null, hovered: null } });
    await pass();
    expect(row("bhd").hasAttribute("data-remote-selected")).toBe(false);
    expect(row("bhd").style.getPropertyValue("--peer-colour")).toBe("");
  });
});

describe("scene.outline: dragging rows", () => {
  // happy-dom has no layout: a row measures zero, so (clientY - top) / (height || 1)
  // is just clientY, which is how these choose a band.
  function atRow(id, fraction, e) {
    const r = row(id);
    expect(r, `no row for ${id}`).toBeTruthy();
    e.clientY = fraction;
    r.dispatchEvent(e);
    return e;
  }
  const rowDrag = (id, sceneUrl = s.handle.url) => {
    const e = new Event("drop", { bubbles: true, cancelable: true });
    const payload = JSON.stringify({ scene: sceneUrl, id });
    e.dataTransfer = { types: [ROW_MIME], files: [], getData: (t) => (t === ROW_MIME ? payload : "") };
    return e;
  };
  const notices = () => (s.local.get().notices ?? []).map((n) => n.text).join("\n");
  const leafAt = (name, { parent = null, group = null, x = 0 } = {}) => leaf(name, { parent, group, visible: false, transform: { position: [x, 0, 0], rotation: [0, 0, 0], scale: 1 } });

  it("the drag starts from the name, carrying this scene and the id", async () => {
    await mount({ objects: { a: leafAt("a") }, order: ["a"] });
    const data = {};
    const e = new Event("dragstart", { bubbles: true });
    e.dataTransfer = { setData: (t, v) => (data[t] = v) };
    row("a").querySelector(".row-main").dispatchEvent(e);
    expect(readRowDrag({ getData: (t) => data[t] })).toEqual({ scene: s.handle.url, id: "a" });
  });

  it("a dragged row carries its render doc (or GLB file) for other tools; a group carries only the row", async () => {
    const R = "automerge:2j9knn3DsFnFYDFvXkyMu4UHyp7u";
    const F = "automerge:3k9knn3DsFnFYDFvXkyMu4UHyp7u";
    await mount({ objects: { a: leafAt("a"), p: leaf("p", { sourceUrl: F, visible: false }), g: grp("G") }, order: ["a", "p", "g"] });
    s.change((d) => {
      d.objects.a.sourceUrl = F;
      d.objects.a.renderUrl = R;
    });
    await pass();
    const drag = (id) => {
      const data = {};
      const e = new Event("dragstart", { bubbles: true });
      e.dataTransfer = { setData: (t, v) => (data[t] = v), effectAllowed: "" };
      row(id).querySelector(".row-main").dispatchEvent(e);
      return { data, allowed: e.dataTransfer.effectAllowed };
    };
    const a = drag("a");
    expect(readRowDrag({ getData: (t) => a.data[t] })).toEqual({ scene: s.handle.url, id: "a" });
    expect(JSON.parse(a.data["text/x-patchwork-urls"])).toEqual([R]);
    expect(a.data["text/plain"]).toBe(R);
    expect(JSON.parse(a.data["text/x-patchwork-dnd"]).items[0]).toMatchObject({ url: R, type: "scene-render", name: "a" });
    expect(a.allowed).toBe("copyMove");
    const p = drag("p");
    expect(p.data["text/plain"]).toBe(F);
    expect(JSON.parse(p.data["text/x-patchwork-dnd"]).items[0].type).toBeUndefined();
    const g = drag("g");
    expect(Object.keys(g.data)).toEqual([ROW_MIME]);
    expect(g.allowed).toBe("move");
  });

  it("an object fixed at a version shows a ◷ fixed tag (display only)", async () => {
    const H = "MZke2MePENdwYFcp4a4Q61S1uEQtJDadpkQc9B6Q78CXrpy4q";
    await mount({ objects: { a: leafAt("a", {}), b: leafAt("b") }, order: ["a", "b"] });
    s.change((d) => {
      d.objects.a.renderUrl = "automerge:2j9knn3DsFnFYDFvXkyMu4UHyp7u";
      d.objects.a.at = { heads: [H] };
    });
    await pass();
    const mark = row("a").querySelector(".fixed-mark");
    expect(mark?.textContent).toBe("◷ fixed");
    expect(mark.title).toMatch(/^Fixed at version MZke2MeP;/);
    expect(row("b").querySelector(".fixed-mark")).toBeNull();
    s.change((d) => delete d.objects.a.at);
    await pass();
    expect(row("a").querySelector(".fixed-mark")).toBeNull();
  });

  it("onto a group files it there and moves nothing; out of its parent's rows it's detached, where it is", async () => {
    const hull = leafAt("hull", { x: 1 });
    hull.transform.scale = 2;
    await mount({ objects: { hull, cleat: leafAt("cleat", { parent: "hull", x: 1 }), g1: grp("G") }, order: ["hull", "cleat", "g1"] });
    atRow("g1", 0.5, rowDrag("hull"));
    expect(s.doc().objects.hull).toMatchObject({ group: "g1", parent: null });
    expect(s.doc().objects.hull.transform.position[0]).toBe(1);
    expect(s.local.get().selected).toBe("hull");
    await pass();
    atRow("g1", 0.5, rowDrag("cleat"));
    const c = s.doc().objects.cleat;
    expect(c).toMatchObject({ group: "g1", parent: null });
    expect(c.transform.position[0]).toBeCloseTo(3, 6);
    expect(c.transform.scale).toBeCloseTo(2, 6);
  });

  it("below an open group, a row goes in at the top", async () => {
    await mount({ objects: { g1: grp("G"), k: leafAt("k", { group: "g1" }), z: leafAt("z") }, order: ["g1", "k", "z"] });
    atRow("g1", 0.9, rowDrag("z"));
    expect(s.doc().objects.z.group).toBe("g1");
    expect(s.doc().order.indexOf("z")).toBeLessThan(s.doc().order.indexOf("k"));
  });

  it("refuses a row from another scene, or one that's gone, and writes nothing", async () => {
    await mount({ objects: { g1: grp("G"), o5: leafAt("o5") }, order: ["g1", "o5"] });
    const heads = s.handle.heads();
    atRow("g1", 0.5, rowDrag("o5", "automerge:someOtherScene"));
    expect(notices()).toMatch(/another scene/);
    atRow("g1", 0.5, rowDrag("gone"));
    expect(notices()).toMatch(/no longer in this scene/);
    expect(s.handle.heads()).toEqual(heads);
  });

  it("refuses a group inside its own child, and a group among an object's attachments", async () => {
    await mount({ objects: { g1: grp("G1"), g2: grp("G2", "g1"), hull: leafAt("hull"), cleat: leafAt("cleat", { parent: "hull" }) }, order: ["g1", "g2", "hull", "cleat"] });
    const heads = s.handle.heads();
    atRow("g2", 0.5, rowDrag("g1"));
    expect(notices()).toMatch(/inside itself/);
    atRow("cleat", 0.8, rowDrag("g1"));
    expect(notices()).toMatch(/only go inside another group/);
    expect(s.handle.heads()).toEqual(heads);
  });

  it("a row released where it already sits writes nothing; a reorder leaves the transform alone", async () => {
    await mount({ objects: { r: leafAt("r", { x: 1 }), x: leafAt("x"), t: leafAt("t", { x: 2 }) }, order: ["r", "x", "t"] });
    const heads = s.handle.heads();
    atRow("x", 0.2, rowDrag("x"));
    atRow("r", 0.8, rowDrag("x"));
    atRow("t", 0.2, rowDrag("x"));
    expect(s.handle.heads()).toEqual(heads);
    expect(s.local.get().selected).toBe("x"); // a wobbled click
    const before = JSON.stringify(s.doc().objects.t.transform);
    atRow("r", 0.2, rowDrag("t"));
    expect(s.doc().order).toEqual(["t", "r", "x"]);
    expect(JSON.stringify(s.doc().objects.t.transform)).toBe(before);
  });

  it("dragover marks the row with where the drop would go, and keeps it off the tool", async () => {
    await mount({ objects: { g1: grp("G") }, order: ["g1"] });
    let reached = false;
    s.root.addEventListener("dragover", () => (reached = true));
    const e = new Event("dragover", { bubbles: true, cancelable: true });
    e.dataTransfer = { types: [ROW_MIME], getData: () => "" };
    atRow("g1", 0.5, e);
    expect(row("g1").dataset.drop).toBe("into");
    expect(e.defaultPrevented).toBe(true);
    expect(reached).toBe(false);
  });
});

describe("scene.outline: dropping documents on rows", () => {
  const docDrop = (url) => {
    const e = new Event("drop", { bubbles: true, cancelable: true });
    e.dataTransfer = { types: ["text/plain"], files: [], getData: (t) => (t === "text/plain" ? url : "") };
    return e;
  };
  const atRow = (id, fraction, e) => {
    e.clientY = fraction;
    row(id).dispatchEvent(e);
  };
  const fileDoc = (repo) => repo.add({ "@patchwork": { type: "file" }, name: "part.glb", extension: "glb", mimeType: "model/gltf-binary", content: new Uint8Array(4) });

  it("onto a group: added inside it, selected and revealed", async () => {
    const repo = new FakeRepo();
    const file = fileDoc(repo);
    await mount({ objects: { g1: grp("G", null, { visible: true }), k: leaf("k", { group: "g1" }) }, order: ["g1", "k"] }, { repo });
    row("g1").querySelector(".twisty").click(); // fold it
    expect(row("k")).toBeNull();
    atRow("g1", 0.5, docDrop(file.url));
    await settle();
    const added = Object.keys(s.doc().objects).find((id) => !["g1", "k"].includes(id));
    expect(added, "nothing was added").toBeTruthy();
    expect(s.doc().objects[added]).toMatchObject({ group: "g1", sourceUrl: file.url });
    expect(s.local.get().selected).toBe(added);
    await pass();
    expect(row(added)).toBeTruthy();
  });

  it("beside an attached object: attached to the same parent, in front of it", async () => {
    const repo = new FakeRepo();
    const file = fileDoc(repo);
    await mount({ objects: { A: leaf("A"), B: leaf("B", { parent: "A" }) }, order: ["A", "B"] }, { repo });
    atRow("B", 0.2, docDrop(file.url));
    await settle();
    const added = Object.keys(s.doc().objects).find((id) => !["A", "B"].includes(id));
    expect(s.doc().objects[added].parent).toBe("A");
    expect(s.doc().order.indexOf(added)).toBe(s.doc().order.indexOf("B") - 1);
  });

  it("offers it to an extension that lays out its datatype first", async () => {
    const repo = new FakeRepo();
    const deck = repo.add({ "@patchwork": { type: "test-deck" } });
    const got = [];
    const layout = { create: () => ({}), drop: async (ctx, info) => (got.push(info), true) };
    await mount({ objects: { g1: grp("G") }, order: ["g1"] }, { repo, extra: [{ meta: { id: "t.deck", traits: ["test.deck"], drops: ["test-deck"] }, module: layout }] });
    atRow("g1", 0.5, docDrop(deck.url));
    await settle();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ url: deck.url, group: "g1", at: null });
    expect(Object.keys(s.doc().objects)).toEqual(["g1"]); // not added as an object
  });

  it("says why when nothing can show it", async () => {
    const repo = new FakeRepo();
    const todo = repo.add({ "@patchwork": { type: "todo" }, title: "x" });
    await mount({ objects: { g1: grp("G") }, order: ["g1"] }, { repo });
    atRow("g1", 0.5, docDrop(todo.url));
    await settle();
    expect((s.local.get().notices ?? []).map((n) => n.text).join()).toMatch(/No scene provider/);
  });
});

describe("outline helpers", () => {
  it("peerMarks: first peer by session wins a row; missing objects are ignored", () => {
    const peers = {
      b: { viewer: "v2", keys: { "scene.select": { selected: "x", hovered: "y" } } },
      a: { viewer: "v1", keys: { "scene.select": { selected: "x", hovered: "gone" } } },
    };
    const m = peerMarks(peers, [0.6, 0.4, 0.9], { x: {}, y: {} });
    expect(m.selected.get("x")).toBe(peerColor([0.6, 0.4, 0.9], "v1"));
    expect(m.hovered.get("y")).toBe(peerColor([0.6, 0.4, 0.9], "v2"));
    expect(m.hovered.has("gone")).toBe(false);
  });

  it("peerColor is stable per peer", () => {
    expect(peerColor(null, "viewer:bob")).toBe(peerColor(null, "viewer:bob"));
    expect(peerColor(null, "viewer:bob")).toMatch(/^rgb\(\d+ \d+ \d+\)$/);
  });

  it("readRowDrag reads only our payload", () => {
    expect(readRowDrag({ getData: () => "" })).toBeNull();
    expect(readRowDrag({ getData: () => "{bad" })).toBeNull();
    expect(readRowDrag({ getData: () => JSON.stringify({ id: "a" }) })).toEqual({ scene: null, id: "a" });
  });
});
