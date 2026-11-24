// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import { getRegistry } from "../test/plugins-mock.js";
import { FakeRepo, fakeUrl } from "../test/fake-repo.js";
import { manualTime } from "../stage/time.js";
import { applyMatrix } from "../transform.js";
import { worldMatrix } from "../hierarchy.js";
import inspector from "./inspector.js";
import { editing } from "./editing.js";
import add from "./add.js";
import { openTabs } from "../test/tabs.js";
import { aboutFor, attachOptions, groupOptions, statusParts } from "./inspector-model.js";
import { SECTION_MIME } from "../dnd.js";
import { LINK } from "../native/link-graph.js";
import { emptyScene } from "../test/empty-scene.js";
import { resolveParents } from "../hierarchy.js";
import { resolveGroups } from "../groups.js";
import { sanitizeLayers } from "../layers.js";

const INSPECTOR = { meta: { id: "scene.inspector" }, module: inspector };

// The viewer opened the Inspector from the toolbar: it stays open, on the
// scene with nothing selected (how it follows the selection on its own is
// its own test, below).
const OPENED = openTabs(["scene.inspector:inspector"], { once: true });

const group = (name, parent = null, extra = {}) => ({ kind: "group", name, group: parent, visible: true, opacity: 1, ...extra });
const T = (position = [0, 0, 0], rotation = [0, 0, 0], scale = 1) => ({ position, rotation, scale });

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

// a stand-in for the host's embed element, which the sections use when it's there. Patchwork's mounts its tool
// when it's put in the page and unmounts it when it's taken out (a move by moveBefore keeps it): this one logs both
const embedLog = [];
beforeAll(() => {
  customElements.define(
    "patchwork-view",
    class extends HTMLElement {
      connectedCallback() {
        embedLog.push(["mount", this.getAttribute("doc-url")]);
      }
      disconnectedCallback() {
        embedLog.push(["unmount", this.getAttribute("doc-url")]);
      }
    },
  );
});

async function mount({ objects, extensions = [], doc = {}, repo } = {}) {
  s = await mountStage({ editor: true, natives: true, 
    repo,
    extensions: [INSPECTOR, OPENED, ...extensions],
    doc: { objects, order: Object.keys(objects), ...doc },
  });
  return s;
}

/** The Inspector pane's fields, below its tree (open: the viewer asked for it) */
const body = () => s.instance("scene.inspector").tab.body.querySelector(".inspector-body");
const $ = (sel) => body().querySelector(sel);
/** Run one of the inspector's own commands on a target, as the menu does */
const run = (command, target) => s.api("scene.inspector").run({ ext: "scene.inspector", command, target });
/** The inspector's commands that apply to a target, by name (the menu's, now: no buttons here) */
const applies = (command, target) => !!s.instance("scene.inspector").commands.find((c) => c.id === command)?.state(target, { scene: s.facet("scene.inspector").scene() });
async function select(id) {
  s.local.swap((m) => ({ ...m, selected: id }));
  await settle();
}
const fire = (input, value, type = "change") => {
  if (input.type === "checkbox") input.checked = value;
  else input.value = value;
  input.dispatchEvent(new Event(type, { bubbles: true }));
};

describe("scene.inspector: layers", () => {
  // what the viewport says boat's GLB is: hull, deck in it, rig hidden in the file
  const TABLE = sanitizeLayers([{ id: "hull", name: "Hull" }, { id: "deck", name: "Deck", parent: "hull" }, { id: "rig", name: "Rig", visible: false }]);
  async function mountBoat(extra = {}) {
    await mount({ objects: { boat: object({ name: "Boat", ...extra }), plain: object({ name: "Plain" }) } });
    const real = s.debug.viewport.contentOf.bind(s.debug.viewport);
    s.debug.viewport.contentOf = (key) =>
      String(key).endsWith("boat") ? { loaded: true, box: null, extras: { layers: TABLE }, stats: { triangles: 12, drawCalls: 3, instanced: 0 }, root: null } : real(key);
    await select("boat");
  }
  const rows = () => [...body().querySelectorAll(".layers .layer")].map((r) => `${"  ".repeat(Number(r.style.getPropertyValue("--depth")))}${r.querySelector("input").checked ? "x" : "_"} ${r.textContent}${r.dataset.shown === "false" ? " (hidden)" : ""}`);
  const box = (name) => [...body().querySelectorAll(".layers .layer")].find((r) => r.textContent === name).querySelector("input");

  it("lists the GLB's layers as a tree, ticked as the file shows them", async () => {
    await mountBoat();
    expect(rows()).toEqual(["x Hull", "  x Deck", "_ Rig (hidden)"]);
    expect($(".layers-reset").hidden).toBe(true);
  });

  it("writes one layer's choice; a hidden parent dims what's in it; Reset drops them all", async () => {
    await mountBoat();
    fire(box("Hull"), false);
    await settle();
    expect({ ...s.doc().objects.boat.layers }).toEqual({ hull: false });
    expect(rows()).toEqual(["_ Hull (hidden)", "  x Deck (hidden)", "_ Rig (hidden)"]);
    fire(box("Rig"), true);
    await settle();
    expect({ ...s.doc().objects.boat.layers }).toEqual({ hull: false, rig: true });
    expect($(".layers-reset").hidden).toBe(false);
    $(".layers-reset").click();
    await settle();
    expect("layers" in s.doc().objects.boat).toBe(false);
    expect(rows()).toEqual(["x Hull", "  x Deck", "_ Rig (hidden)"]);
  });

  it("drops a choice that goes back to what the file says, rather than keeping it", async () => {
    await mountBoat({ layers: { rig: true } });
    fire(box("Rig"), false);
    await settle();
    expect("layers" in s.doc().objects.boat).toBe(false);
  });
});

describe("scene.inspector: the panel", () => {
  it("shows the scene when nothing is selected, the selection when there is one, and hides for a ref", async () => {
    await mount({ objects: { a: object({ name: "A", opacity: 0.5, color: "#ff0000", wireframe: true }) } });
    expect(body().hidden).toBe(false);
    expect($(".inspector").dataset.kind).toBe("scene");
    expect($(".inspector-kind").textContent).toBe("Scene");
    await select("a");
    expect(body().hidden).toBe(false);
    // what it is: its source's provider (the harness's objects are GLB files)
    expect($(".inspector-kind").textContent).toBe("GLB file");
    expect($(".name-input").value).toBe("A");
    expect($(".name-input").readOnly).toBe(false);
    expect($(".opacity").value).toBe("0.5");
    expect($(".color").value).toBe("#ff0000");
    expect($(".wireframe").checked).toBe(true);
    expect($(".visible").checked).toBe(true);
    expect(body().textContent).not.toMatch(/null|undefined/);
    // a selection that isn't an object (a dimension's ref): nothing to inspect
    await select("dimension:d1");
    expect(body().hidden).toBe(true);
    expect(body().textContent).toBe("Nothing selected");
    await select("a");
    expect(body().hidden).toBe(false);
    // the object goes while selected: the panel empties
    s.change((d) => delete d.objects.a);
    await settle();
    expect(body().hidden).toBe(true);
    expect(body().textContent).toBe("Nothing selected");
    // and with nothing selected it's the scene again
    await select(null);
    expect(body().hidden).toBe(false);
    expect($(".inspector").dataset.kind).toBe("scene");
  });

  it("writes plain fields through ops: name, visible, wireframe, locked, colour (and Auto), opacity", async () => {
    await mount({ objects: { a: object({ name: "A" }) } });
    await select("a");
    fire($(".name-input"), "Hull");
    fire($(".visible"), false);
    fire($(".wireframe"), true);
    fire($(".locked"), true);
    fire($(".color"), "#00ff00", "input");
    fire($(".opacity"), "0.25", "input");
    let a = s.doc().objects.a;
    expect(a).toMatchObject({ name: "Hull", visible: false, wireframe: true, locked: true, color: "#00ff00", opacity: 0.25 });
    $(".auto-color").click();
    a = s.doc().objects.a;
    expect(a.color).toBeNull();
  });

  it("doesn't overwrite a field being typed in", async () => {
    await mount({ objects: { a: object({ name: "A" }) } });
    await select("a");
    const name = $(".name-input");
    name.focus();
    name.value = "Typ";
    s.change((d) => (d.objects.a.opacity = 0.3));
    await settle();
    expect(name.value).toBe("Typ");
    expect($(".opacity").value).toBe("0.3");
  });

  it("position is in the display units (the pref), rotation in degrees; edits write one number", async () => {
    await mount({ objects: { a: object({ name: "A", transform: T([0.25, 0, 0], [0, Math.PI / 2, 0], 2) }) } });
    await select("a");
    const [x, y] = body().querySelectorAll(".triple")[0].querySelectorAll("input");
    expect(x.value).toBe("0.25");
    expect($(".unit").textContent).toBe("(m)");
    s.api("scene.inspector").use("prefs").set("units", "mm");
    await settle();
    expect(x.value).toBe("250");
    expect($(".unit").textContent).toBe("(mm)");
    fire(x, "100");
    expect(s.doc().objects.a.transform.position[0]).toBeCloseTo(0.1);
    fire(y, "5");
    expect(s.doc().objects.a.transform.position[1]).toBeCloseTo(0.005);
    const rot = body().querySelectorAll(".triple")[1].querySelectorAll("input");
    expect(rot[1].value).toBe("90");
    fire(rot[2], "45");
    expect(s.doc().objects.a.transform.rotation[2]).toBeCloseTo(Math.PI / 4);
    const scale = body().querySelectorAll(".triple")[2].querySelector("input");
    expect(scale.value).toBe("2");
    fire(scale, "0");
    expect(s.doc().objects.a.transform.scale).toBe(1); // not above zero: 1
    // nothing typed: the field shows the doc again
    fire(x, "");
    expect(x.value).toBe("100");
  });

  it("attaches without moving it, and says 'relative to' its parent", async () => {
    await mount({
      objects: {
        a: object({ name: "A", transform: T([1, 0, 0], [0, Math.PI / 2, 0], 2) }),
        b: object({ name: "B", transform: T([1, 0, -2]) }),
      },
    });
    await select("b");
    const attach = $("select.attach");
    expect([...attach.options].map((o) => o.value)).toEqual(["", "a"]);
    expect(attach.value).toBe("");
    fire(attach, "a");
    const ob = s.doc().objects.b;
    expect(ob.parent).toBe("a");
    ob.transform.position.forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0][i], 9));
    ob.transform.rotation.forEach((v, i) => expect(v).toBeCloseTo([0, -Math.PI / 2, 0][i], 9));
    expect(ob.transform.scale).toBeCloseTo(0.5, 9);
    await settle();
    expect($(".unit").textContent).toBe("(m, relative to A)");
    // a can't be attached to b now
    await select("a");
    expect([...$("select.attach").options].map((o) => o.value)).toEqual([""]);
  });

  it("'In group' lists the groups as a tree; filing moves nothing; a refusal is said and the field reverts", async () => {
    const objects = {
      vessel: group("Solander 38"),
      body: group("BODY", "vessel"),
      hull: object({ name: "HULL", group: "body", transform: T([1, 2, 3]) }),
      battery: group("battery", "vessel"),
      bhd: object({ name: "BHD", group: "vessel", transform: T([0, 1, 0]) }),
    };
    await mount({ objects });
    await select("bhd");
    const inGroup = $("select.in-group");
    expect([...inGroup.options].map((o) => o.value)).toEqual(["", "vessel", "body", "battery"]);
    expect(inGroup.querySelector('option[value="body"]').textContent).toMatch(/^\s+BODY$/);
    expect(inGroup.value).toBe("vessel");
    expect([...$("select.attach").options].map((o) => o.value).sort()).toEqual(["", "hull"]);
    const before = applyMatrix(worldMatrix(s.doc().objects, "bhd"), [0, 0, 0]);
    fire(inGroup, "battery");
    expect(s.doc().objects.bhd.group).toBe("battery");
    applyMatrix(worldMatrix(s.doc().objects, "bhd"), [0, 0, 0]).forEach((v, i) => expect(v).toBeCloseTo(before[i], 9));

    // a group can't go in itself (not offered; forced here, as a stale list would)
    await select("vessel");
    const gsel = $("select.in-group");
    expect([...gsel.options].map((o) => o.value)).toEqual([""]);
    const forced = document.createElement("option");
    forced.value = "body";
    forced.textContent = "BODY";
    gsel.append(forced);
    fire(gsel, "body");
    expect(s.doc().objects.vessel.group).toBeNull();
    expect(gsel.value).toBe("");
    expect(s.notices().at(-1)).toMatchObject({ text: "A group can't go inside itself.", kind: "error" });
  });

  it("a group shows name, visible, opacity and its group, no attach or transform; Ungroup keeps members where they are", async () => {
    const objects = {
      vessel: group("Solander 38"),
      body: group("BODY", "vessel", { opacity: 0.5 }),
      hull: object({ name: "HULL", group: "body", transform: T([1, 2, 3]) }),
    };
    await mount({ objects });
    await select("body");
    expect($(".inspector-kind").textContent).toBe("Group");
    expect($("select.attach")).toBeNull();
    expect($(".triple")).toBeNull();
    expect($(".wireframe")).toBeNull();
    expect($(".color")).toBeNull();
    expect($(".opacity").value).toBe("0.5");
    expect(applies("group", "body")).toBe(false);
    run("ungroup", "body");
    const o = s.doc().objects;
    expect(o.body).toBeUndefined();
    expect(o.hull.group).toBe("vessel");
    expect(o.hull.opacity).toBe(0.5); // the group's fade folded in
    expect(s.local.get().selected).toBeNull();
    await settle();
    expect($(".inspector").dataset.kind).toBe("scene");
  });

  it("Frame fits the camera to the object's box", async () => {
    await mount({ objects: { a: object({ name: "A" }) } });
    await select("a");
    const api = s.facet("scene.inspector");
    const framed = [];
    api.box = () => ({ min: [0, 0, 0], max: [1, 1, 1] });
    vi.spyOn(s.debug.viewport, "frame").mockImplementation((b) => framed.push(b));
    run("frame", "a");
    expect(framed).toEqual([{ min: [0, 0, 0], max: [1, 1, 1] }]);
  });

  it("a displayed name is shown read-only, never written back", async () => {
    const lens = { meta: { id: "t.lens" }, module: { create: (api) => (api.display("a", { name: "Secret" }), {}) } };
    await mount({ objects: { a: object({ name: "Card" }), b: object({ name: "B" }) }, extensions: [lens] });
    await select("a");
    await settle();
    const name = $(".name-input");
    expect(name.value).toBe("Secret");
    expect(name.readOnly).toBe(true);
    fire(name, "Other");
    expect(s.doc().objects.a.name).toBe("Card");
    await select("b");
    expect($(".name-input").readOnly).toBe(false);
  });

  it("a GLB file object (content \"file\"): its stats in the status line", async () => {
    const repo = new FakeRepo();
    const file = repo.add({ "@patchwork": { type: "file" }, name: "hull.glb", extension: "glb" });
    await mount({ repo, objects: { a: object({ name: "A", sourceUrl: file.url, visible: false, hint: { triangles: 434, bytes: 18492 } }) } });
    await select("a");
    expect($(".status-line").textContent).toBe("434 triangles · 18 KB · not loaded (hidden)");
  });
});

describe("scene.inspector: an object's parts and its documents, a row each (PLANS.md §5)", () => {
  const ME = "scene.inspector";
  /** the document rows as shown: "Built from"'s and the notes' (an object has both lists, the scene only notes) → [ext/id, label] */
  const rows = () => {
    const lists = [...body().querySelectorAll(".inspector > .doc-rows")];
    return lists.length === 2 ? { builtFrom: rowsIn(lists[0]), notes: rowsIn(lists[1]) } : { builtFrom: [], notes: lists[0] ? rowsIn(lists[0]) : [] };
  };
  const rowsIn = (list) => (list.hidden ? [] : [...list.querySelectorAll(".doc-row")].map((r) => [`${r.dataset.ext}/${r.dataset.section}`, r.querySelector(".doc-row-label").textContent]));
  const row = (key) => [...body().querySelectorAll(".doc-row")].find((r) => `${r.dataset.ext}/${r.dataset.section}` === key);
  /** the object's parts, in order: what it is, then each heading */
  const parts = () => [body().querySelector(".inspector-kind")?.textContent ?? null, ...[...body().querySelectorAll(".inspector-heading h3")].map((h) => h.textContent)];

  /** a scene with a built object, a GLB file and a link, each in a group with an About */
  async function mountKinds(extensions = []) {
    const repo = new FakeRepo();
    const src = repo.add({ "@patchwork": { type: "thing" }, title: "the source" });
    const render = repo.add({ "@patchwork": { type: "scene-render" }, title: "x", parent: src.url, providerId: "file-glb", params: {}, glbUrl: null, builtFrom: null, builtAt: null, status: "idle", error: null, pinned: false });
    const glb = repo.add({ "@patchwork": { type: "file" }, name: "hull.glb", extension: "glb" });
    const linked = repo.add(emptyScene({ title: "B", objects: { card: object({ name: "Card" }) }, order: ["card"] }));
    const info = repo.add({ title: "the boat" });
    const objects = {
      boat: group("Boat", null, { infoUrl: info.url }),
      built: object({ name: "Built", group: "boat", sourceUrl: src.url, renderUrl: render.url, providerId: "file-glb", visible: false }),
      file: object({ name: "File", sourceUrl: glb.url, visible: false }),
      link: object({ name: "Link", sourceUrl: linked.url, providerId: LINK, renderUrl: null }),
    };
    await mount({ repo, objects, extensions });
    return { repo, src, render, glb, linked, info };
  }

  it("an object is its header (what it is, its name, its Open), then In this scene, then Built from; a group has no Built from; nothing is mounted", async () => {
    const m = await mountKinds();
    const seen = {};
    for (const target of ["built", "file", "link", "boat", null]) {
      await select(target);
      seen[target ?? "scene"] = { parts: parts(), rows: rows() };
    }
    expect(seen).toEqual({
      built: { parts: ["GLB file", "In this scene", "Built from"], rows: { builtFrom: [[`${ME}/source`, "Source"]], notes: [[`${ME}/about`, "About Boat"]] } },
      file: { parts: ["GLB file", "In this scene", "Built from"], rows: { builtFrom: [[`${ME}/file`, "File"]], notes: [] } },
      link: { parts: ["Linked scene", "In this scene", "Built from"], rows: { builtFrom: [[`${ME}/link`, "Linked scene"]], notes: [] } },
      boat: { parts: ["Group", "In this scene"], rows: { builtFrom: [], notes: [[`${ME}/about`, "About"]] } },
      scene: { parts: ["Scene"], rows: { builtFrom: [], notes: [] } },
    });
    // no document is mounted in the pane: rows only
    expect(s.root.querySelectorAll(".inspector patchwork-view").length).toBe(0);
    void m;
  });

  // [row, the object, its row's key, the open-document detail]
  const OPEN = [
    ["Source", "built", `${"scene.inspector"}/source`, (m) => ({ url: m.src.url })],
  ];
  it.each(OPEN)("Open Editor on %s dispatches its own url and tool", async (_name, target, key, detail) => {
    const m = await mountKinds();
    await select(target);
    const opened = [];
    s.element.addEventListener("patchwork:open-document", (e) => opened.push(e.detail));
    row(key).querySelector(".doc-open").click();
    expect(opened).toEqual([detail(m)]);
  });

  const drawerViews = () => [...s.root.querySelectorAll(".stage-drawer-doc > patchwork-view")].map((v) => `${v.getAttribute("doc-url")}|${v.getAttribute("tool-id") ?? ""}`);
  const docTab = (title) => [...s.root.querySelectorAll(".stage-drawer-tab")].find((t) => t.querySelector(".stage-drawer-tab-name").textContent === title);
  /** a row as shown: [docked?, its Dock's text] */
  const rowShown = (key) => [row(key).hasAttribute("data-docked"), row(key).querySelector(".doc-dock").textContent];

  it("Dock puts the document in a drawer pane of its own, and the row says so; its × takes it out; In the drawer shows it again", async () => {
    const m = await mountKinds();
    await select("built");
    expect(rowShown(`${ME}/source`)).toEqual([false, "Dock"]);
    row(`${ME}/source`).querySelector(".doc-dock").click();
    await settle();
    expect([rowShown(`${ME}/source`), drawerViews()]).toEqual([[true, "In the drawer"], [`${m.src.url}|`]]);
    docTab("Inspector").querySelector(".stage-drawer-tab-name").click();
    await settle();
    row(`${ME}/source`).querySelector(".doc-dock").click();
    await settle();
    expect(s.debug.view.atom.get()["scene.drawer"].shown).toBe("Built · Source");
    docTab("Built · Source").querySelector(".stage-drawer-tab-close").click();
    await settle();
    expect([rowShown(`${ME}/source`), drawerViews()]).toEqual([[false, "Dock"], []]);
  });

  /** dragstart on a row → what it sets ({ mime: value }) and the event */
  const dragRow = (key) => {
    const data = {};
    const e = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "dataTransfer", { value: { setData: (t, v) => (data[t] = v), effectAllowed: "all" } });
    row(key).dispatchEvent(e);
    return { data, e };
  };
  const carrying = (type, data) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, "dataTransfer", { value: { types: Object.keys(data), files: [], dropEffect: "none", getData: (t) => data[t] ?? "" } });
    return e;
  };

  it("a row is dragged as a Patchwork document and as the scene's own: exactly four payload types, its url, title and tool", async () => {
    const m = await mountKinds();
    await select("built");
    const { data, e } = dragRow(`${ME}/source`);
    expect(Object.keys(data).sort()).toEqual([SECTION_MIME, "text/plain", "text/x-patchwork-dnd", "text/x-patchwork-urls"].sort());
    expect(JSON.parse(data["text/x-patchwork-dnd"]).items).toEqual([{ url: m.src.url, name: "Built · Source" }]);
    expect(JSON.parse(data["text/x-patchwork-urls"])).toEqual([m.src.url]);
    expect(data["text/plain"]).toBe(m.src.url);
    expect(data[SECTION_MIME]).toBe(`${m.src.url}|`);
    expect(e.dataTransfer.effectAllowed).toBe("copy");
    expect(row(`${ME}/source`).getAttribute("draggable")).toBe("true");
  });

  // a row let go [where, docked there?, the element under it]: only the tab strip takes it; anywhere else
  // in the stage it's nothing (no object added, no notice, the drop not accepted), the tree and the canvas included
  const LET_GO = [
    ["back on its own fields", false, () => body()],
    ["on a row of the tree, in the same pane", false, () => s.root.querySelector(".inspector-tree .object-row")],
    ["on the canvas, in Edit", false, () => s.canvas],
    ["on the drawer's tab strip", true, () => s.root.querySelector(".stage-drawer-tabs")],
  ];
  it.each(LET_GO)("a row let go %s → docked: %s, and nothing added to the scene", async (_where, docks, under) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountKinds([{ meta: { id: "scene.add" }, module: add }]);
    await select("built");
    const objects = JSON.stringify(s.doc().objects);
    const { data } = dragRow(`${ME}/source`);
    const target = under();
    expect(target).not.toBeNull();
    const over = carrying("dragover", data);
    const drop = carrying("drop", data);
    target.dispatchEvent(over);
    target.dispatchEvent(drop);
    await settle();
    await settle();
    expect([over.defaultPrevented, drop.defaultPrevented]).toEqual([docks, docks]);
    expect(s.debug.view.atom.get()["scene.drawer"].docs).toEqual(docks ? [`${m.src.url}|`] : []);
    expect(JSON.stringify(s.doc().objects)).toBe(objects);
    expect(s.notices()).toEqual([]);
  });

  it("the source offered is the doc's own sourceUrl, never a lens's (nothing veiled is offered)", async () => {
    const secret = fakeUrl();
    const lens = { meta: { id: "t.lens" }, module: { create: () => ({ looks: () => new Map([["built", { sourceUrl: secret, name: "Ace" }]]) }) } };
    const m = await mountKinds([lens]);
    await select("built");
    await settle();
    const opened = [];
    s.element.addEventListener("patchwork:open-document", (e) => opened.push(e.detail.url));
    row(`${ME}/source`).querySelector(".doc-open").click();
    expect(opened).toEqual([m.src.url]);
  });

  it("the build's controls are fields on its render doc: Rebuild asks the scene, Pinned and each param are edits the scene's undo takes back", async () => {
    const repo = new FakeRepo();
    const src = repo.add({ "@patchwork": { type: "thing" }, title: "the source" });
    const render = repo.add({ "@patchwork": { type: "scene-render" }, title: "x", parent: src.url, providerId: "t-sized", params: {}, glbUrl: null, builtFrom: null, builtAt: null, status: "idle", error: null, pinned: false });
    await mount({ repo, objects: { it: object({ name: "It", sourceUrl: src.url, renderUrl: render.url, providerId: "t-sized", visible: false }) }, extensions: [{ meta: { id: "scene.undo" }, module: (await import("./undo.js")).default }] });
    // (the harness's registry is made fresh by the mount: the provider is installed after it)
    getRegistry("scene:source").register({ type: "scene:source", id: "t-sized", name: "Sized thing", content: "built", params: [{ key: "size", label: "Size", kind: "number", default: 2 }], load: async () => ({ build: async () => ({ kind: "glb", glb: new Uint8Array() }) }) });
    await select("it");
    await settle();
    expect(parts()[0]).toBe("Sized thing");
    const asked = [];
    s.root.addEventListener("scene:rebuild", (e) => asked.push(e.detail.renderUrl), true);
    body().querySelector(".build-controls .rebuild").click();
    expect(asked).toEqual([render.url]);
    const pin = body().querySelector(".build-controls .pinned");
    pin.checked = true;
    pin.dispatchEvent(new Event("change"));
    await settle();
    expect(render.doc().pinned).toBe(true);
    const size = body().querySelector('.build-controls .param[data-key="size"] input');
    expect(size.value).toBe("2");
    size.value = "5";
    size.dispatchEvent(new Event("change"));
    await settle();
    expect(render.doc().params).toEqual({ size: 5 });
    s.api("scene.undo").run({ ext: "scene.undo", command: "undo", target: null });
    await settle();
    expect([render.doc().params, render.doc().pinned]).toEqual([{}, true]);
  });

  it("the header's Open is the selection's (./open.js): labelled as it says, run on a click", async () => {
    const runs = [];
    const opener = { meta: { id: "t.opener", type: "scene:view" }, module: { create: () => ({ commands: [{ id: "edit-it", name: "Open", open: true, show: ["inspector", "menu"], state: (t) => (t === "built" ? { label: "Open" } : null), run: (t) => runs.push(t) }] }) } };
    await mountKinds([opener]);
    await select("built");
    await settle();
    const open = body().querySelector(".open-thing");
    expect([open.hidden, open.textContent]).toEqual([false, "Open"]);
    expect(body().querySelector(".commands")).toBeNull();
    open.click();
    expect(runs).toEqual(["built"]);
    await select("boat");
    expect(body().querySelector(".open-thing").hidden).toBe(true);
  });
});

describe("scene.inspector: the pure side", () => {
  const snap = (objects) => ({ objects, ids: Object.keys(objects), parents: resolveParents(objects), groups: resolveGroups(objects) });

  it("aboutFor: own, else nearest group's", () => {
    const u1 = "automerge:2j9vHjM4kfgV7xYGVhQjNzr2Ucqh";
    const u2 = "automerge:3k9vHjM4kfgV7xYGVhQjNzr2Ucqh";
    const sc = snap({ g: group("G", null, { infoUrl: u1, infoToolId: "pdf" }), h: group("H", "g"), a: object({ group: "h" }), b: object({ infoUrl: u2 }), c: object({ infoUrl: "https://x" }) });
    expect(aboutFor(sc, "a")).toEqual({ url: u1, toolId: "pdf", label: "About G", from: "g" });
    expect(aboutFor(sc, "b")).toEqual({ url: u2, toolId: null, label: "About", from: "b" });
    expect(aboutFor(sc, "c")).toBeNull();
  });

  it("groupOptions and attachOptions", () => {
    const sc = snap({ g: group("G"), h: group("H", "g"), a: object({ name: "A" }), b: object({ name: "B", parent: "a" }) });
    expect(groupOptions(sc, "a")).toEqual([["g", "G"], ["h", " H"]]);
    expect(groupOptions(sc, "g")).toEqual([]);
    expect(attachOptions(sc, "a")).toEqual([]);
    expect(attachOptions(sc, "b")).toEqual([["a", "A"]]);
    expect(attachOptions(sc, "g")).toEqual([]);
  });

  it("statusParts: what a render doc's load state says, and a file's", () => {
    const o = object({ sourceUrl: "automerge:x", renderUrl: "automerge:y", providerId: "p" });
    const built = (state, more) => ({ content: "built", state, ...more });
    expect(statusParts(o, { load: built({ state: "fresh" }, { notes: "1 triangle (ascii STL)" }) })).toEqual([{ kind: "notes", text: "1 triangle (ascii STL)" }]);
    expect(statusParts(o, { load: built({ state: "no-provider", providerId: "p" }) })[0].text).toMatch(/Provider “p” is not installed, so this object can't be rebuilt here/);
    expect(statusParts(o, { load: built({ state: "stale", reason: "heads", hold: null }), status: { title: "Out of date; rebuilding soon" } })).toEqual([]);
    expect(statusParts(o, { load: built({ state: "stale", reason: "heads", hold: "contested" }), status: { title: "Built differently" } })).toEqual([{ kind: "warn", text: "Built differently" }]);
    // the build's own failure is its controls' to show; what was built and can't be shown is the status line's
    expect(statusParts(o, { load: built({ state: "failed", in: "build", error: "boom" }) })).toEqual([]);
    expect(statusParts(o, { load: built({ state: "failed", in: "load", error: "GLB failed" }) })).toEqual([{ kind: "error", text: "GLB failed" }]);
    // a file: what the stage routed it to says so (load.content), not the record's shape
    const p = object({ sourceUrl: "automerge:x" });
    expect(statusParts(p, { load: { content: "file", state: { state: "fresh" } }, content: { loaded: true, stats: { triangles: 20000, drawCalls: 1, instanced: 0 } } })).toEqual([{ kind: "notes", text: "20 k triangles · 1 draw call" }]);
    expect(statusParts(p, { load: { content: "file", state: { state: "failed", in: "load", error: "GLB failed" } } })).toEqual([{ kind: "error", text: "GLB failed" }]);
    // routed nowhere: its provider isn't here, so it isn't shown at all
    const q = object({ sourceUrl: "automerge:x", providerId: "t-gltf" });
    expect(statusParts(q, { load: { content: null, state: { state: "no-provider", providerId: "t-gltf" } } })).toEqual([{ kind: "error", text: "Provider “t-gltf” is not installed, so this object can't be shown here." }]);
  });
});

describe("scene.inspector: one pane, the tree and the fields together (EDITOR.md, “The interface”)", () => {
  const tab = () => s.instance("scene.inspector").tab;
  const marked = () => [...tab().body.querySelectorAll('.inspector-tree .object-row[aria-selected="true"]')].map((r) => r.dataset.id);
  /** what the fields show: an object's or group's id and kind, the scene's, or hidden (a ref) */
  const shown = () => {
    const f = tab().body.querySelector(".inspector-body");
    if (!f || f.hidden) return "hidden";
    const i = f.querySelector(".inspector");
    return i.dataset.kind === "scene" ? "scene" : `${i.dataset.kind} ${i.dataset.id}`;
  };
  const rowClick = (id) => tab().body.querySelector(`.inspector-tree .object-row[data-id="${id}"] .row-main`).click();
  const toolbarOn = () => s.api("scene.inspector").run({ ext: "scene.inspector", command: "inspector", value: true });

  // Each source of a selection, from the pane open (the toolbar's Inspector,
  // so how a selection opens a shut pane, the open rule's own table below,
  // doesn't enter into it) and what the row starts from: the row the tree
  // marks and what the fields show. They're read in every flush, by an
  // extension running after the inspector, so "the same flush" is what's
  // checked (not only the state things settle to); the pane stays open
  // through every one, and nothing is written to the doc.
  const ROWS = [
    // [source, selected before, act, row, fields]
    ["row click", null, () => rowClick("a"), ["a"], "object a"],
    ["Escape → null", "a", () => s.key("Escape", { code: "Escape" }), [], "scene"],
    ["group row", "b", () => rowClick("g"), ["g"], "group g"],
    ["ref dimension:x", "a", () => s.facet("scene.inspector").view.select("dimension:x"), [], "hidden"],
  ];
  /** What the pane shows for each selection: the fields, and the row marked (one value). */
  const FIELDS = { a: "object a", b: "object b", g: "group g", "dimension:x": "hidden" };

  it.each(ROWS)("%s: in the flush it lands, the row marked and the fields shown agree; nothing written", async (_name, before, act, row, fields) => {
    const select = (await import("./select.js")).default;
    const flushes = []; // [selected, row marked, fields shown], read after the inspector's update in each flush
    const check = { create: () => ({ update: (_scene, _local, _prev, view) => void (s && tab().isOpen() && flushes.push([view.selected ?? null, marked(), shown()])) }) };
    s = await mountStage({ editor: true, natives: true, 
      extensions: [INSPECTOR, { meta: { id: "scene.select" }, module: select }, { meta: { id: "t.check", type: "scene:view" }, module: check }],
      doc: { objects: { g: group("G"), a: object({ name: "A", group: "g" }), b: object({ name: "B" }) }, order: ["g", "a", "b"] },
    });
    await settle();
    toolbarOn();
    if (before) s.facet("scene.inspector").view.select(before);
    await settle();
    expect(tab().isOpen()).toBe(true);
    const doc = JSON.stringify(s.doc());
    flushes.length = 0;
    act();
    await settle();
    expect(tab().isOpen()).toBe(true);
    expect(marked()).toEqual(row);
    expect(shown()).toBe(fields);
    // the flush the selection landed in, and every one after: the fields and the row are of it
    const landed = flushes.findIndex(([sel]) => (FIELDS[sel] ?? "scene") === fields);
    expect(landed).toBeGreaterThanOrEqual(0);
    for (const [sel, r, f] of flushes.slice(landed)) {
      expect(f).toBe(FIELDS[sel] ?? "scene");
      expect(r).toEqual(sel in FIELDS && !sel.includes(":") ? [sel] : []);
    }
    expect(JSON.stringify(s.doc())).toBe(doc);
    // one value: the row marked is the fields' object (none for the scene or a ref)
    expect(marked()).toEqual(fields.startsWith("object ") || fields.startsWith("group ") ? [fields.split(" ")[1]] : []);
    // one pane: one tab, one tree, one set of fields
    expect(s.drawer().order).toEqual([tab().body]);
    expect(tab().body.querySelectorAll(".scene-outline").length).toBe(1);
    expect(tab().body.querySelectorAll(".inspector-body").length).toBe(1);
  });

  it("the tree comes with the pane: mounted on its first open, the same tree after a × and a reopen, none before", async () => {
    s = await mountStage({ editor: true, natives: true,  extensions: [INSPECTOR], doc: { objects: { a: object({ name: "A" }) }, order: ["a"] } });
    await settle();
    expect(tab().isOpen()).toBe(false);
    expect(s.root.querySelectorAll(".scene-outline").length).toBe(0);
    toolbarOn();
    await settle();
    expect(tab().isOpen()).toBe(true);
    const tree = tab().body.querySelector(".scene-outline");
    expect(s.root.querySelectorAll(".scene-outline").length).toBe(1);
    s.root.querySelector(".stage-drawer-tab-close").click();
    await settle();
    expect(s.root.querySelectorAll(".scene-outline").length).toBe(0); // shut with the pane
    toolbarOn();
    await settle();
    expect(tab().body.querySelector(".scene-outline")).toBe(tree);
    expect(s.root.querySelectorAll(".scene-outline").length).toBe(1);
  });

  // Revealing a row (its groups opened, scrolled into view) is done while the
  // tree is shown: a selection made while the pane is shut, or a pane shut
  // and opened again (its scroller comes back at the top), is revealed as the
  // pane opens, whichever way it opens. Each row: how the selection of "x"
  // (inside a group the viewer folded) comes before the pane opens.
  const REVEALS = [
    // [name, before the pane opens (shut, x selected), how it opens]
    ["selected not editing, opened by picking up the editor", async () => {
      s.edit(false);
      await settle();
      s.facet("scene.inspector").view.select("x");
      await settle();
    }, () => s.edit(true)],
    ["selected, ×, the toolbar's Inspector", async () => {
      s.facet("scene.inspector").view.select("x");
      await settle();
      s.root.querySelector(".stage-drawer-tab-close").click();
      await settle();
    }, toolbarOn],
    ["×, selected from the menu (the pane opens on it)", async () => {
      s.root.querySelector(".stage-drawer-tab-close").click();
      await settle();
    }, () => s.facet("scene.inspector").view.select("x")],
  ];
  it.each(REVEALS)("revealed as it opens: %s", async (_name, before, open) => {
    const calls = [];
    const had = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
    Element.prototype.scrollIntoView = function () {
      calls.push([this.dataset?.id ?? null, this.isConnected]);
    };
    try {
      s = await mountStage({ editor: true, natives: true,  extensions: [INSPECTOR], doc: { objects: { g: group("G"), a: object({ name: "A" }), x: object({ name: "X", group: "g" }) }, order: ["a", "g", "x"] } });
      await settle();
      toolbarOn();
      await settle();
      // the viewer folds G, so x's row isn't drawn until it's revealed
      const twisty = () => tab().body.querySelector('.object-row[data-id="g"] .twisty');
      if (tab().body.querySelector('.object-row[data-id="x"]')) twisty().click();
      await settle();
      expect(tab().body.querySelector('.object-row[data-id="x"]')).toBe(null);
      await before();
      expect(tab().isOpen()).toBe(false);
      calls.length = 0;
      open();
      await settle();
      expect(tab().isOpen()).toBe(true);
      expect(marked()).toEqual(["x"]);
      // x's row is drawn (G opened) and scrolled into view, in the drawer
      expect(calls).toContainEqual(["x", true]);
      // and never into a pane nobody sees
      expect(calls.filter(([, connected]) => !connected)).toEqual([]);
    } finally {
      if (had) Object.defineProperty(Element.prototype, "scrollIntoView", had);
      else delete Element.prototype.scrollIntoView;
    }
  });

  // A shut pane is drawn into by nothing (a scene that changes every frame
  // isn't redrawn into a tree nobody sees); it catches up as it opens.
  it.each([
    ["×", () => s.root.querySelector(".stage-drawer-tab-close").click(), toolbarOn],
    ["putting the editor down", () => s.edit(false), () => (s.edit(true), toolbarOn())],
  ])("shut by %s, the tree isn't drawn; opened again, it shows the scene as it is", async (_name, shut, reopen) => {
    s = await mountStage({ editor: true, natives: true,  extensions: [INSPECTOR], doc: { objects: { a: object({ name: "A" }) }, order: ["a"] } });
    await settle();
    toolbarOn();
    await settle();
    const name = () => tab().body.querySelector('.object-row[data-id="a"] .name')?.textContent ?? null;
    expect(name()).toBe("A");
    shut();
    await settle();
    expect(tab().isOpen()).toBe(false);
    s.change((d) => {
      d.objects.a.name = "A2";
      d.objects.b = object({ name: "B" });
      d.order.push("b");
    });
    await settle();
    expect(name()).toBe("A");
    expect(tab().body.querySelector('.object-row[data-id="b"]')).toBe(null);
    reopen();
    await settle();
    expect(tab().isOpen()).toBe(true);
    expect(name()).toBe("A2");
    expect(tab().body.querySelector('.object-row[data-id="b"]')).not.toBe(null);
  });
});

describe("scene.inspector: a drawer tab that follows attention (STAGE.md, “Activation”)", () => {
  const tab = () => s.instance("scene.inspector").tab;
  // the stage's time, stepped
  let time = null;
  const still = async () => {
    await time.step(1, { still: true });
    await settle();
  };
  async function bare(objects, extensions = []) {
    time = manualTime();
    s = await mountStage({ editor: true, natives: true,  time, extensions: [INSPECTOR, ...extensions], doc: { objects, order: Object.keys(objects) } });
    await still();
  }
  /** Select, and let the stage flush: no stage time passes. */
  async function pick(id) {
    s.local.swap((m) => ({ ...m, selected: id }));
    await still();
  }

  it("every sequence of up to 2 of select an object (two), a ref, nothing, ×, toolbar on, toolbar off, Look, Edit, Enter; and of 3 of an object, nothing, ×, Look, Edit, Enter: open exactly as the rule says", async () => {
    // The rule, as a model ("edit": the editor picked up, "look": put
    // down): editing, open once the toolbar opened it, or once something it
    // shows is selected, until × / toolbar off (then shut until the
    // selection changes) or the editor put down, which also puts the
    // selection down (HISTORY.md, Kernel step 1); open, it stays open across
    // selections; not editing, shut; editing again, open on an object
    // selected (not editing, by the menu) that wasn't shut by hand. Enter (the
    // focus moves into the link L and the selection clears) leaves the tab
    // as it was (a view plugin's, parts/tab.js); inside, Enter on L again
    // changes nothing. So: open ⇔ Edit ∧ (asked ∨ (¬dismissed ∧ (was
    // open ∨ an object selected))).
    const EVENTS = ["obj", "obj2", "ref", "none", "x", "on", "off", "look", "edit", "enter"];
    const SEL = { obj: "a", obj2: "b", ref: "dimension:d1", none: null };
    const shows = (sel) => sel === "a" || sel === "b";
    const model = (m, e) => {
      const sel = SEL[e];
      if (sel !== undefined) {
        if (sel === m.sel) return m;
        return { ...m, sel, open: m.edit && (m.open || shows(sel)), dismissed: false };
      }
      if (e === "x") return m.open ? { ...m, open: false, dismissed: true } : m;
      if (e === "on") return m.edit ? { ...m, open: true, dismissed: false } : m;
      if (e === "off") return m.edit ? { ...m, open: false, dismissed: true } : m;
      if (e === "look") {
        if (!m.edit) return m;
        return m.sel === null ? { ...m, edit: false, open: false } : { ...m, edit: false, open: false, sel: null, dismissed: false };
      }
      if (e === "edit") return m.edit ? m : { ...m, edit: true, open: !m.dismissed && shows(m.sel) };
      // Enter: the selection clears; the inspector, a view plugin, goes on, its tab as it was
      if (e === "enter") return m.inside ? m : { ...m, inside: true, sel: null, dismissed: false };
      return m;
    };
    time = manualTime();
    const repo = new FakeRepo();
    const inner = repo.add(emptyScene({ title: "B", objects: { a: object({ name: "A in B" }), b: object({ name: "B in B" }) }, order: ["a", "b"] }));
    const L = object({ name: "B", sourceUrl: inner.url, providerId: LINK, renderUrl: null });
    s = await mountStage({ editor: true, natives: true,  repo, time, extensions: [INSPECTOR], doc: { objects: { a: object({ name: "A" }), b: object({ name: "B" }), L }, order: ["a", "b", "L"] } });
    const view = s.debug.view;
    await time.until(() => view.stageAt(["L"]), { what: "L to open" });
    // open: the inspector's pane is docked in the view's drawer, whichever stage the focus (and so the inspector) is in
    const open = () => s.drawer().order.some((el) => el.dataset.panel === "inspector");
    const inspectorApi = () => s.api("scene.inspector");
    const apply = async (e) => {
      const sel = SEL[e];
      if (sel !== undefined) view.select(sel == null ? null : [...view.atom.get().focus, sel]);
      else if (e === "x") {
        if (open()) s.root.querySelector(".stage-drawer-tab-close").click();
      } else if (e === "on" || e === "off") {
        if (editing(view.atom.get())) inspectorApi().run({ ext: "scene.inspector", command: "inspector", value: e === "on" });
      } else if (e === "look" || e === "edit") s.edit(e === "edit");
      else if (e === "enter") view.enter(["L"]);
      await still();
    };
    const words = (alphabet, n) => (n === 0 ? [[]] : words(alphabet, n - 1).flatMap((q) => alphabet.map((e) => [...q, e])));
    const seqs = [0, 1, 2]
      .flatMap((n) => words(EVENTS, n))
      .concat(words(["obj", "none", "x", "look", "edit", "enter"], 3));
    let cases = 0;
    for (const q of seqs) {
      // editing at the outermost scene, nothing selected, the tab shut
      view.focusOn([]);
      s.edit(false);
      view.select(null);
      await still();
      s.edit(true);
      await still();
      expect(open()).toBe(false);
      let m = { edit: true, sel: null, open: false, dismissed: false, inside: false };
      for (const e of q) {
        await apply(e);
        m = model(m, e);
        expect(view.atom.get().focus, q.join(" ")).toEqual(m.inside ? ["L"] : []);
        expect(open(), q.join(" ")).toBe(m.open);
        // the tree comes with it: shown iff the pane is
        expect(s.root.querySelectorAll(".scene-outline").length, q.join(" ")).toBe(m.open ? 1 : 0);
      }
      cases++;
    }
    expect(cases).toBe(1 + 10 + 100 + 216);
  }, 480_000);

  it("following the selection, it comes in behind a pane already shown (the parts bin), a tab to pick; alone, it shows", async () => {
    const pane = document.createElement("div");
    const other = { meta: { id: "t.bin", type: "scene:view" }, module: { create: (api) => (api.use("drawer").dock(pane, { title: "Bin" }), {}) } };
    await bare({ a: object({ name: "A" }) }, [other]);
    expect(s.drawer().shown).toBe(pane);
    await pick("a");
    expect(tab().isOpen()).toBe(true);
    expect(s.drawer()).toEqual({ order: [pane, tab().body], shown: pane });
  });

  it("the drawer's rail's Inspector says whether its tab is open, in the flush after it shuts (local.drawer)", async () => {
    await bare({ a: object({ name: "A" }) }, []);
    const pressed = () => s.root.querySelector('.stage-panel-rail [data-command="inspector"]')?.getAttribute("aria-pressed");
    expect(pressed()).toBe("false");
    await pick("a");
    expect(pressed()).toBe("true");
    await pick(null);
    expect(pressed()).toBe("true");
    s.root.querySelector(".stage-drawer-tab-close").click();
    await still();
    expect(tab().isOpen()).toBe(false);
    expect(pressed()).toBe("false");
  });
});
