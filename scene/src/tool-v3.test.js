// SCENE-CONTRACT v3 in the mounted tool (no WebGL): passthrough objects,
// groups and the collapsible outline, visibility-gated hydration, the About
// section. The v1/v2 behaviour is covered by tool.test.js.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeRepo, flush } from "./test/fake-repo.js";
import { worldMatrix } from "./hierarchy.js";
import { applyMatrix } from "./transform.js";

vi.mock("@inkandswitch/patchwork-plugins", () => {
  const registries = new Map();
  function makeRegistry() {
    const plugins = new Map();
    return {
      register(p) {
        plugins.set(p.id, { ...p });
      },
      has: (id) => plugins.has(id),
      get: (id) => plugins.get(id),
      filter: (fn) => [...plugins.values()].filter(fn),
      async load(id) {
        const p = plugins.get(id);
        if (!p) return undefined;
        if (!p.module) p.module = await p.load();
        return p;
      },
      on: () => () => {},
    };
  }
  return {
    getRegistry(type) {
      if (!registries.has(type)) registries.set(type, makeRegistry());
      return registries.get(type);
    },
  };
});

const { getRegistry } = await import("@inkandswitch/patchwork-plugins");
const { plugins } = await import("./index.js");
const { SceneDatatype } = await import("./datatype.js");
const { default: SceneTool } = await import("./tool.js");
const { encodeGLB, computeNormals } = await import("./glb.js");
for (const p of plugins) getRegistry(p.type).register(p);

// a stand-in <patchwork-view>, so the About section has something to mount
class FakeView extends HTMLElement {}
if (!customElements.get("patchwork-view")) customElements.define("patchwork-view", FakeView);

const tri = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const GLB = encodeGLB({ meshes: [{ name: "t", positions: tri, normals: computeNormals(tri) }] });
const T = (position = [0, 0, 0], rotation = [0, 0, 0], scale = 1) => ({ position, rotation, scale });

function newScene(repo, extra = {}) {
  const doc = {};
  SceneDatatype.init(doc);
  return repo.add({ "@patchwork": { type: "scene" }, ...doc, ...extra });
}

const glbFile = (repo, name = "part.glb") => repo.add({ "@patchwork": { type: "file" }, name, extension: "glb", mimeType: "model/gltf-binary", content: GLB });
const group = (name, parent = null, extra = {}) => ({ kind: "group", name, sourceUrl: null, providerId: null, renderUrl: null, parent, visible: true, color: null, opacity: 1, wireframe: false, transform: T(), ...extra });
const layer = (name, sourceUrl, parent, extra = {}) => ({ kind: "object", name, sourceUrl, providerId: "file-glb", renderUrl: null, parent, visible: true, color: null, opacity: 1, wireframe: false, transform: T(), ...extra });

describe("scene tool v3 (mounted, no WebGL)", () => {
  let repo, element, cleanup, finds;
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      localStorage.clear();
    } catch {
      // none
    }
    repo = new FakeRepo();
    finds = [];
    const find = repo.find.bind(repo);
    repo.find = (url) => (finds.push(url), find(url));
    element = document.createElement("div");
    element.repo = repo;
    document.body.append(element);
  });
  afterEach(() => {
    cleanup?.();
    cleanup = null;
    element.remove();
    vi.restoreAllMocks();
  });
  const mount = (scene) => (cleanup = SceneTool(scene, element));
  const rows = () => [...element.querySelectorAll(".object-row")].map((r) => r.dataset.id);
  const row = (id) => element.querySelector(`.object-row[data-id="${id}"]`);

  /**
   * vessel (group, down 0.7) ─┬─ body (group) ─┬─ hull   (visible, infoUrl)
   *                           │                └─ deck   (visible)
   *                           └─ bhd (hidden)
   * battery (group, hidden) ── cell
   */
  function vesselScene() {
    const files = { hull: glbFile(repo, "HULL.glb"), deck: glbFile(repo, "DECK.glb"), bhd: glbFile(repo, "bhd.glb"), cell: glbFile(repo, "CELL.glb") };
    const info = repo.add({ "@patchwork": { type: "markdown" }, content: "# Hull" });
    const vesselInfo = repo.add({ "@patchwork": { type: "markdown" }, content: "# About" });
    const objects = {
      vessel: group("Solander 38", null, { transform: T([0, -0.7, 0]), infoUrl: vesselInfo.url }),
      body: group("BODY", "vessel"),
      hull: layer("HULL", files.hull.url, "body", { infoUrl: info.url, hint: { bounds: { min: [-11, 0, -3], max: [0, 2, 3] }, triangles: 434, bytes: 18492 } }),
      deck: layer("DECK", files.deck.url, "body"),
      bhd: layer("console bhd", files.bhd.url, "vessel", { visible: false }),
      battery: group("Battery (display)", null, { visible: false }),
      cell: layer("CELL", files.cell.url, "battery"),
    };
    const scene = newScene(repo, { objects, order: Object.keys(objects) });
    return { scene, files, info, vesselInfo };
  }

  it("adds a GLB through the passthrough provider: no render doc, no copy, shown from the file", async () => {
    const scene = newScene(repo);
    mount(scene);
    const file = glbFile(repo);
    const e = new Event("drop", { bubbles: true, cancelable: true });
    e.dataTransfer = { types: ["text/plain"], files: [], getData: (t) => (t === "text/plain" ? file.url : "") };
    element.querySelector(".viewport").dispatchEvent(e);
    await flush();
    await flush();
    const [id] = Object.keys(scene.doc().objects);
    expect(scene.doc().objects[id]).toMatchObject({ sourceUrl: file.url, providerId: "file-glb", renderUrl: null });
    expect(repo.created.length).toBe(0); // no scene-render doc, no GLB copy
    await flush();
    expect(file.listenerCount("change")).toBe(1); // subscribed once loaded, nothing else
    expect(row(id).querySelector(".pill")).toBeNull(); // loaded: no "loading" pill
    // no Build section for it
    expect([...element.querySelectorAll(".inspector .panel-title")].map((h) => h.textContent)).not.toContain("Build");
  });

  it("an object added before v3 (file-glb with a render doc) keeps the render-doc path", async () => {
    const file = glbFile(repo);
    const render = repo.add({ "@patchwork": { type: "scene-render" }, title: "old", parent: file.url, providerId: "file-glb", params: {}, glbUrl: null, builtFrom: null, builtAt: null, status: "idle", error: null, pinned: false });
    const scene = newScene(repo, { objects: { old: { name: "old", sourceUrl: file.url, providerId: "file-glb", renderUrl: render.url, visible: true, color: null, opacity: 1, wireframe: false, transform: T() } }, order: ["old"] });
    mount(scene);
    // a render doc the scene didn't make waits out the sync settle window first
    await new Promise((r) => setTimeout(r, 2_700));
    await flush();
    expect(render.doc().glbUrl).toBeTruthy(); // built by the provider, as before
    expect(render.doc().status).toBe("idle");
    expect(window.__sceneDebug.queue.has("old")).toBe(false);
  });

  it("only fetches effectively visible objects; showing a group fetches its contents", async () => {
    const { scene, files } = vesselScene();
    mount(scene);
    await flush();
    expect(new Set(finds)).toEqual(new Set([files.hull.url, files.deck.url]));
    for (const f of [files.bhd, files.cell]) expect(f.listenerCount("change")).toBe(0);
    // hidden things show no "loading" forever
    expect(element.querySelector('.object-row[data-id="battery"] .pill')).toBeNull();
    scene.change((d) => (d.objects.battery.visible = true));
    await flush();
    expect(finds).toContain(files.cell.url);
    // hiding again keeps what was loaded
    scene.change((d) => (d.objects.battery.visible = false));
    await flush();
    expect(files.cell.listenerCount("change")).toBe(1);
  });

  it("outline: roots open, deeper groups closed, per-viewer state in localStorage", async () => {
    const { scene } = vesselScene();
    mount(scene);
    expect(rows()).toEqual(["vessel", "body", "bhd", "battery"]);
    expect(row("vessel").getAttribute("aria-expanded")).toBe("true");
    row("body").querySelector(".twisty").click();
    expect(rows()).toEqual(["vessel", "body", "hull", "deck", "bhd", "battery"]);
    expect(JSON.parse(localStorage.getItem(`scene-outline:${scene.url}`))).toEqual({ body: true });
    expect(scene.doc().objects.body).not.toHaveProperty("expanded"); // never in the doc
    // ←/→ on a focused row
    row("vessel").querySelector(".row-main").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(rows()).toEqual(["vessel", "battery"]);
    // a second mount (same viewer) remembers
    cleanup();
    cleanup = null;
    mount(scene);
    expect(rows()).toEqual(["vessel", "battery"]);
    row("vessel").querySelector(".row-main").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(rows()).toEqual(["vessel", "body", "hull", "deck", "bhd", "battery"]);
  });

  it("a group's checkbox writes group.visible once and shows indeterminate when something below is hidden", async () => {
    const { scene } = vesselScene();
    mount(scene);
    const vis = row("vessel").querySelector('input[type="checkbox"]');
    expect(vis.checked).toBe(true);
    expect(vis.indeterminate).toBe(true); // bhd is hidden
    expect(row("body").querySelector('input[type="checkbox"]').indeterminate).toBe(false);
    let writes = 0;
    scene.on("change", () => writes++);
    vis.checked = false;
    vis.dispatchEvent(new Event("change"));
    expect(writes).toBe(1);
    expect(scene.doc().objects.vessel.visible).toBe(false);
    expect(scene.doc().objects.hull.visible).toBe(true); // children keep their own flags
    expect(row("body").hasAttribute("data-hidden")).toBe(true); // but read as hidden
    expect(row("vessel").querySelector(".pill")).toBeNull(); // groups never show a status
  });

  it("removing a group asks, with a count, and takes everything in it", async () => {
    const { scene } = vesselScene();
    scene.change((d) => {
      d.dimensions.d1 = { a: { objectId: "hull", local: [0, 0, 0], world: [0, -0.7, 0] }, b: { objectId: null, local: null, world: [1, 0, 0] }, label: null };
    });
    mount(scene);
    const ask = vi.spyOn(globalThis, "confirm").mockReturnValue(false);
    row("vessel").querySelector(".icon-button").click();
    expect(ask).toHaveBeenCalledWith(expect.stringContaining("and the 4 objects in it"));
    expect(scene.doc().objects.vessel).toBeTruthy();
    ask.mockReturnValue(true);
    row("vessel").querySelector(".icon-button").click();
    expect(Object.keys(scene.doc().objects).sort()).toEqual(["battery", "cell"]);
    expect(scene.doc().order).toEqual(["battery", "cell"]);
    expect(scene.doc().dimensions.d1.a).toEqual({ objectId: null, local: null, world: [0, -0.7, 0] });
  });

  it("ungroups in the inspector, keeping world poses", async () => {
    const { scene } = vesselScene();
    scene.change((d) => {
      d.objects.body.transform = T([1, 0, 0], [0, Math.PI / 2, 0], 2);
      d.objects.hull.transform = T([0, 0, 1]);
    });
    const before = applyMatrix(worldMatrix(scene.doc().objects, "hull"), [0, 0, 0]);
    mount(scene);
    row("body").querySelector(".row-main").click();
    expect(element.querySelector(".inspector .panel-title").textContent).toBe("Group");
    [...element.querySelectorAll(".inspector button")].find((b) => b.textContent === "Ungroup").click();
    const objects = scene.doc().objects;
    expect(objects.body).toBeUndefined();
    expect(objects.hull.parent).toBe("vessel");
    applyMatrix(worldMatrix(objects, "hull"), [0, 0, 0]).forEach((v, i) => expect(v).toBeCloseTo(before[i], 9));
  });

  it("filters the outline over name and path, with a count; Enter selects the first match, Esc clears", async () => {
    const { scene } = vesselScene();
    // enough objects for the filter field
    scene.change((d) => {
      for (let i = 0; i < 6; i++) {
        d.objects[`x${i}`] = { ...layer(`extra ${i}`, null, "battery"), sourceUrl: null };
        d.order.push(`x${i}`);
      }
    });
    mount(scene);
    const box = element.querySelector(".outline-search");
    expect(box.hidden).toBe(false);
    const input = element.querySelector(".outline-filter");
    input.value = "body hul";
    input.dispatchEvent(new Event("input"));
    expect(rows()).toEqual(["vessel", "body", "hull"]);
    expect(row("vessel").hasAttribute("data-context")).toBe(true);
    expect(row("hull").hasAttribute("data-context")).toBe(false);
    expect(element.querySelector(".match-count").textContent).toBe("1 of 13");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(row("hull").hasAttribute("data-selected")).toBe(true);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(input.value).toBe("");
    expect(rows()).toEqual(["vessel", "body", "hull", "deck", "bhd", "battery"]); // body was revealed for the selection
    expect(element.querySelector(".inspector").hidden).toBe(false); // Esc in the field doesn't deselect
  });

  it("About: the object's infoUrl, else the nearest group's, labelled; one view at a time; Open dispatches", async () => {
    const { scene, info, vesselInfo } = vesselScene();
    mount(scene);
    row("vessel").querySelector(".twisty").click(); // (already open) keep it
    row("vessel").querySelector(".twisty").click();
    row("body").querySelector(".twisty").click();
    row("hull").querySelector(".row-main").click();
    let views = element.querySelectorAll(".inspector .about patchwork-view");
    expect(views.length).toBe(1);
    expect(views[0].getAttribute("doc-url")).toBe(info.url);
    expect(element.querySelector(".inspector .about-title").textContent).toBe("About");
    row("deck").querySelector(".row-main").click();
    views = element.querySelectorAll(".scene-tool patchwork-view");
    expect(views.length).toBe(1);
    expect(views[0].getAttribute("doc-url")).toBe(vesselInfo.url);
    expect(element.querySelector(".inspector .about-title").textContent).toBe("About Solander 38");
    const opened = [];
    element.addEventListener("patchwork:open-document", (e) => opened.push(e.detail));
    element.querySelector(".inspector .open-about").click();
    expect(opened).toEqual([{ url: vesselInfo.url }]);
    // nothing to show: the section is hidden
    row("battery").querySelector(".row-main").click();
    expect(element.querySelector(".inspector .about").hidden).toBe(true);
  });

  it("'Attached to' lists groups first, as a tree; New group and Group wrap without moving anything", async () => {
    const { scene } = vesselScene();
    mount(scene);
    row("bhd").querySelector(".row-main").click();
    const attach = element.querySelector(".inspector select.attach");
    const groupsOpt = attach.querySelector('optgroup[label="Groups"]');
    expect([...groupsOpt.querySelectorAll("option")].map((o) => o.value)).toEqual(["vessel", "body", "battery"]);
    expect(groupsOpt.querySelector('option[value="body"]').textContent).toMatch(/^\s+BODY$/);
    const before = applyMatrix(worldMatrix(scene.doc().objects, "bhd"), [0, 0, 0]);
    [...element.querySelectorAll(".inspector button")].find((b) => b.textContent === "Group").click();
    const objects = scene.doc().objects;
    const gid = objects.bhd.parent;
    expect(objects[gid]).toMatchObject({ kind: "group", parent: "vessel", renderUrl: null, sourceUrl: null });
    expect(scene.doc().order.indexOf(gid)).toBe(scene.doc().order.indexOf("bhd") - 1);
    applyMatrix(worldMatrix(objects, "bhd"), [0, 0, 0]).forEach((v, i) => expect(v).toBeCloseTo(before[i], 9));
    // New group goes inside the selected group
    element.querySelector(".new-group").click();
    const added = Object.keys(scene.doc().objects).find((k) => !objects[k]);
    expect(scene.doc().objects[added].parent).toBe(gid);
  });

  it("toggles one of 507 objects quickly and fetches only the shown ones", async () => {
    const objects = {};
    const files = [];
    for (let g = 0; g < 129; g++) objects[`g${g}`] = group(`G${g}`, g ? `g${Math.floor((g - 1) / 4)}` : null);
    for (let i = 0; i < 378; i++) {
      const f = glbFile(repo, `l${i}.glb`);
      files.push(f);
      objects[`o${i}`] = layer(`layer ${i}`, f.url, `g${i % 129}`, { visible: i < 74 });
    }
    const scene = newScene(repo, { objects, order: Object.keys(objects) });
    mount(scene);
    for (let i = 0; i < 20; i++) await flush();
    expect(new Set(finds).size).toBe(74);
    const t0 = performance.now();
    scene.change((d) => (d.objects.o200.visible = true));
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(60); // happy-dom; the browser probe measures the real thing
    await flush();
    expect(new Set(finds).size).toBe(75);
    expect(element.querySelectorAll(".object-row").length).toBeLessThan(20); // collapsed: only the top of the tree
  });
  it("Rebuild on a hidden render-doc object (not hydrated) loads it and builds, instead of swallowing the click", async () => {
    const file = glbFile(repo);
    const render = repo.add({ "@patchwork": { type: "scene-render" }, title: "old", parent: file.url, providerId: "file-glb", params: {}, glbUrl: null, builtFrom: null, builtAt: null, status: "idle", error: null, pinned: false });
    const scene = newScene(repo, { objects: { old: { name: "old", sourceUrl: file.url, providerId: "file-glb", renderUrl: render.url, visible: false, color: null, opacity: 1, wireframe: false, transform: T() } }, order: ["old"] });
    mount(scene);
    await flush();
    expect(window.__sceneDebug.manager.ids()).toEqual([]); // hidden: not tracked
    const ev = new CustomEvent("scene:rebuild", { detail: { renderUrl: render.url }, bubbles: true, cancelable: true, composed: true });
    element.querySelector(".inspector").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    await flush();
    expect(window.__sceneDebug.manager.ids()).toEqual(["old"]);
    expect(render.doc().glbUrl).toBeTruthy();
    expect(repo.created.length).toBeGreaterThan(0);
  });

  it("a layer dropped from the queue before it loaded (hidden again) shows no loading or error state", async () => {
    const objects = { g: group("G") };
    const urls = [];
    for (let i = 0; i < 8; i++) {
      const f = glbFile(repo, `l${i}.glb`);
      urls.push(f.url);
      objects[`l${i}`] = layer(`l${i}`, f.url, "g", { hint: { bounds: { min: [0, 0, 0], max: [8 - i, 1, 1] } } });
    }
    const never = new Promise(() => {});
    const find = repo.find;
    repo.find = (url) => (urls.includes(url) ? never : find(url));
    const scene = newScene(repo, { objects, order: Object.keys(objects) });
    mount(scene);
    await flush();
    expect(window.__sceneDebug.queue.ids().length).toBe(8);
    expect(row("l7").querySelector(".pill")?.textContent).toBe("loading"); // queued behind 4 finds
    scene.change((d) => (d.objects.g.visible = false));
    await flush();
    expect(window.__sceneDebug.queue.ids().length).toBe(4); // the queued four are gone
    expect(row("l7").querySelector(".pill")).toBeNull();
    row("l7").querySelector(".row-main").click();
    expect(element.querySelector(".inspector .status-line").textContent).toContain("not loaded (hidden)");
  });

  it("keys, pastes and drops inside the About document are its own, not the scene's", async () => {
    const { scene } = vesselScene();
    mount(scene);
    row("body").querySelector(".twisty").click();
    row("hull").querySelector(".row-main").click();
    const embed = element.querySelector(".about-embed");
    expect(embed).toBeTruthy();
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    embed.querySelector("patchwork-view").append(editor);
    const paste = (target, text) => {
      const e = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(e, "clipboardData", { value: { getData: () => text } });
      target.dispatchEvent(e);
      return e;
    };
    const other = glbFile(repo, "other.glb");
    const n = Object.keys(scene.doc().objects).length;
    expect(paste(editor, `see [it](${other.url})`).defaultPrevented).toBe(false);
    const inner = document.createElement("span");
    embed.querySelector("patchwork-view").append(inner);
    inner.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true }));
    expect(element.querySelector('[data-action="measure"]').getAttribute("aria-pressed")).toBe("false");
    inner.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(element.querySelector(".about-embed")).toBe(embed); // still selected, still mounted
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { types: ["Files"], files: [new File([new Uint8Array(4)], "x.glb")], getData: () => "" } });
    inner.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(false);
    await flush();
    await flush();
    expect(Object.keys(scene.doc().objects).length).toBe(n);
    expect(repo.created.length).toBe(0);
    // the same paste outside the embed still adds
    paste(element.querySelector(".viewport"), other.url);
    await flush();
    await flush();
    expect(Object.keys(scene.doc().objects).length).toBe(n + 1);
  });
});
