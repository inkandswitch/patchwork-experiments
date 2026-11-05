import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import { getRegistry } from "../test/plugins-mock.js";
import add, { accepts, baseName, mimeOf, ROW_MIME } from "./add.js";

const ADD = { meta: { id: "scene.add" }, module: add };
const KIT = { id: "model", extensions: ["scene.add"] };

/** A drag event carrying `data` ({ mime: value }) and `files`. */
function dragEvent(type, data = {}, files = []) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const types = [...Object.keys(data), ...(files.length ? ["Files"] : [])];
  Object.defineProperty(e, "dataTransfer", { value: { types, files, dropEffect: "none", getData: (t) => data[t] ?? "" } });
  return e;
}

function pasteEvent(text) {
  const e = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "clipboardData", { value: { getData: (t) => (t === "text/plain" ? text : "") } });
  return e;
}

const notices = (s) => (s.local.get().notices ?? []).map((n) => `${n.kind}: ${n.text}`);
const objectsOf = (s) => Object.values(s.doc().objects ?? {});

describe("scene.add", () => {
  let s;
  let stl;
  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    s?.unmount();
    s = null;
    vi.restoreAllMocks();
  });

  async function mount(opts = {}) {
    s = await mountStage({ extensions: [ADD, ...(opts.extensions ?? [])], kits: [KIT], doc: opts.doc ?? {} });
    stl = s.repo.add({ "@patchwork": { type: "file" }, name: "part.stl", extension: "stl", mimeType: "model/stl", content: new Uint8Array(84) });
    return s;
  }

  const drop = async (data, files) => {
    const e = dragEvent("drop", data, files);
    s.canvas.dispatchEvent(e);
    await settle();
    return e;
  };

  it("pure helpers: what it accepts, guessed mime types, names", () => {
    expect(accepts({ types: ["text/plain"] })).toBe(true);
    expect(accepts({ types: ["text/x-patchwork-dnd"] })).toBe(true);
    expect(accepts({ types: ["Files"] })).toBe(true);
    expect(accepts({ types: [ROW_MIME, "text/plain"] })).toBe(false);
    expect(accepts({ types: ["text/html"] })).toBe(false);
    expect(accepts(null)).toBe(false);
    expect(mimeOf("a.glb", "")).toBe("model/gltf-binary");
    expect(mimeOf("a.STL", "")).toBe("model/stl");
    expect(mimeOf("a.bin", "")).toBe("application/octet-stream");
    expect(mimeOf("a.glb", "x/y")).toBe("x/y");
    expect(baseName("part.v2.stl")).toBe("part.v2");
  });

  it("says how to add something while the scene is empty, and not otherwise", async () => {
    await mount();
    const empty = s.port.querySelector(".add-empty");
    expect(empty).toBeTruthy();
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toContain("Drop a document here, or paste its URL.");
    s.change((d) => {
      d.objects.a = object();
      d.order = ["a"];
    });
    await settle();
    expect(empty.hidden).toBe(true);
    s.change((d) => {
      delete d.objects.a;
      d.order = [];
    });
    await settle();
    expect(empty.hidden).toBe(false);
  });

  it("adds a dropped STL: a render doc with defaults, top level, selected", async () => {
    await mount();
    const e = await drop({ "text/plain": stl.url });
    expect(e.defaultPrevented).toBe(true);
    const objects = s.doc().objects;
    const [id] = Object.keys(objects);
    expect(objects[id]).toMatchObject({ name: "part.stl", sourceUrl: stl.url, providerId: "file-stl", parent: null, group: null, visible: true });
    expect(s.doc().order).toEqual([id]);
    const render = (await s.repo.find(objects[id].renderUrl)).doc();
    expect(render).toMatchObject({ "@patchwork": { type: "scene-render" }, parent: stl.url, providerId: "file-stl", params: { unit: "mm", up: "z" } });
    expect(s.local.get().selected).toBe(id);
  });

  it("accepts a Patchwork drop, named as the payload says", async () => {
    await mount();
    await drop({ "text/x-patchwork-dnd": JSON.stringify({ items: [{ url: stl.url, name: "Dropped" }] }) });
    expect(objectsOf(s).map((o) => o.name)).toEqual(["Dropped"]);
  });

  it("refuses what nothing can show, and a drop with no url", async () => {
    await mount();
    const todo = s.repo.add({ "@patchwork": { type: "todo" }, title: "x" });
    await drop({ "text/plain": todo.url });
    expect(objectsOf(s)).toEqual([]);
    expect(notices(s).at(-1)).toMatch(/^error: Nothing can show “todo” documents/);
    await drop({ "text/plain": "not a url" });
    expect(notices(s).at(-1)).toBe("error: Nothing droppable there.");
    expect(objectsOf(s)).toEqual([]);
  });

  it("refuses the scene itself", async () => {
    await mount();
    s.root.dispatchEvent(pasteEvent(s.handle.url));
    await settle();
    expect(objectsOf(s)).toEqual([]);
    expect(notices(s).at(-1)).toBe("error: A scene can't contain itself.");
  });

  it("turns desktop files into file docs, then objects named after them (a GLB passes through)", async () => {
    await mount();
    const before = s.repo.created.length;
    const file = new File([new Uint8Array([1, 2, 3, 4])], "thing.glb");
    await drop({}, [file]);
    const made = s.repo.created.slice(before);
    expect(made.length).toBe(1); // the file doc, and no render doc for a passthrough
    expect(made[0].doc()).toMatchObject({ "@patchwork": { type: "file" }, name: "thing.glb", extension: "glb", mimeType: "model/gltf-binary" });
    expect(made[0].doc().content).toEqual(new Uint8Array([1, 2, 3, 4]));
    const [o] = objectsOf(s);
    expect(o).toMatchObject({ name: "thing", sourceUrl: made[0].url, providerId: "file-glb", renderUrl: null });
  });

  it("shows the drop hint while an acceptable drag is over the port, never for an outline row", async () => {
    await mount();
    const hint = s.port.querySelector(".add-drop-hint");
    expect(hint.hidden).toBe(true);
    s.canvas.dispatchEvent(dragEvent("dragenter", { "text/plain": stl.url }));
    expect(hint.hidden).toBe(false);
    // crossing into a child and out of the canvas: still over the port
    s.port.querySelector(".add-layer").dispatchEvent(dragEvent("dragenter", { "text/plain": stl.url }));
    s.canvas.dispatchEvent(dragEvent("dragleave", { "text/plain": stl.url }));
    expect(hint.hidden).toBe(false);
    const over = dragEvent("dragover", { "text/plain": stl.url });
    s.canvas.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe("copy");
    s.port.querySelector(".add-layer").dispatchEvent(dragEvent("dragleave", { "text/plain": stl.url }));
    expect(hint.hidden).toBe(true);
    // a row being moved in the outline isn't a document being added
    const row = { [ROW_MIME]: JSON.stringify({ scene: s.handle.url, id: "a" }) };
    s.canvas.dispatchEvent(dragEvent("dragenter", row));
    expect(hint.hidden).toBe(true);
    const rowOver = dragEvent("dragover", row);
    s.canvas.dispatchEvent(rowOver);
    expect(rowOver.defaultPrevented).toBe(false);
    const rowDrop = await drop(row);
    expect(rowDrop.defaultPrevented).toBe(false);
    expect(objectsOf(s)).toEqual([]);
    // a drop hides the hint
    s.canvas.dispatchEvent(dragEvent("dragenter", { "text/plain": stl.url }));
    expect(hint.hidden).toBe(false);
    await drop({ "text/plain": stl.url });
    expect(hint.hidden).toBe(true);
  });

  it("adds a pasted URL from anywhere in the stage, but not from a field or an embedded document", async () => {
    await mount();
    const input = document.createElement("input");
    s.root.append(input);
    const typed = pasteEvent(stl.url);
    input.dispatchEvent(typed);
    expect(typed.defaultPrevented).toBe(false);
    const embed = document.createElement("div");
    embed.className = "about-embed";
    const inner = document.createElement("span");
    embed.append(inner);
    s.root.append(embed);
    const embedded = pasteEvent(`see [it](${stl.url})`);
    inner.dispatchEvent(embedded);
    expect(embedded.defaultPrevented).toBe(false);
    const embeddedDrop = dragEvent("drop", {}, [new File([new Uint8Array(4)], "x.glb")]);
    inner.dispatchEvent(embeddedDrop);
    expect(embeddedDrop.defaultPrevented).toBe(false);
    await settle();
    expect(objectsOf(s)).toEqual([]);
    // plain text that isn't a url is left alone
    const words = pasteEvent("hello");
    s.root.dispatchEvent(words);
    expect(words.defaultPrevented).toBe(false);
    // the same paste on the stage adds
    const ok = pasteEvent(stl.url);
    s.port.dispatchEvent(ok);
    expect(ok.defaultPrevented).toBe(true);
    await settle();
    expect(objectsOf(s).map((o) => o.sourceUrl)).toEqual([stl.url]);
  });

  it("lets an extension lay out a doc it takes when dropped, instead of a scene source", async () => {
    const dropped = [];
    const deckExt = {
      meta: { id: "test.deck", drops: ["test-deck"] },
      module: {
        create: () => ({}),
        drop(ctx, info) {
          dropped.push(info);
          return true;
        },
      },
    };
    await mount({ extensions: [deckExt] });
    const deck = s.repo.add({ "@patchwork": { type: "test-deck" }, title: "Deck" });
    s.root.dispatchEvent(pasteEvent(deck.url));
    await settle();
    expect(dropped.map((i) => i.url)).toEqual([deck.url]);
    expect(dropped[0]).toMatchObject({ group: null, at: null });
    expect(dropped[0].doc.title).toBe("Deck");
    expect(dropped[0].handle).toBe(deck);
    expect(objectsOf(s)).toEqual([]);
    expect(notices(s)).toEqual([]);
    // a drop carries where it landed (no WebGL here: nothing to pick, so null)
    await drop({ "text/plain": deck.url });
    expect(dropped.length).toBe(2);
    expect(dropped[1].at).toBeNull();
  });

  it("asks which provider when several can show it; Cancel and Escape add nothing", async () => {
    await mount();
    getRegistry("scene:source").register({ type: "scene:source", id: "alt-stl", name: "Other STL", supportedDatatypes: ["file"], extensions: ["stl"], params: [], load: async () => ({}) });
    const chooser = () => s.port.querySelector(".add-chooser");

    await drop({ "text/plain": stl.url });
    expect(chooser()).toBeTruthy();
    expect(chooser().querySelector(".add-chooser-title").textContent).toBe("Show part.stl as…");
    expect([...chooser().querySelectorAll("button[data-provider]")].map((b) => b.textContent)).toEqual(["STL file", "Other STL"]);
    chooser().querySelector("button[data-cancel]").click();
    await settle();
    expect(chooser()).toBeNull();
    expect(objectsOf(s)).toEqual([]);

    await drop({ "text/plain": stl.url });
    expect(chooser()).toBeTruthy();
    s.key("Escape", { code: "Escape" });
    await settle();
    expect(chooser()).toBeNull();
    expect(objectsOf(s)).toEqual([]);

    await drop({ "text/plain": stl.url });
    chooser().querySelector('button[data-provider="alt-stl"]').click();
    await settle();
    expect(chooser()).toBeNull();
    const [id] = Object.keys(s.doc().objects);
    expect(s.doc().objects[id]).toMatchObject({ providerId: "alt-stl", sourceUrl: stl.url });
    expect(s.local.get().selected).toBe(id);
  });

  it("takes its chooser, hints and listeners away when it stops", async () => {
    await mount();
    getRegistry("scene:source").register({ type: "scene:source", id: "alt-stl", name: "Other STL", supportedDatatypes: ["file"], extensions: ["stl"], params: [], load: async () => ({}) });
    await drop({ "text/plain": stl.url });
    expect(s.port.querySelector(".add-chooser")).toBeTruthy();
    // turn the kit off for this viewer: the extension stops at once
    s.local.swap((m) => ({ ...m, kits: { on: [], off: ["model"] } }));
    await settle();
    expect(s.local.get().running.map((r) => r.id)).not.toContain("scene.add");
    expect(s.port.querySelector(".add-chooser")).toBeNull();
    expect(s.port.querySelector(".add-empty")).toBeNull();
    const e = pasteEvent(stl.url);
    s.root.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    await settle();
    expect(objectsOf(s)).toEqual([]);
  });
});
