import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import { FakeRepo } from "../test/fake-repo.js";
import { applyMatrix } from "../transform.js";
import { worldMatrix } from "../hierarchy.js";
import inspector from "./inspector.js";
import { aboutFor, attachOptions, commandsFor, groupOptions, lensNamed, statusParts } from "./inspector-model.js";
import { resolveParents } from "../hierarchy.js";
import { resolveGroups } from "../groups.js";

const INSPECTOR = { meta: { id: "scene.inspector" }, module: inspector };

// A stand-in for scene.sidebar: mounts every panel in a right edge and updates it each flush.
const SIDEBAR = {
  meta: { id: "t.sidebar" },
  module: {
    create(api) {
      const edge = api.edge("right");
      const mounted = new Map();
      return {
        update(scene, local) {
          for (const { value } of api.collect("panels")) {
            for (const p of value ?? []) {
              if (!mounted.has(p.id)) {
                const body = document.createElement("div");
                body.className = "panel-body";
                body.dataset.panel = p.id;
                edge.append(body);
                mounted.set(p.id, p.mount(body) ?? {});
              }
              mounted.get(p.id).update?.(scene, local);
            }
          }
        },
      };
    },
  },
};

const group = (name, parent = null, extra = {}) => ({ kind: "group", name, group: parent, visible: true, opacity: 1, ...extra });
const T = (position = [0, 0, 0], rotation = [0, 0, 0], scale = 1) => ({ position, rotation, scale });

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

beforeAll(() => {
  // a stand-in for the host's embed element (About and the build controls use it when it's there)
  if (!customElements.get("patchwork-view")) customElements.define("patchwork-view", class extends HTMLElement {});
});

async function mount({ objects, extensions = [], doc = {}, repo } = {}) {
  const ids = extensions.map((e) => e.meta.id);
  s = await mountStage({
    repo,
    extensions: [SIDEBAR, INSPECTOR, ...extensions],
    kits: [{ id: "model", extensions: ["t.sidebar", "scene.inspector", ...ids] }],
    doc: { objects, order: Object.keys(objects), ...doc },
  });
  return s;
}

const body = () => s.root.querySelector('.panel-body[data-panel="inspector"]');
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

describe("scene.inspector: the panel", () => {
  it("is hidden with a hint when nothing is selected, and shows the selection", async () => {
    await mount({ objects: { a: object({ name: "A", opacity: 0.5, color: "#ff0000", wireframe: true }) } });
    expect(body().hidden).toBe(true);
    expect(body().textContent).toBe("Nothing selected");
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
    // the object goes: the panel empties
    s.change((d) => delete d.objects.a);
    await settle();
    expect(body().hidden).toBe(true);
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
    expect(body().hidden).toBe(true);
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

  it("About: the object's infoUrl, else the nearest group's, labelled; Open dispatches; hidden when there's none", async () => {
    const repo = new FakeRepo();
    const info = repo.add({ title: "hull notes" });
    const vesselInfo = repo.add({ title: "the boat" });
    const objects = {
      vessel: group("Solander 38", null, { infoUrl: vesselInfo.url }),
      body: group("BODY", "vessel"),
      hull: object({ name: "HULL", group: "body", infoUrl: info.url }),
      deck: object({ name: "DECK", group: "body" }),
      loose: object({ name: "LOOSE" }),
    };
    await mount({ objects, repo });
    await select("hull");
    let views = body().querySelectorAll(".about .about-embed > patchwork-view");
    expect(views.length).toBe(1);
    expect(views[0].getAttribute("doc-url")).toBe(info.url);
    expect($(".about-title").textContent).toBe("About");
    const embed = $(".about-embed");
    s.change((d) => (d.objects.hull.opacity = 0.4));
    await settle();
    expect($(".about-embed")).toBe(embed); // unchanged About: the same view stays mounted
    await select("deck");
    views = s.root.querySelectorAll("patchwork-view");
    expect(views.length).toBe(1);
    expect(views[0].getAttribute("doc-url")).toBe(vesselInfo.url);
    expect($(".about-title").textContent).toBe("About Solander 38");
    const opened = [];
    s.element.addEventListener("patchwork:open-document", (e) => opened.push(e.detail));
    $(".open-about").click();
    expect(opened).toEqual([{ url: vesselInfo.url }]);
    await select("loose");
    expect($(".about").hidden).toBe(true);
  });

  it("a passthrough GLB: Open file, and its stats in the status line; no Build section", async () => {
    const repo = new FakeRepo();
    const file = repo.add({ "@patchwork": { type: "file" }, name: "hull.glb", extension: "glb" });
    await mount({ repo, objects: { a: object({ name: "A", sourceUrl: file.url, visible: false, hint: { triangles: 434, bytes: 18492 } }) } });
    await select("a");
    expect($(".status-line").textContent).toBe("434 triangles · 18 KB · not loaded (hidden)");
    expect($(".controls-embed")).toBeNull();
    const opened = [];
    s.element.addEventListener("patchwork:open-document", (e) => opened.push(e.detail));
    $(".open-file").click();
    expect(opened).toEqual([{ url: file.url }]);
  });

  it("a render-doc object embeds the build controls on its render doc", async () => {
    const repo = new FakeRepo();
    const file = repo.add({ "@patchwork": { type: "file" }, name: "x.stl", extension: "stl" });
    const render = repo.add({ "@patchwork": { type: "scene-render" }, title: "x", parent: file.url, providerId: "file-glb", params: {}, glbUrl: null, builtFrom: null, builtAt: null, status: "idle", error: null, pinned: false });
    await mount({ repo, objects: { a: object({ name: "A", sourceUrl: file.url, renderUrl: render.url, visible: false }) } });
    await select("a");
    const v = $(".controls-embed > patchwork-view");
    expect(v.getAttribute("doc-url")).toBe(render.url);
    expect(v.getAttribute("tool-id")).toBe("scene-render-controls");
    expect($(".build-head").textContent).toBe("Build");
    expect($(".open-file")).toBeNull();
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
    expect(statusParts(o, { status: { state: "warn" } })[0].text).toMatch(/Provider “p” is not installed/);
    expect(statusParts(o, { status: { state: "stale", title: "Out of date; rebuilding soon" } })).toEqual([]);
    expect(statusParts(o, { status: { state: "stale", title: "A collaborator built it differently" } })).toEqual([{ kind: "warn", text: "A collaborator built it differently" }]);
    const p = object({ sourceUrl: "automerge:x" });
    expect(statusParts(p, { content: { loaded: true, stats: { triangles: 20000, drawCalls: 1, instanced: 0 } } })).toEqual([{ kind: "notes", text: "20 k triangles · 1 draw call" }]);
    expect(statusParts(p, { status: { state: "error", title: "GLB failed" } })).toEqual([{ kind: "error", text: "GLB failed" }]);
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
