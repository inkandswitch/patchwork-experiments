import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeRepo, flush } from "./test/fake-repo.js";

// A stand-in for the host's plugin registry (the real one comes from the importmap).
vi.mock("@inkandswitch/patchwork-plugins", () => {
  const registries = new Map();
  function makeRegistry() {
    const plugins = new Map();
    const listeners = new Set();
    return {
      register(p) {
        plugins.set(p.id, { ...p });
        for (const l of listeners) l();
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
      on(ev, fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
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

for (const p of plugins) getRegistry(p.type).register(p);

const STL = `solid part
facet normal 0 0 0
outer loop
vertex 0 0 0
vertex 10 0 0
vertex 0 10 0
endloop
endfacet
endsolid part
`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function newScene(repo) {
  const doc = {};
  SceneDatatype.init(doc);
  return repo.add({ "@patchwork": { type: "scene" }, ...doc });
}

describe("scene tool (mounted, no WebGL)", () => {
  let repo, scene, file, element, cleanup;
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    repo = new FakeRepo();
    scene = newScene(repo);
    file = repo.add({ "@patchwork": { type: "file" }, name: "part.stl", extension: "stl", mimeType: "model/stl", content: STL });
    element = document.createElement("div");
    element.repo = repo;
    document.body.append(element);
    cleanup = SceneTool(scene, element);
  });
  afterEach(() => {
    cleanup?.();
    element.remove();
    vi.restoreAllMocks();
  });

  /** A drag of `url` from the sidebar, dropped on `onto` (the viewport by default). */
  function dropEvent(url, { mime = "text/plain" } = {}) {
    const e = new Event("drop", { bubbles: true, cancelable: true });
    e.dataTransfer = {
      types: [mime],
      files: [],
      getData: (t) => (t === mime ? url : ""),
    };
    return e;
  }

  // The URL bar is gone: dragging a document in is the way, and this is that
  // drag. A paste anywhere outside an input still works too.
  async function addByUrl(url, onto = null) {
    (onto ?? element.querySelector(".viewport")).dispatchEvent(dropEvent(url));
    await flush();
    await flush();
  }

  it("shows an empty state and a WebGL notice", () => {
    expect(element.querySelector(".scene-tool")).toBeTruthy();
    expect(element.querySelector(".empty").hidden).toBe(false);
    expect(element.querySelector(".no-webgl").hidden).toBe(false);
  });

  it("adds an STL by URL: render doc with defaults, renderUrl written once, built to a GLB", async () => {
    await addByUrl(file.url);
    const objects = scene.doc().objects;
    const [id] = Object.keys(objects);
    const o = objects[id];
    expect(o).toMatchObject({ name: "part.stl", sourceUrl: file.url, providerId: "file-stl", visible: true, color: null, opacity: 1 });
    expect(scene.doc().order).toEqual([id]);
    const render = (await repo.find(o.renderUrl)).doc();
    expect(render).toMatchObject({ "@patchwork": { type: "scene-render" }, parent: file.url, providerId: "file-stl", params: { unit: "mm", up: "z" } });
    await wait(20);
    await flush();
    const built = (await repo.find(o.renderUrl)).doc();
    expect(built.status).toBe("idle");
    expect(built.glbUrl).toBeTruthy();
    expect((await repo.find(built.glbUrl)).doc().extension).toBe("glb");
    expect(file.doc().content).toBe(STL); // source untouched
    const rows = element.querySelectorAll(".object-row");
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("part");
  });

  it("keeps outline rows (and the colour input being dragged) across doc changes", async () => {
    await addByUrl(file.url);
    const [id] = Object.keys(scene.doc().objects);
    const swatch = element.querySelector(".object-row .swatch");
    swatch.value = "#ff0000";
    swatch.dispatchEvent(new Event("input"));
    expect(scene.doc().objects[id].color).toBe("#ff0000");
    expect(element.querySelector(".object-row .swatch")).toBe(swatch);
    expect(swatch.isConnected).toBe(true);
    swatch.value = "#00ff00";
    swatch.dispatchEvent(new Event("input"));
    expect(scene.doc().objects[id].color).toBe("#00ff00");
    expect(element.querySelector(".object-row .swatch")).toBe(swatch);
    scene.change((d) => (d.objects[id].name = "renamed"));
    expect(element.querySelector(".object-row .name").textContent).toBe("renamed");
    expect(element.querySelector(".object-row .swatch")).toBe(swatch);
  });

  it("embeds the controls, whose edits rebuild through the scene", async () => {
    await addByUrl(file.url);
    const [id] = Object.keys(scene.doc().objects);
    const renderUrl = scene.doc().objects[id].renderUrl;
    await wait(20);
    const firstGlb = (await repo.find(renderUrl)).doc().glbUrl;
    // add selected it; the inspector mounts the controls directly (no <patchwork-view> here)
    await flush();
    const controls = element.querySelector(".scene-render-controls");
    expect(controls).toBeTruthy();
    const select = controls.querySelector("select");
    expect(select.value).toBe("mm");
    select.value = "in";
    select.dispatchEvent(new Event("change"));
    expect((await repo.find(renderUrl)).doc().params.unit).toBe("in");
    await wait(300);
    await flush();
    const r = (await repo.find(renderUrl)).doc();
    expect(r.glbUrl).not.toBe(firstGlb);
    expect(JSON.parse(r.builtFrom.paramsKey)).toEqual({ unit: "in", up: "z" });

    // "rebuild now" goes through the scene (the event is claimed); same bytes, so same GLB doc
    const before = repo.created.length;
    const builtAt = r.builtAt;
    await wait(5);
    controls.querySelector(".rebuild").click();
    await wait(20);
    await flush();
    expect((await repo.find(renderUrl)).doc().builtAt).toBeGreaterThan(builtAt);
    expect(repo.created.length).toBe(before);
  });

  it("inspector shows build notes once, with no stray text and no duplicate status or buttons", async () => {
    await addByUrl(file.url);
    await wait(20);
    await flush();
    const inspector = element.querySelector(".inspector");
    const line = inspector.querySelector(".status-line");
    expect(line.textContent).toBe("1 triangle (ascii STL)");
    expect(inspector.textContent).not.toMatch(/null|undefined/);
    // status pill, "Open source" and "Rebuild now" come from the embedded controls only
    const buttons = [...inspector.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons.filter((t) => /rebuild/i.test(t))).toEqual(["Rebuild now"]);
    expect(buttons.filter((t) => /open source/i.test(t))).toEqual(["Open source"]);
    expect(inspector.querySelectorAll(".pill").length).toBe(1);
    expect(inspector.querySelector(".scene-render-controls").hasAttribute("data-standalone")).toBe(false);
  });

  it("toolbar toggles write view state; units change the inspector", async () => {
    element.querySelector('[data-view="bounds"]').click();
    expect(scene.doc().view.bounds).toBe(true);
    const units = element.querySelector(".units");
    units.value = "mm";
    units.dispatchEvent(new Event("change"));
    expect(scene.doc().view.units).toBe("mm");
    await addByUrl(file.url);
    const [id] = Object.keys(scene.doc().objects);
    scene.change((d) => (d.objects[id].transform.position[0] = 0.25));
    await flush();
    const x = element.querySelector(".inspector .triple input");
    expect(x.value).toBe("250");
    x.value = "100";
    x.dispatchEvent(new Event("change"));
    expect(scene.doc().objects[id].transform.position[0]).toBeCloseTo(0.1);
  });

  it("removing an object detaches its dimensions instead of deleting them", async () => {
    await addByUrl(file.url);
    const [id] = Object.keys(scene.doc().objects);
    scene.change((d) => {
      d.objects[id].transform.position = [1, 0, 0];
      d.dimensions.d1 = {
        a: { objectId: id, local: [0, 0, 0], world: [0, 0, 0] },
        b: { objectId: null, local: null, world: [1, 1, 0] },
        label: null,
      };
    });
    await flush();
    expect(element.querySelectorAll(".dimension-row").length).toBe(1);
    element.querySelector(".object-row .icon-button").click();
    await flush();
    expect(scene.doc().objects[id]).toBeUndefined();
    expect(scene.doc().order).toEqual([]);
    expect(scene.doc().dimensions.d1.a).toEqual({ objectId: null, local: null, world: [1, 0, 0] });
  });

  it("attaches an object in the inspector without moving it, nests it in the outline, and orphans it on remove", async () => {
    await addByUrl(file.url);
    const file2 = repo.add({ "@patchwork": { type: "file" }, name: "other.stl", extension: "stl", mimeType: "model/stl", content: STL });
    await addByUrl(file2.url);
    const [a, b] = scene.doc().order;
    scene.change((d) => {
      d.objects[a].transform = { position: [1, 0, 0], rotation: [0, Math.PI / 2, 0], scale: 2 };
      d.objects[b].transform = { position: [1, 0, -2], rotation: [0, 0, 0], scale: 1 };
    });
    await flush();
    // b is selected (added last); attach it to a
    const attach = element.querySelector(".inspector select.attach");
    expect([...attach.options].map((o) => o.value)).toEqual(["", a]);
    expect(attach.value).toBe("");
    attach.value = a;
    attach.dispatchEvent(new Event("change"));
    const ob = scene.doc().objects[b];
    expect(ob.parent).toBe(a);
    // world pose preserved: a is at x=1, turned 90° about y (its x axis points along world -z), scale 2;
    // b at world (1,0,-2) is 2 m along that axis, i.e. 1 unit of a's local x
    ob.transform.position.forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0][i], 9));
    ob.transform.rotation.forEach((v, i) => expect(v).toBeCloseTo([0, -Math.PI / 2, 0][i], 9));
    expect(ob.transform.scale).toBeCloseTo(0.5, 9);
    await flush();
    const rows = [...element.querySelectorAll(".object-row")];
    expect(rows.map((r) => [r.dataset.id, r.dataset.depth])).toEqual([[a, "0"], [b, "1"]]);
    expect(element.querySelector(".inspector .unit").textContent).toMatch(/relative to/);

    // a can't be attached to b now (b is attached to a)
    element.querySelector(`.object-row[data-id="${a}"] .row-main`).click();
    await flush();
    const attachA = element.querySelector(".inspector select.attach");
    expect([...attachA.options].map((o) => o.value)).toEqual([""]);

    // a dimension on b follows a when a moves
    scene.change((d) => {
      d.dimensions.d1 = { a: { objectId: b, local: [0, 0, 0], world: [1, 0, -2] }, b: { objectId: null, local: null, world: [0, 0, 0] }, label: null };
      d.objects[a].transform.position = [3, 0, 0];
    });
    await flush();
    expect(element.querySelector(".dimension-row").textContent).toContain("3.606 m"); // b is now at (3,0,-2)

    // removing a leaves b where it is in the world
    element.querySelector(`.object-row[data-id="${a}"] .icon-button`).click();
    await flush();
    const after = scene.doc().objects[b];
    expect(after.parent).toBeNull();
    after.transform.position.forEach((v, i) => expect(v).toBeCloseTo([3, 0, -2][i], 9));
    expect(after.transform.scale).toBeCloseTo(1, 9);
    expect(element.querySelector(".object-row").dataset.depth).toBe("0");
  });

  it("an attach clears the edge a merged cycle left behind, so the loser doesn't jump later", async () => {
    await addByUrl(file.url);
    const f2 = repo.add({ "@patchwork": { type: "file" }, name: "b.stl", extension: "stl", mimeType: "model/stl", content: STL });
    await addByUrl(f2.url);
    const f3 = repo.add({ "@patchwork": { type: "file" }, name: "c.stl", extension: "stl", mimeType: "model/stl", content: STL });
    await addByUrl(f3.url);
    const [x, y, c] = scene.doc().order;
    const [a, b] = [x, y].sort(); // the cycle is broken at the smaller id
    scene.change((d) => {
      d.objects[a].parent = b; // as two concurrent attaches merge
      d.objects[b].parent = a;
      d.objects[a].transform = { position: [5, 0, 0], rotation: [0, 0, 0], scale: 1 };
      d.objects[c].transform = { position: [0, 0, 7], rotation: [0, 0, 0], scale: 1 };
    });
    await flush();
    element.querySelector(`.object-row[data-id="${b}"] .row-main`).click();
    await flush();
    const attach = element.querySelector(".inspector select.attach");
    attach.value = c;
    attach.dispatchEvent(new Event("change"));
    const objs = scene.doc().objects;
    expect(objs[b].parent).toBe(c);
    expect(objs[a].parent).toBeNull(); // not silently re-attached to b
    expect(objs[a].transform.position).toEqual([5, 0, 0]);
  });

  it("rejects things it can't show", async () => {
    const todo = repo.add({ "@patchwork": { type: "todo" }, title: "x" });
    await addByUrl(todo.url);
    expect(Object.keys(scene.doc().objects)).toEqual([]);
    expect(element.querySelector(".toast").textContent).toMatch(/No scene provider/);
    // A drop that carries no url at all is refused by the drop itself, before
    // anything tries to open it — which is why this says something different
    // from the URL bar's old complaint.
    await addByUrl("not a url");
    expect(element.querySelector(".toast").textContent).toMatch(/Nothing droppable/);
  });

  // The row under the pointer decides where a drop goes, and how far down it
  // decides whether that means inside or beside. happy-dom has no layout, so a
  // row measures zero and `(clientY - top) / (height || 1)` is just clientY —
  // which is how these choose a band.
  function atRow(id, fraction, make) {
    const row = element.querySelector(`.object-row[data-id="${id}"]`);
    expect(row, `no row for ${id}`).toBeTruthy();
    const e = make();
    e.clientY = fraction;
    row.dispatchEvent(e);
    return e;
  }

  function addGroup(gid = "g1") {
    scene.change((d) => {
      d.objects[gid] = {
        kind: "group", name: "G", parent: null, sourceUrl: null, providerId: null, renderUrl: null,
        visible: true, color: null, opacity: 1, wireframe: false,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
      };
      d.order.push(gid);
    });
    return gid;
  }

  const rowDrag = (id, sceneUrl = scene.url) => {
    const e = new Event("drop", { bubbles: true, cancelable: true });
    const payload = JSON.stringify({ scene: sceneUrl, id });
    e.dataTransfer = { types: ["application/x-scene-object"], files: [], getData: (t) => (t === "application/x-scene-object" ? payload : "") };
    return e;
  };

  /** A plain object at the root, at `x`, without going through a provider. */
  function addLeaf(id, { parent = null, x = 0 } = {}) {
    scene.change((d) => {
      d.objects[id] = {
        kind: "object", name: id, parent, sourceUrl: null, providerId: "file-stl", renderUrl: null,
        visible: false, color: null, opacity: 1, wireframe: false,
        transform: { position: [x, 0, 0], rotation: [0, 0, 0], scale: 1 },
      };
      d.order.push(id);
    });
    return id;
  }

  it("a document dropped onto a group lands inside it", async () => {
    const g = addGroup();
    await flush();
    atRow(g, 0.5, () => dropEvent(file.url));
    await flush();
    await flush();
    const objects = scene.doc().objects;
    const added = Object.keys(objects).find((id) => id !== g);
    expect(added, "nothing was added").toBeTruthy();
    expect(objects[added].parent).toBe(g);
  });

  it("dropped at a row's edge it goes beside it, not inside", async () => {
    const g = addGroup();
    await flush();
    atRow(g, 0.05, () => dropEvent(file.url));
    await flush();
    await flush();
    const objects = scene.doc().objects;
    const added = Object.keys(objects).find((id) => id !== g);
    expect(objects[added].parent ?? null).toBe(null);
    // "before the group" means before it in the order, too.
    expect(scene.doc().order.indexOf(added)).toBeLessThan(scene.doc().order.indexOf(g));
  });

  it("dragging a row onto a group reparents it and keeps its world pose", async () => {
    await addByUrl(file.url);
    const [a] = scene.doc().order;
    const g = addGroup();
    scene.change((d) => {
      d.objects[g].transform = { position: [1, 0, 0], rotation: [0, 0, 0], scale: 2 };
      d.objects[a].transform = { position: [3, 0, 0], rotation: [0, 0, 0], scale: 1 };
    });
    await flush();
    atRow(g, 0.5, () => rowDrag(a));
    await flush();
    const o = scene.doc().objects[a];
    expect(o.parent).toBe(g);
    // The group is at x=1 scaled 2, so staying at world x=3 means local x=1.
    expect(o.transform.position[0]).toBeCloseTo(1, 6);
    expect(o.transform.scale).toBeCloseTo(0.5, 6);
  });

  it("refuses to put a group inside its own child, and changes nothing", async () => {
    const g = addGroup("g1");
    const child = addGroup("g2");
    scene.change((d) => (d.objects[child].parent = g));
    await flush();
    atRow(child, 0.5, () => rowDrag(g));
    await flush();
    expect(scene.doc().objects[g].parent ?? null).toBe(null);
    expect(element.querySelector(".toast").textContent).toMatch(/inside itself/);
  });

  it("a row released where it already sits writes nothing", async () => {
    for (const id of ["r", "x", "s"]) addLeaf(id);
    await flush();
    const heads = scene.heads();
    atRow("x", 0.2, () => rowDrag("x")); // its own top half
    atRow("r", 0.8, () => rowDrag("x")); // below r: the line between r and x
    atRow("s", 0.2, () => rowDrag("x")); // above s: the same line
    await flush();
    expect(scene.doc().order).toEqual(["r", "x", "s"]);
    expect(scene.heads()).toEqual(heads);
  });

  it("a group dropped on its own middle is a click, not a cycle", async () => {
    const g = addGroup();
    await flush();
    const heads = scene.heads();
    atRow(g, 0.5, () => rowDrag(g));
    await flush();
    expect(scene.heads()).toEqual(heads);
    expect(element.querySelector(".toast").hidden).toBe(true);
  });

  it("a reorder among siblings leaves the transform alone", async () => {
    addLeaf("r", { x: 1 });
    addLeaf("s", { x: 2 });
    scene.change((d) => (d.objects.s.transform.rotation = [0, 0, Math.PI]));
    await flush();
    const before = JSON.stringify(scene.doc().objects.s.transform);
    atRow("r", 0.2, () => rowDrag("s"));
    await flush();
    expect(scene.doc().order).toEqual(["s", "r"]);
    expect(JSON.stringify(scene.doc().objects.s.transform)).toBe(before);
  });

  // Two peers attached a1 under b1 and b1 under a1 at once; resolveParents
  // breaks it at a1, so a1 is a root at x=5 and b1 is under it. Moving b1 to
  // the top level must not let a1's old edge come back and move a1.
  it("a move clears a merged cycle first, so nothing else jumps", async () => {
    addLeaf("a1", { x: 5 });
    addLeaf("b1", { x: 3 });
    addLeaf("c1");
    scene.change((d) => {
      d.objects.a1.parent = "b1";
      d.objects.b1.parent = "a1";
    });
    await flush();
    atRow("c1", 0.2, () => rowDrag("b1"));
    await flush();
    const o = scene.doc().objects;
    expect(o.b1.parent ?? null).toBe(null);
    expect(o.a1.parent ?? null).toBe(null);
    expect(o.a1.transform.position).toEqual([5, 0, 0]);
  });

  it("a document dropped beside an attached object attaches to the same parent", async () => {
    addLeaf("A");
    addLeaf("B", { parent: "A" });
    await flush();
    atRow("B", 0.2, () => dropEvent(file.url));
    await flush();
    await flush();
    const objects = scene.doc().objects;
    const added = Object.keys(objects).find((id) => !["A", "B"].includes(id));
    expect(objects[added].parent).toBe("A");
    expect(scene.doc().order.indexOf(added)).toBe(scene.doc().order.indexOf("B") - 1);
  });

  it("a document dropped into a folded group opens it to show the new row", async () => {
    const g = addGroup();
    addLeaf("k", { parent: g });
    await flush();
    element.querySelector(`.object-row[data-id="${g}"] .twisty`).click();
    await flush();
    expect(element.querySelector('.object-row[data-id="k"]')).toBeNull();
    atRow(g, 0.5, () => dropEvent(file.url));
    await flush();
    await flush();
    await new Promise((r) => requestAnimationFrame(r));
    const added = Object.keys(scene.doc().objects).find((id) => ![g, "k"].includes(id));
    expect(element.querySelector(`.object-row[data-id="${added}"]`)).toBeTruthy();
  });

  it("below an open group, a drop goes in at the top — where the line is drawn", async () => {
    const g = addGroup();
    addLeaf("k", { parent: g });
    addLeaf("z");
    await flush();
    atRow(g, 0.9, () => rowDrag("z"));
    await flush();
    expect(scene.doc().objects.z.parent).toBe(g);
    expect(scene.doc().order.indexOf("z")).toBeLessThan(scene.doc().order.indexOf("k"));
  });

  it("a row from another scene is refused for what it is", async () => {
    const g = addGroup();
    addLeaf("o5");
    await flush();
    const heads = scene.heads();
    atRow(g, 0.5, () => rowDrag("o5", "automerge:someOtherScene"));
    await flush();
    expect(scene.heads()).toEqual(heads);
    expect(element.querySelector(".toast").textContent).toMatch(/another scene/);
    atRow(g, 0.5, () => rowDrag("gone"));
    expect(element.querySelector(".toast").textContent).toMatch(/no longer in this scene/);
  });

  it("a drop on the tree doesn't leave the whole-tool hint stuck on", async () => {
    const g = addGroup();
    await flush();
    const tool = element.querySelector(".scene-tool");
    const hint = element.querySelector(".drop-hint");
    const sidebarDrag = (type) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      e.dataTransfer = { types: ["text/plain"], files: [], getData: () => file.url };
      return e;
    };
    // enter the tool, drop on the tree
    element.querySelector(".viewport").dispatchEvent(sidebarDrag("dragenter"));
    atRow(g, 0.5, () => dropEvent(file.url));
    await flush();
    await flush();
    // a later drag that only passes through
    element.querySelector(".viewport").dispatchEvent(sidebarDrag("dragenter"));
    expect(hint.hidden).toBe(false);
    tool.dispatchEvent(sidebarDrag("dragleave"));
    expect(hint.hidden).toBe(true);
  });

  it("accepts a Patchwork drop", async () => {
    const dt = {
      types: ["text/x-patchwork-dnd"],
      getData: (t) => (t === "text/x-patchwork-dnd" ? JSON.stringify({ items: [{ url: file.url, name: "Dropped" }] }) : ""),
      files: [],
    };
    const ev = new Event("drop", { bubbles: true, cancelable: true });
    ev.dataTransfer = dt;
    element.querySelector(".viewport").dispatchEvent(ev);
    await flush();
    await flush();
    const objs = Object.values(scene.doc().objects);
    expect(objs.map((o) => o.name)).toEqual(["Dropped"]);
  });

  it("broadcasts selection and cleans up everything", async () => {
    await addByUrl(file.url);
    expect(scene.broadcasts.at(-1)).toMatchObject({ type: "scene:presence" });
    expect(scene.broadcasts.at(-1).selected).toBeTruthy();
    cleanup();
    cleanup = null;
    expect(element.children.length).toBe(0);
    expect(scene.listenerCount("change")).toBe(0);
    expect(scene.listenerCount("ephemeral-message")).toBe(0);
    for (const h of repo.handles.values()) expect(h.listenerCount("change")).toBe(0);
  });
});
