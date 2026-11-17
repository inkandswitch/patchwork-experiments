import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import { FakeRepo, fakeUrl } from "../test/fake-repo.js";
import { applyMatrix } from "../transform.js";
import { worldMatrix } from "../hierarchy.js";
import inspector, { sectionPref, startBodies } from "./inspector.js";
import { openTabs } from "../test/tabs.js";
import { aboutFor, attachOptions, commandsFor, commandsKey, documentsFor, groupOptions, lensNamed, statusParts } from "./inspector-model.js";
import { EMBED_ATTR } from "../embed.js";
import { LINK } from "../stage/links.js";
import { emptyScene } from "../test/empty-scene.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  s = await mountStage({
    repo,
    extensions: [INSPECTOR, OPENED, ...extensions],
    doc: { objects, order: Object.keys(objects), ...doc },
  });
  return s;
}

/** The Inspector pane's fields, below its tree (open: the viewer asked for it) */
const body = () => s.instance("scene.inspector").tab.body.querySelector(".inspector-body");
const $ = (sel) => body().querySelector(sel);
const buttons = () => [...body().querySelectorAll(".commands button")];
const button = (text) => buttons().find((b) => b.textContent === text);
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

  it("has no Layers section for an object whose GLB has none", async () => {
    await mountBoat();
    await select("plain");
    expect($(".layers")?.hidden ?? true).toBe(true);
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
    expect($(".inspector-kind").textContent).toBe("Object");
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
    s.api("scene.inspector").setPref("units", "mm");
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
    expect(s.local.get().notices.at(-1)).toMatchObject({ text: "A group can't go inside itself.", kind: "error" });
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
    expect(button("Group")).toBeUndefined();
    button("Ungroup").click();
    const o = s.doc().objects;
    expect(o.body).toBeUndefined();
    expect(o.hull.group).toBe("vessel");
    expect(o.hull.opacity).toBe(0.5); // the group's fade folded in
    expect(s.local.get().selected).toBeNull();
    await settle();
    expect($(".inspector").dataset.kind).toBe("scene");
  });

  it("Group wraps the object in a new group, filed where it was, and selects it", async () => {
    await mount({ objects: { g: group("G"), a: object({ name: "A", group: "g" }) } });
    await select("a");
    expect(button("Ungroup")).toBeUndefined();
    button("Group").click();
    const objects = s.doc().objects;
    const gid = objects.a.group;
    expect(gid).not.toBe("g");
    expect(objects[gid]).toEqual({ kind: "group", name: "Group", group: "g", visible: true, opacity: 1 });
    expect(s.doc().order.indexOf(gid)).toBe(s.doc().order.indexOf("a") - 1);
    expect(s.local.get().selected).toBe(gid);
  });

  it("Frame fits the camera to the object's box", async () => {
    await mount({ objects: { a: object({ name: "A" }) } });
    await select("a");
    const api = s.api("scene.inspector");
    const framed = [];
    api.box = () => ({ min: [0, 0, 0], max: [1, 1, 1] });
    vi.spyOn(s.debug.viewport, "frame").mockImplementation((b) => framed.push(b));
    button("Frame").click();
    expect(framed).toEqual([{ min: [0, 0, 0], max: [1, 1, 1] }]);
  });

  it("shows other extensions' commands for the selection (inspector or every surface), and runs them on it", async () => {
    const log = [];
    const ext = {
      meta: { id: "t.poke" },
      module: {
        create: () => ({
          commands: [
            { id: "poke", name: "Poke", state: (t) => (t === "a" ? { title: "Poke it" } : null), run: (t) => log.push(["poke", t]) },
            { id: "menuonly", name: "Menu only", show: ["menu"], state: (t) => (t ? {} : null), run: () => log.push("menu") },
            { id: "scene", name: "Scene only", run: () => log.push("scene") },
            { id: "pin", name: "Pin", state: (t) => (t ? { checked: false } : null), run: (t, v) => log.push(["pin", t, v]) },
            { id: "off", name: "Off", show: ["inspector"], state: (t) => (t ? { disabled: true } : null), run: () => log.push("off") },
          ],
        }),
      },
    };
    await mount({ objects: { a: object({ name: "A" }), b: object({ name: "B" }) }, extensions: [ext] });
    await select("a");
    expect(buttons().map((b) => b.textContent)).toEqual(["Frame", "Group", "Poke", "Pin", "Off"]);
    button("Poke").click();
    button("Pin").click();
    button("Off").click();
    expect(log).toEqual([["poke", "a"], ["pin", "a", true]]);
    expect(button("Pin").getAttribute("aria-pressed")).toBe("false");
    expect(button("Off").disabled).toBe(true);
    await select("b");
    expect(button("Poke")).toBeUndefined();
  });

  // label present/absent × enabled/disabled × title (the reason) present/absent: all eight
  it("a command's button is named by its state's label, and a disabled one says why", async () => {
    const cases = [];
    for (const label of [undefined, "Done"]) for (const disabled of [false, true]) for (const title of [undefined, "Because"]) cases.push({ label, disabled, title });
    const state = (c) => Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined && v !== false));
    const ext = {
      meta: { id: "t.states" },
      module: { create: () => ({ commands: cases.map((c, i) => ({ id: `c${i}`, name: `Name ${i}`, show: ["inspector"], state: (t) => (t ? state(c) : null), run() {} })) }) },
    };
    await mount({ objects: { a: object({ name: "A" }) }, extensions: [ext] });
    await select("a");
    cases.forEach((c, i) => {
      const b = $(`.commands button[data-command="c${i}"]`);
      expect(b.textContent).toBe(c.label ?? `Name ${i}`);
      expect(b.disabled).toBe(c.disabled);
      expect(b.title).toBe(c.title ?? "");
      const after = b.nextElementSibling;
      const reason = after?.classList.contains("command-reason") ? after.textContent : null;
      expect(reason).toBe(c.disabled && c.title ? c.title : null);
    });
    expect(body().querySelectorAll(".command-reason").length).toBe(2);
  });

  it("the buttons follow a state's label and reason as they change", async () => {
    let st = { label: "Shape hull" };
    const ext = { meta: { id: "t.shape" }, module: { create: () => ({ commands: [{ id: "shape", name: "Shape hull", show: ["inspector"], state: (t) => (t ? st : null), run() {} }] }) } };
    await mount({ objects: { a: object({ name: "A" }), b: object({ name: "B" }) }, extensions: [ext] });
    await select("a");
    const shape = () => $('.commands button[data-command="shape"]');
    expect(shape().textContent).toBe("Shape hull");
    st = { label: "Done shaping" };
    await select("b");
    expect(shape().textContent).toBe("Done shaping");
    st = { disabled: true, title: "Follow latest to shape" };
    await select("a");
    expect(shape().textContent).toBe("Shape hull");
    expect($(".command-reason").textContent).toBe("Follow latest to shape");
    st = {};
    await select("b");
    expect($(".command-reason")).toBeNull();
  });

  it("commandsKey changes with a state's label", () => {
    const entry = (state) => [{ ext: "x", command: { id: "a", name: "A" }, state }];
    expect(commandsKey(entry({}))).not.toBe(commandsKey(entry({ label: "B" })));
    expect(commandsKey(entry({ label: "B" }))).toBe(commandsKey(entry({ label: "B" })));
  });

  it("a lens's name is shown read-only, never written back", async () => {
    const lens = { meta: { id: "t.lens" }, module: { create: () => ({ looks: () => new Map([["a", { name: "Secret" }]]) }) } };
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

describe("scene.inspector: documents, a section each (STAGE.md \"A document\", TOOLS.md §6)", () => {
  const ME = "scene.inspector";
  /** the sections as shown: [ext/id, label, open?, the doc-url and tool-id of its view, or null while folded] */
  const sections = () =>
    [...body().querySelectorAll(".doc-section")].map((sec) => {
      const v = sec.querySelector(".section-embed > patchwork-view");
      return [`${sec.dataset.ext}/${sec.dataset.section}`, sec.querySelector(".section-label").textContent, !sec.hasAttribute("data-folded"), v ? [v.getAttribute("doc-url"), v.getAttribute("tool-id")] : null];
    });
  const section = (key) => [...body().querySelectorAll(".doc-section")].find((sec) => `${sec.dataset.ext}/${sec.dataset.section}` === key);
  const views = () => s.root.querySelectorAll("patchwork-view").length;
  const OTHER = (state) => ({ meta: { id: "t.notes" }, module: { create: () => ({ documents: [{ id: "notes", name: "Notes", state }] }) } });

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
      built: object({ name: "Built", group: "boat", sourceUrl: src.url, renderUrl: render.url, visible: false }),
      file: object({ name: "File", sourceUrl: glb.url, visible: false }),
      link: object({ name: "Link", sourceUrl: linked.url, providerId: LINK, renderUrl: null }),
    };
    await mount({ repo, objects, extensions });
    return { repo, src, render, glb, linked, info };
  }

  it("shows exactly documentsFor's sections, in its order, and only the open ones have a view", async () => {
    const extra = (t) => (t === "built" ? { url: m.info.url, toolId: "notes", label: "Notes" } : null);
    const m = await mountKinds([OTHER(extra)]);
    await select("built");
    await settle();
    const want = documentsFor(s.api(ME).collect("documents"), "built", s.api(ME).context(null), ME).map((d) => `${d.ext}/${d.id}`);
    expect(want).toEqual([`${ME}/source`, `${ME}/build`, `${ME}/about`, "t.notes/notes"]);
    expect(sections()).toEqual([
      [`${ME}/source`, "Source", true, [m.src.url, null]],
      [`${ME}/build`, "Build", true, [m.render.url, "scene-render-controls"]],
      [`${ME}/about`, "About Boat", true, [m.info.url, null]],
      ["t.notes/notes", "Notes", true, [m.info.url, "notes"]],
    ]);
    // each view sits inside the stage's embed marker: its keys are its own
    for (const v of body().querySelectorAll(".doc-section patchwork-view")) expect(v.closest(`[${EMBED_ATTR}]`)).not.toBeNull();
    await select("file");
    expect(sections()).toEqual([[`${ME}/file`, "File", false, null]]);
    await select("link");
    expect(sections()).toEqual([[`${ME}/link`, "Linked scene", false, null]]);
    // the link's text row stays (what the link is here), with no Open of its own; the section is the document
    expect($(".link-row").textContent).toMatch(/^Link(Live|Closed|Fixed)/);
    expect($(".link-row button")).toBeNull();
    await select("boat");
    expect(sections()).toEqual([[`${ME}/about`, "About", true, [m.info.url, null]]]);
    await select(null);
    expect(sections()).toEqual([]);
    expect($(".doc-sections").hidden).toBe(true);
  });

  it("a scene's documents (target null) are sections of the scene", async () => {
    const notes = fakeUrl();
    await mount({ objects: { a: object({ name: "A" }) }, extensions: [OTHER((t) => (t == null ? { url: notes } : null))] });
    expect($(".inspector").dataset.kind).toBe("scene");
    expect(sections()).toEqual([["t.notes/notes", "Notes", true, [notes, null]]]);
    await select("a");
    expect(sections()).toEqual([]);
  });

  it("one live view per open section: a new selection unmounts every old one; an unchanged section stays mounted", async () => {
    const m = await mountKinds();
    await select("built");
    expect(views()).toBe(3);
    const first = [...body().querySelectorAll(".doc-section patchwork-view")];
    s.change((d) => (d.objects.built.opacity = 0.4));
    await settle();
    // the very same elements, still connected (not new ones like them)
    const now = [...body().querySelectorAll(".doc-section patchwork-view")];
    expect(now.length).toBe(first.length);
    expect(now.every((v, i) => v === first[i] && v.isConnected)).toBe(true);
    await select("boat");
    expect(views()).toBe(1);
    for (const v of first) expect(v.isConnected).toBe(false);
    // the same About, a new selection: a view of its own
    await select("built");
    await select("boat");
    expect(views()).toBe(1);
    expect(body().querySelector(".doc-section patchwork-view").getAttribute("doc-url")).toBe(m.info.url);
  });

  // the sections around an open one come and go: [what changes, then the mounts and unmounts it causes]
  const AROUND = [
    ["About goes (built leaves its group)", (d) => (d.objects.built.group = null), (m) => [["unmount", m.info.url]]],
    ["About comes (built back in Boat)", (d) => (d.objects.built.group = "boat"), (m) => [["mount", m.info.url]]],
    ["another extension's comes (after About)", (d, flag) => ((flag.on = true), (d.objects.built.opacity = 0.5)), (m) => [["mount", m.glb.url]]],
    ["another extension's goes", (d, flag) => ((flag.on = false), (d.objects.built.opacity = 0.6)), (m) => [["unmount", m.glb.url]]],
  ];
  it("a section coming or going leaves every other open section mounted (no tool remounted)", async () => {
    const flag = { on: false };
    let glb = null;
    const m = await mountKinds([OTHER((t) => (t === "built" && flag.on ? { url: glb } : null))]);
    glb = m.glb.url;
    await select("built");
    expect(views()).toBe(3);
    for (const [name, change, want] of AROUND) {
      embedLog.length = 0;
      s.change((d) => change(d, flag));
      await settle();
      expect(embedLog, name).toEqual(want(m));
    }
    // and the live ones are exactly the open sections
    expect(views()).toBe(3);
    embedLog.length = 0;
    await select("boat");
    expect(embedLog.filter(([k]) => k === "unmount").map(([, u]) => u).sort()).toEqual([m.src.url, m.render.url, m.info.url].sort());
    expect(embedLog.filter(([k]) => k === "mount").map(([, u]) => u)).toEqual([m.info.url]);
  });

  it("a section whose document changes under the same selection shows, and opens, the new one", async () => {
    const repo = new FakeRepo();
    const one = repo.add({ title: "one" });
    const two = repo.add({ title: "two" });
    await mount({ repo, objects: { g1: group("G1", null, { infoUrl: one.url }), g2: group("G2", null, { infoUrl: two.url }), x: object({ name: "X", group: "g1" }) } });
    await select("x");
    const about = () => section(`${ME}/about`);
    expect(about().querySelector("patchwork-view").getAttribute("doc-url")).toBe(one.url);
    s.change((d) => (d.objects.x.group = "g2"));
    await settle();
    expect(about().querySelector(".section-label").textContent).toBe("About G2");
    expect([...body().querySelectorAll("patchwork-view")].map((v) => v.getAttribute("doc-url"))).toEqual([two.url]);
    const opened = [];
    s.element.addEventListener("patchwork:open-document", (e) => opened.push(e.detail));
    about().querySelector(".section-open").click();
    expect(opened).toEqual([{ url: two.url }]);
  });

  // fold: the viewer's pref, else the entry's own `folded`: {no pref, true, false} × {entry folded, not}
  // (a File starts folded, a built Source open; each section is its own pref)
  const FOLD = [
    ["no pref", undefined, "file", "file", false],
    ["no pref", undefined, "built", "source", true],
    ["pref true", true, "file", "file", true],
    ["pref true", true, "built", "source", true],
    ["pref false", false, "file", "file", false],
    ["pref false", false, "built", "source", false],
  ];
  it.each(FOLD)("fold: %s (%s), %s's section → open %s", async (_name, pref, target, id, open) => {
    await mountKinds();
    if (pref !== undefined) s.api(ME).setPref(sectionPref(ME, id), pref);
    await select(target);
    await settle();
    const sec = section(`${ME}/${id}`);
    expect(!sec.hasAttribute("data-folded")).toBe(open);
    expect(sec.querySelector(".section-fold").getAttribute("aria-expanded")).toBe(String(open));
    // a view exactly while it's open
    expect(sec.querySelectorAll("patchwork-view").length).toBe(open ? 1 : 0);
    expect(sec.querySelector(".section-embed").hidden).toBe(!open);
  });

  // one kind's fold leaves the others' as they start: [the pref set, then each kind's section → open?]
  const OWN_FOLD = [
    ["File unfolded", "file", true, { built: true, file: true, link: false }],
    ["Linked scene unfolded", "link", true, { built: true, file: false, link: true }],
    ["Source folded", "source", false, { built: false, file: false, link: false }],
  ];
  it.each(OWN_FOLD)("%s: only that section follows it", async (_name, id, pref, want) => {
    await mountKinds();
    s.api(ME).setPref(sectionPref(ME, id), pref);
    const got = {};
    for (const [target, sid] of [["built", "source"], ["file", "file"], ["link", "link"]]) {
      await select(target);
      got[target] = !section(`${ME}/${sid}`).hasAttribute("data-folded");
    }
    expect(got).toEqual(want);
  });

  it("the fold toggles the viewer's pref, nothing in the doc, and mounts or unmounts the view", async () => {
    await mountKinds();
    await select("built");
    const before = JSON.stringify(s.doc());
    section(`${ME}/source`).querySelector(".section-fold").click();
    await settle();
    expect(s.api(ME).pref(sectionPref(ME, "source"), null)).toBe(false);
    expect(section(`${ME}/source`).querySelectorAll("patchwork-view").length).toBe(0);
    expect(views()).toBe(2);
    section(`${ME}/source`).querySelector(".section-fold").click();
    await settle();
    expect(s.api(ME).pref(sectionPref(ME, "source"), null)).toBe(true);
    expect(views()).toBe(3);
    expect(JSON.stringify(s.doc())).toBe(before);
  });

  // Open per kind of section: its own url and tool, as patchwork:open-document's detail
  const OPEN = [
    ["Source", "built", `${"scene.inspector"}/source`, (m) => ({ url: m.src.url })],
    ["Build", "built", `${"scene.inspector"}/build`, (m) => ({ url: m.render.url, toolId: "scene-render-controls" })],
    ["About", "boat", `${"scene.inspector"}/about`, (m) => ({ url: m.info.url })],
    // from a folded head: what Open file and the link's Open were
    ["File (folded)", "file", `${"scene.inspector"}/file`, (m) => ({ url: m.glb.url })],
    ["Linked scene (folded)", "link", `${"scene.inspector"}/link`, (m) => ({ url: m.linked.url })],
  ];
  it.each(OPEN)("Open on %s dispatches its own url and tool", async (_name, target, key, detail) => {
    const m = await mountKinds();
    await select(target);
    const opened = [];
    s.element.addEventListener("patchwork:open-document", (e) => opened.push(e.detail));
    section(key).querySelector(".section-open").click();
    expect(opened).toEqual([detail(m)]);
  });

  it("nothing else in the pane opens a document: every other button clicked, no open-document", async () => {
    await mountKinds();
    const opened = [];
    s.element.addEventListener("patchwork:open-document", (e) => opened.push(e.detail.url));
    for (const target of ["built", "file", "link", "boat", null]) {
      await select(target);
      // (the commands are other extensions' verbs, run through api.run, and are their own tests)
      const others = [...body().querySelectorAll("button")].filter((b) => !b.closest(".commands") && !b.classList.contains("section-open"));
      for (const b of others) if (b.isConnected && !b.disabled) b.click();
      await settle();
    }
    expect(opened).toEqual([]);
  });

  it("a section's box has a height of its own, which its view fills (a tool that fills its host gets one)", () => {
    const css = readFileSync(fileURLToPath(import.meta.url).replace(/inspector\.test\.js$/, "inspector.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = (sel) => css.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    expect(rule(".scene-stage .inspector .section-embed")).toMatch(/(^|[\s;])height:\s*[^;]*\d/);
    expect(rule(".scene-stage .inspector .section-embed > patchwork-view")).toMatch(/(^|[\s;])height:\s*100%/);
  });

  it("the source shown is the doc's own sourceUrl, never a lens's (nothing veiled is offered)", async () => {
    const secret = fakeUrl();
    const lens = { meta: { id: "t.lens" }, module: { create: () => ({ looks: () => new Map([["built", { sourceUrl: secret, name: "Ace" }]]) }) } };
    const m = await mountKinds([lens]);
    await select("built");
    await settle();
    expect(sections()[0]).toEqual([`${ME}/source`, "Source", true, [m.src.url, null]]);
    expect([...s.root.querySelectorAll("patchwork-view")].some((v) => v.getAttribute("doc-url") === secret)).toBe(false);
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

  it("lensNamed", () => {
    expect(lensNamed("Card", { name: "Card" })).toBe(false);
    expect(lensNamed("Ace", { name: "Card" })).toBe(true);
    expect(lensNamed(null, { name: "Card" })).toBe(false);
  });

  it("statusParts: render docs with and without the raw load state", () => {
    const o = object({ sourceUrl: "automerge:x", renderUrl: "automerge:y", providerId: "p" });
    expect(statusParts(o, { load: { notes: "1 triangle (ascii STL)" } })).toEqual([{ kind: "notes", text: "1 triangle (ascii STL)" }]);
    expect(statusParts(o, { status: { state: "warn" } })[0].text).toMatch(/Provider “p” is not installed, so this object can't be rebuilt here/);
    expect(statusParts(o, { load: { content: "built", phase: "no-provider", providerId: "p" } })[0].text).toMatch(/can't be rebuilt here/);
    expect(statusParts(o, { status: { state: "stale", reason: "out-of-date", title: "Out of date; rebuilding soon" } })).toEqual([]);
    expect(statusParts(o, { status: { state: "stale", reason: "contested", title: "Built differently" } })).toEqual([{ kind: "warn", text: "Built differently" }]);
    // the reason decides, not the wording
    expect(statusParts(o, { status: { state: "stale", reason: "deps", title: "A collaborator's linked document" } })).toEqual([]);
    // a file: what the stage routed it to says so (load.content), not the record's shape
    const p = object({ sourceUrl: "automerge:x" });
    const file = { content: "file" };
    expect(statusParts(p, { load: file, content: { loaded: true, stats: { triangles: 20000, drawCalls: 1, instanced: 0 } } })).toEqual([{ kind: "notes", text: "20 k triangles · 1 draw call" }]);
    expect(statusParts(p, { load: file, status: { state: "error", title: "GLB failed" } })).toEqual([{ kind: "error", text: "GLB failed" }]);
    // routed nowhere: its provider isn't here, so it isn't shown at all
    const q = object({ sourceUrl: "automerge:x", providerId: "t-gltf" });
    expect(statusParts(q, { load: { content: null, phase: "no-provider", providerId: "t-gltf" } })).toEqual([{ kind: "error", text: "Provider “t-gltf” is not installed, so this object can't be shown here." }]);
    expect(statusParts(q, { status: { state: "warn" } })).toEqual([{ kind: "error", text: "Provider “t-gltf” is not installed, so this object can't be shown here." }]);
  });

  it("commandsFor: only targeted ones for the inspector, own first", () => {
    const run = () => {};
    const collected = [
      { id: "x", value: [{ id: "a", run, state: () => ({}) }, { id: "m", show: ["menu"], run, state: () => ({}) }, { id: "s", run }] },
      { id: "me", value: [{ id: "b", run, state: () => ({}) }] },
    ];
    expect(commandsFor(collected, "o", {}, "me").map((c) => c.command.id)).toEqual(["b", "a"]);
    expect(commandsFor(collected, null, {}, "me")).toEqual([]);
  });
});

describe("scene.inspector: one pane, the tree and the fields together (TOOLS.md §6)", () => {
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
    ["api.view.select(id)", null, () => s.api("scene.inspector").view.select("a"), ["a"], "object a"],
    ["menu Select", "a", () => s.api("scene.inspector").run({ ext: "scene.select", command: "select", target: "b" }), ["b"], "object b"],
    ["Escape → null", "a", () => s.key("Escape", { code: "Escape" }), [], "scene"],
    ["group row", "b", () => rowClick("g"), ["g"], "group g"],
    ["ref dimension:x", "a", () => s.api("scene.inspector").view.select("dimension:x"), [], "hidden"],
  ];
  /** What the pane shows for each selection: the fields, and the row marked (one value). */
  const FIELDS = { a: "object a", b: "object b", g: "group g", "dimension:x": "hidden" };

  it.each(ROWS)("%s: in the flush it lands, the row marked and the fields shown agree; nothing written", async (_name, before, act, row, fields) => {
    const select = (await import("./select.js")).default;
    const flushes = []; // [selected, row marked, fields shown], read after the inspector's update in each flush
    const check = { create: () => ({ update: (_scene, _local, _prev, view) => void (s && tab().isOpen() && flushes.push([view.selected ?? null, marked(), shown()])) }) };
    s = await mountStage({
      extensions: [INSPECTOR, { meta: { id: "scene.select" }, module: select }, { meta: { id: "t.check" }, module: check }],
      doc: { objects: { g: group("G"), a: object({ name: "A", group: "g" }), b: object({ name: "B" }) }, order: ["g", "a", "b"] },
    });
    await settle();
    toolbarOn();
    if (before) s.api("scene.inspector").view.select(before);
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
    expect(s.debug.drawer().order).toEqual([tab().body]);
    expect(tab().body.querySelectorAll(".scene-outline").length).toBe(1);
    expect(tab().body.querySelectorAll(".inspector-body").length).toBe(1);
  });

  it("the tree comes with the pane: mounted on its first open, the same tree after a × and a reopen, none before", async () => {
    s = await mountStage({ extensions: [INSPECTOR], doc: { objects: { a: object({ name: "A" }) }, order: ["a"] } });
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
    ["selected in Look, opened by entering Edit", async () => {
      s.api("scene.inspector").body.enter("look");
      await settle();
      s.api("scene.inspector").view.select("x");
      await settle();
    }, () => s.api("scene.inspector").body.enter("edit")],
    ["selected, ×, the toolbar's Inspector", async () => {
      s.api("scene.inspector").view.select("x");
      await settle();
      s.root.querySelector(".stage-drawer-tab-close").click();
      await settle();
    }, toolbarOn],
    ["×, selected from the menu (the pane opens on it)", async () => {
      s.root.querySelector(".stage-drawer-tab-close").click();
      await settle();
    }, () => s.api("scene.inspector").view.select("x")],
  ];
  it.each(REVEALS)("revealed as it opens: %s", async (_name, before, open) => {
    const calls = [];
    const had = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
    Element.prototype.scrollIntoView = function () {
      calls.push([this.dataset?.id ?? null, this.isConnected]);
    };
    try {
      s = await mountStage({ extensions: [INSPECTOR], doc: { objects: { g: group("G"), a: object({ name: "A" }), x: object({ name: "X", group: "g" }) }, order: ["a", "g", "x"] } });
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
    ["Look", () => s.api("scene.inspector").body.enter("look"), () => (s.api("scene.inspector").body.enter("edit"), toolbarOn())],
  ])("shut by %s, the tree isn't drawn; opened again, it shows the scene as it is", async (_name, shut, reopen) => {
    s = await mountStage({ extensions: [INSPECTOR], doc: { objects: { a: object({ name: "A" }) }, order: ["a"] } });
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

  it("arrow keys in the tree are the tree's: no scene shortcut hears them", async () => {
    const keys = [];
    const keymap = { create: () => ({ input: { key: (ev) => (keys.push(ev.key), true) } }) };
    s = await mountStage({ extensions: [INSPECTOR, OPENED, { meta: { id: "t.keys" }, module: keymap }], doc: { objects: { a: object({ name: "A" }), b: object({ name: "B" }) }, order: ["a", "b"] } });
    await settle();
    const main = tab().body.querySelector('.object-row[data-id="a"] .row-main');
    main.focus();
    for (const key of ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"]) document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    expect(keys).toEqual([]);
  });

  it("the package registers one pane: scene.inspector and no scene.outline; in Edit the toolbar has Inspector and no Objects", async () => {
    const { plugins } = await import("../index.js");
    const ids = plugins.filter((p) => p.type === "scene:extension").map((p) => p.id);
    expect(ids).toContain("scene.inspector");
    expect(ids).not.toContain("scene.outline");
    const { flatCommands, shownOn } = await import("./toolbar-commands.js");
    // every part of the package that offers a toolbar toggle for a drawer tab
    const owners = await Promise.all(["scene.inspector", "scene.parts", "scene.dimensions"].map(async (id) => ({ meta: { id }, module: await plugins.find((p) => p.id === id).load() })));
    s = await mountStage({ extensions: owners, doc: { objects: { a: object({ name: "A" }) }, order: ["a"] } });
    await settle();
    const toolbar = flatCommands(s.api("scene.inspector").collect("commands"))
      .filter(({ command }) => shownOn(command, "toolbar", { strict: true }))
      .map(({ ext, command }) => `${ext}:${command.id}`);
    expect(toolbar).toContain("scene.inspector:inspector");
    expect(toolbar.some((k) => k.endsWith(":objects"))).toBe(false);
  });
});

describe("scene.inspector: a drawer tab that follows attention (TOOLS.md §1, §6)", () => {
  const tab = () => s.instance("scene.inspector").tab;
  async function bare(objects, extensions = []) {
    s = await mountStage({ extensions: [INSPECTOR, ...extensions], doc: { objects, order: Object.keys(objects) } });
    await settle();
  }

  it("shut until something is selected; then open, on the scene when nothing is; its × shuts it until the selection changes; a ref opens nothing", async () => {
    await bare({ a: object({ name: "A" }), b: object({ name: "B" }) });
    expect(tab().isOpen()).toBe(false);
    await select("a");
    expect(tab().isOpen()).toBe(true);
    expect(s.debug.drawer().shown).toBe(tab().body);
    // the viewer closes it (its ×): it stays shut while "a" is selected
    s.root.querySelector(".stage-drawer-tab-close").click();
    await settle();
    expect(tab().isOpen()).toBe(false);
    s.change((d) => (d.objects.a.name = "A2"));
    await settle();
    expect(tab().isOpen()).toBe(false);
    await select("b");
    expect(tab().isOpen()).toBe(true);
    // open, it stays open whatever is selected next: the canvas keeps its width (TOOLS.md Decisions 6)
    await select("dimension:d1");
    expect(tab().isOpen()).toBe(true);
    await select(null);
    expect(tab().isOpen()).toBe(true);
    expect(tab().body.querySelector(".inspector").dataset.kind).toBe("scene");
    await select("a");
    expect(tab().isOpen()).toBe(true);
    // shut from the toolbar: shut while the selection stays, shut by deselecting, opened by the next selection
    s.api("scene.inspector").run({ ext: "scene.inspector", command: "inspector", value: false });
    await settle();
    expect(tab().isOpen()).toBe(false);
    await select(null);
    expect(tab().isOpen()).toBe(false);
    // a ref selected with the tab shut opens nothing
    await select("dimension:d1");
    expect(tab().isOpen()).toBe(false);
    await select(null);
    // asked for from the toolbar: the scene's, with nothing selected
    s.api("scene.inspector").run({ ext: "scene.inspector", command: "inspector", value: true });
    await settle();
    expect(tab().isOpen()).toBe(true);
    expect(tab().body.querySelector(".inspector").dataset.kind).toBe("scene");
    s.api("scene.inspector").run({ ext: "scene.inspector", command: "inspector", value: false });
    await settle();
    expect(tab().isOpen()).toBe(false);
  });

  it("every sequence of up to 2 of select an object (two), a ref, nothing, ×, toolbar on, toolbar off, Look, Edit, and of 3 of an object, nothing, ×, Look, Edit: open exactly as the rule says", async () => {
    // The rule, as a model: in Edit, open once a selection (of something it
    // shows) or the toolbar opened it, until × / toolbar off (then shut until
    // the selection changes) or leaving Edit, which also puts the selection
    // down (TOOLS.md Decisions 6); out of Edit, shut; back in Edit, open on
    // an object selected (in Look, by the menu) that wasn't shut by hand.
    const EVENTS = ["obj", "obj2", "ref", "none", "x", "on", "off", "look", "edit"];
    const model = (m, e) => {
      const sel = { obj: "a", obj2: "b", ref: "dimension:d1", none: null }[e];
      if (sel !== undefined) {
        if (sel === m.sel) return m;
        const open = m.edit && (m.open || sel === "a" || sel === "b");
        return { ...m, sel, open, dismissed: false };
      }
      if (e === "x") return m.open ? { ...m, open: false, dismissed: true } : m;
      if (e === "on") return m.edit ? { ...m, open: true, dismissed: false } : m;
      if (e === "off") return m.edit ? { ...m, open: false, dismissed: true } : m;
      if (e === "look") return m.edit ? { ...m, edit: false, open: false, sel: null, dismissed: m.sel === null ? m.dismissed : false } : { ...m, open: false };
      if (e === "edit") return m.edit ? m : { ...m, edit: true, open: !m.dismissed && (m.sel === "a" || m.sel === "b") };
      return m;
    };
    await bare({ a: object({ name: "A" }), b: object({ name: "B" }) });
    const api = s.api("scene.inspector");
    // (a lighter settle than the harness's: the stage's flush is a macrotask or two)
    const step = () => settle(1);
    const pick = async (id) => {
      s.local.swap((m) => ({ ...m, selected: id }));
      await step();
    };
    const apply = async (e) => {
      const sel = { obj: "a", obj2: "b", ref: "dimension:d1", none: null }[e];
      if (sel !== undefined) return pick(sel);
      if (e === "x") {
        if (tab().isOpen()) s.root.querySelector(".stage-drawer-tab-close").click();
      } else if (e === "on" || e === "off") {
        if (s.local.get().body.id === "edit") api.run({ ext: "scene.inspector", command: "inspector", value: e === "on" });
      } else api.body.enter(e);
      await step();
    };
    const words = (alphabet, n) => (n === 0 ? [[]] : words(alphabet, n - 1).flatMap((q) => alphabet.map((e) => [...q, e])));
    const seqs = [0, 1, 2].flatMap((n) => words(EVENTS, n)).concat(words(["obj", "none", "x", "look", "edit"], 3));
    let cases = 0;
    for (const q of seqs) {
      // from Edit, nothing selected, the tab shut
      api.body.enter("look");
      await pick(null);
      api.body.enter("edit");
      await step();
      expect(tab().isOpen()).toBe(false);
      let m = { edit: true, sel: null, open: false, dismissed: false };
      for (const e of q) {
        await apply(e);
        m = model(m, e);
        expect(tab().isOpen(), q.join(" ")).toBe(m.open);
        // the tree comes with it: shown iff the pane is
        expect(s.root.querySelectorAll(".scene-outline").length, q.join(" ")).toBe(m.open ? 1 : 0);
      }
      cases++;
    }
    expect(cases).toBe(1 + 9 + 81 + 125);
  }, 60_000);

  it("following the selection, it comes in behind a pane already shown (the parts bin), a tab to pick; alone, it shows", async () => {
    const pane = document.createElement("div");
    const other = { meta: { id: "t.bin" }, module: { create: (api) => (api.dock(pane, { title: "Bin" }), {}) } };
    await bare({ a: object({ name: "A" }) }, [other]);
    expect(s.debug.drawer().shown).toBe(pane);
    await select("a");
    expect(tab().isOpen()).toBe(true);
    expect(s.debug.drawer()).toEqual({ order: [pane, tab().body], shown: pane });
  });

  it("the toolbar's Inspector says whether its tab is open, in the flush after it shuts (local.drawer)", async () => {
    const toolbar = (await import("./toolbar.js")).default;
    await bare({ a: object({ name: "A" }) }, [{ meta: { id: "scene.toolbar" }, module: toolbar }]);
    const pressed = () => s.root.querySelector('.toolbar [data-command="inspector"]')?.getAttribute("aria-pressed");
    expect(pressed()).toBe("false");
    await select("a");
    expect(pressed()).toBe("true");
    await select(null);
    expect(pressed()).toBe("true");
    s.root.querySelector(".stage-drawer-tab-close").click();
    await settle();
    expect(tab().isOpen()).toBe(false);
    expect(pressed()).toBe("false");
  });

  it("startBodies: Look and Edit, each body on offer once, then the doc's own if nothing here offers it", () => {
    const collected = [
      { id: "walk", value: [{ id: "walk", label: "Walk", enter() {} }] },
      { id: "seats", value: [{ id: "seat", label: "Seated", enter() {} }, { id: "walk", label: "Again" }] },
      { id: "junk", value: "nope" },
    ];
    expect(startBodies(collected)).toEqual([
      ["look", "Look"],
      ["edit", "Edit"],
      ["walk", "Walk"],
      ["seat", "Seated"],
    ]);
    expect(startBodies(collected, "aboard").at(-1)).toEqual(["aboard", "aboard"]);
    expect(startBodies([], "look")).toEqual([
      ["look", "Look"],
      ["edit", "Edit"],
    ]);
    // a body no longer anyone's (an old doc's "orbit") still shows as chosen
    expect(startBodies([], "orbit").at(-1)).toEqual(["orbit", "orbit"]);
  });

  it("Starts in writes view.start.body (Look is no key), drops the place, keeps the home; an edit undo takes back", async () => {
    const walker = { meta: { id: "t.walk" }, module: { create: () => ({ bodies: [{ id: "walk", label: "Walk", enter: () => null }] }) } };
    s = await mountStage({
      extensions: [INSPECTOR, OPENED, walker],
      doc: { objects: {}, order: [], view: { start: { body: "seat", place: "p1", home: { position: [1, 1, 1], target: [0, 0, 0] } } } },
    });
    await settle();
    // the doc starts people seated (nothing here offers a seat: Look); the inspector is Edit's
    expect(s.local.get().body.id).toBe("look");
    expect(s.instance("scene.inspector").tab.isOpen()).toBe(false);
    s.api("scene.inspector").body.enter("edit");
    s.api("scene.inspector").run({ ext: "scene.inspector", command: "inspector", value: true });
    await settle();
    const radios = () => [...s.instance("scene.inspector").tab.body.querySelectorAll("input[data-body]")];
    expect(radios().map((r) => [r.dataset.body, r.checked])).toEqual([
      ["look", false],
      ["edit", false],
      ["walk", false],
      ["seat", true],
    ]);
    const pick = (r) => {
      r.checked = true;
      r.dispatchEvent(new Event("change", { bubbles: true }));
    };
    pick(radios()[2]);
    expect(s.doc().view.start).toEqual({ body: "walk", home: { position: [1, 1, 1], target: [0, 0, 0] } });
    pick(radios()[0]);
    expect(s.doc().view.start).toEqual({ home: { position: [1, 1, 1], target: [0, 0, 0] } });
    expect(s.local.get().edits.undo).toBe("Starts in");
    s.api("scene.inspector").undo();
    expect(s.doc().view.start).toEqual({ body: "walk", home: { position: [1, 1, 1], target: [0, 0, 0] } });
    s.api("scene.inspector").undo();
    expect(s.doc().view.start).toEqual({ body: "seat", place: "p1", home: { position: [1, 1, 1], target: [0, 0, 0] } });
  });
});
