import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { PLAY, mountStage, object, settle } from "../test/stage-harness.js";
import { getRegistry } from "../test/plugins-mock.js";
import add, { accepts, baseName, mimeOf, templatesOf, ROW_MIME } from "./add.js";

const ADD = { meta: { id: "scene.add", activities: ["edit"] }, module: add };

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
    s = await mountStage({ extensions: [ADD, ...(opts.extensions ?? [])], templates: opts.templates ?? [], doc: opts.doc ?? {} });
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
    expect(templatesOf([{ id: "a", name: "Arena", icon: "Swords", description: "Walk and shoot" }, { name: "no id" }, { id: "b" }])).toEqual([
      { id: "a", name: "Arena", icon: "Swords", description: "Walk and shoot" },
      { id: "b", name: "b", icon: null, description: null },
    ]);
  });

  it("with no templates installed, the empty scene only says how to add something", async () => {
    await mount();
    expect(s.port.querySelector(".add-start").hidden).toBe(true);
  });

  it("an empty scene is a start screen: every template and Blank; a template writes the doc and starts this viewer where it says", async () => {
    const made = [];
    const level = {
      meta: { id: "t.level", name: "Test level", icon: "Swords", description: "A room to play in" },
      module: {
        async create(ctx) {
          made.push(Object.keys(ctx).sort());
          const id = await ctx.addObject(stl.url, { name: "Crate" });
          ctx.change((d) => {
            d.traits["t.game"] = {};
            d.view.activity = "play";
          });
          return id;
        },
      },
    };
    const game = { meta: { id: "t.game", traits: ["t.game"], activities: ["play"] }, module: { create: () => ({}) } };
    await mount({ extensions: [game], templates: [level, { meta: { id: "t.empty", name: "Nothing much" }, module: { create() {} } }] });
    const start = s.port.querySelector(".add-start");
    expect(start.hidden).toBe(false);
    expect(start.querySelector(".add-start-title").textContent).toBe("Start from:");
    const buttons = () => [...start.querySelectorAll("button[data-template]")];
    expect(buttons().map((b) => [b.dataset.template, b.querySelector(".add-template-name").textContent])).toEqual([
      ["t.level", "Test level"],
      ["t.empty", "Nothing much"],
      ["", "Blank"],
    ]);
    expect(buttons()[0].querySelector(".add-template-description").textContent).toBe("A room to play in");
    expect(buttons()[0].dataset.icon).toBe("Swords");
    // the drop hint is still there under it
    expect(s.port.querySelector(".add-empty").textContent).toContain("Drop a document here, or paste its URL.");
    buttons()[0].click();
    await settle();
    await settle();
    expect(made).toHaveLength(1);
    expect(made[0]).toEqual(expect.arrayContaining(["addObject", "change", "doc", "newId", "registry", "repo"]));
    expect(objectsOf(s).map((o) => o.name)).toEqual(["Crate"]);
    expect(s.doc().view.activity).toBe("play");
    // its maker lands in the game: editing parts (this one) stop
    expect(s.local.get().activity).toBe("play");
    expect(s.local.get().running.map((r) => r.id)).toEqual(["t.game"]);
  });

  it("Blank puts the start screen away for this view, leaving the drop hint", async () => {
    await mount({ templates: [{ meta: { id: "t.level", name: "Test level" }, module: { create() {} } }] });
    const start = s.port.querySelector(".add-start");
    start.querySelector('button[data-template=""]').click();
    await settle();
    expect(start.hidden).toBe(true);
    expect(s.port.querySelector(".add-empty").hidden).toBe(false);
    expect(objectsOf(s)).toEqual([]);
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

  it("takes a drop anywhere in the stage, not only on the canvas (the side panel too)", async () => {
    await mount();
    const panel = document.createElement("div");
    s.root.append(panel);
    const e = dragEvent("drop", { "text/x-patchwork-dnd": JSON.stringify({ items: [{ url: stl.url, name: "Beside" }] }) });
    panel.dispatchEvent(e);
    await settle();
    expect(e.defaultPrevented).toBe(true);
    expect(objectsOf(s).map((o) => o.name)).toEqual(["Beside"]);
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
    const row = { [ROW_MIME]: JSON.stringify({ scene: s.handle.url, id: "a", ids: ["a"] }) };
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
    embed.setAttribute("data-stage-embed", "");
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
    await mount({ extensions: [PLAY] });
    getRegistry("scene:source").register({ type: "scene:source", id: "alt-stl", name: "Other STL", supportedDatatypes: ["file"], extensions: ["stl"], params: [], load: async () => ({}) });
    await drop({ "text/plain": stl.url });
    expect(s.port.querySelector(".add-chooser")).toBeTruthy();
    // this viewer switches to play: the extension stops at once
    await s.activity("play");
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
