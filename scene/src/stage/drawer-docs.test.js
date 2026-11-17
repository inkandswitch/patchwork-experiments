// Documents docked in the drawer are the view's (STAGE.md, "The interface", "Documents in
// the drawer"; STAGE.md api.view.dock): a finite table of what happens around
// one, each with the pane still docked and its view never remounted, but the
// view going; a drop in the view never docks; keys typed in one are its own.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle, until } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo } from "../test/fake-repo.js";
import { LINK } from "./links.js";
import { EDIT, LOOK } from "./bodies.js";
import focusPart from "../parts/focus.js";
import inspector from "../parts/inspector.js";
import add from "../parts/add.js";

const link = (url, extra = {}) => object({ name: "Link", sourceUrl: url, providerId: LINK, renderUrl: null, ...extra });

// a stand-in for the host's embed element that logs its mounts, as Patchwork's mounts its tool when it's put in the page
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

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

async function mountWithLink() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const repo = new FakeRepo();
  const notes = repo.add({ title: "notes" });
  const b = repo.add(emptyScene({ title: "B", objects: { card: object({ name: "Card" }) }, order: ["card"] }));
  const objects = { table: object({ name: "Table" }), chair: object({ name: "Chair" }), L: link(b.url, { name: "B" }) };
  s = await mountStage({
    repo,
    extensions: [
      { meta: { id: "scene.focus" }, module: focusPart },
      { meta: { id: "scene.inspector" }, module: inspector },
      { meta: { id: "scene.add" }, module: add },
    ],
    doc: { title: "A", objects, order: Object.keys(objects) },
  });
  const view = s.debug.view;
  await until(() => view.enterable(["L"]), 3000);
  view.enterBody(EDIT.id);
  view.select(["table"]);
  // the selection opens the shut inspector
  await until(() => view.drawer.state().order.some((el) => el.dataset.panel === "inspector"), 3000);
  return { view, notes };
}

const docsOf = (view) => view.atom.get().drawer.docs;

// [what happens, does the pane stay?, the act]
const EVENTS = [
  ["another object selected", true, async ({ view }) => view.select(["chair"])],
  ["Edit → Look", true, async ({ view }) => view.enterBody(LOOK.id)],
  ["Enter a link", true, async ({ view }) => expect(view.enter(["L"])).toBe(true)],
  ["Leave", true, async ({ view }) => (expect(view.enter(["L"])).toBe(true), await settle(), view.leave())],
  ["the inspector stopped", true, async () => s.uninstall("scene.inspector")],
  ["the view disposed", false, async ({ view }) => view.dispose()],
];
describe("a document docked in the drawer is the view's", () => {
  it.each(EVENTS)("%s → still docked: %s", async (_name, stays, act) => {
    const m = await mountWithLink();
    const { view, notes } = m;
    // docked from an extension (the inspector's Dock is this call)
    s.api("scene.inspector").view.dock({ url: notes.url, toolId: "notes", title: "Notes" });
    await settle();
    const key = `${notes.url}|notes`;
    expect(docsOf(view)).toEqual([key]);
    const pane = view.root.querySelector(".stage-drawer-doc > patchwork-view");
    expect(pane.getAttribute("tool-id")).toBe("notes");
    embedLog.length = 0;
    await act(m);
    await settle();
    if (stays) {
      expect(docsOf(view)).toEqual([key]);
      // the same view, never taken out of the page (so its tool was never mounted again)
      expect(pane.isConnected).toBe(true);
      expect(embedLog.filter(([, url]) => url === notes.url)).toEqual([]);
    } else {
      expect(view.drawer.state().order).toEqual([]);
      expect(pane.isConnected).toBe(false);
    }
  });

  it("a pane docked with nothing selected: the router is told the pointer is wanted, and not once it's closed", async () => {
    const { view, notes } = await mountWithLink();
    // nothing selected, nothing docked (the inspector may stay open on the scene: its × shuts it)
    view.select(null);
    await settle();
    const wanted = () => view.atom.get().pointer.wanted;
    const close = () => [...view.root.querySelectorAll(".stage-drawer-tab")].forEach((t) => t.querySelector(".stage-drawer-tab-close").click());
    close();
    await settle();
    expect([view.drawer.state().order.length, wanted()]).toEqual([0, false]);
    // docked with nothing selected: nothing else changes, so only the drawer's change can tell the router
    s.api("scene.inspector").view.dock({ url: notes.url, title: "Notes" });
    await settle();
    expect(view.atom.get().selected).toBeNull();
    expect([view.drawer.state().order.length, wanted()]).toEqual([1, true]);
    close();
    await settle();
    expect([view.drawer.state().order.length, wanted()]).toEqual([0, false]);
  });

  it("its × closes it, and view.drawer.docs says so", async () => {
    const { view, notes } = await mountWithLink();
    s.api("scene.inspector").view.dock({ url: notes.url, title: "Notes" });
    await settle();
    const tab = [...view.root.querySelectorAll(".stage-drawer-tab")].find((t) => t.textContent.startsWith("Notes"));
    tab.querySelector(".stage-drawer-tab-close").click();
    await settle();
    expect(docsOf(view)).toEqual([]);
    expect(view.root.querySelector(".stage-drawer-doc")).toBeNull();
  });

  // a drop of one document: on the canvas the scene takes it (scene.add) and nothing docks; on the drawer's tab strip it
  // docks and the scene sees nothing (no object, no notice)
  const dropOf = (url) => {
    const e = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "dataTransfer", { value: { types: ["text/plain"], files: [], getData: (t) => (t === "text/plain" ? url : "") } });
    return e;
  };
  it("a document dropped in the view is the scene's to take, never docked", async () => {
    const { view, notes } = await mountWithLink();
    const e = dropOf(notes.url);
    s.canvas.dispatchEvent(e);
    await settle();
    expect(e.defaultPrevented).toBe(true);
    expect(docsOf(view)).toEqual([]);
  });
  it("a document dropped on the drawer's tab strip docks, and the scene sees nothing of it", async () => {
    const { view, notes } = await mountWithLink();
    // (the inspector is open on the selection: the drawer, and its strip, are there)
    const strip = view.root.querySelector(".stage-drawer-tabs");
    const before = JSON.stringify(s.doc());
    strip.dispatchEvent(dropOf(notes.url));
    await settle();
    expect(docsOf(view)).toEqual([`${notes.url}|`]);
    expect(JSON.stringify(s.doc())).toBe(before);
    expect(view.atom.get().notices).toEqual([]);
  });

  it("keys typed in a docked document are its own: Escape there leaves the selection; on the stage it clears it", async () => {
    const { view, notes } = await mountWithLink();
    s.api("scene.inspector").view.dock({ url: notes.url, title: "Notes" });
    await settle();
    const inside = view.root.querySelector(".stage-drawer-doc > patchwork-view");
    const esc = (target) => {
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape", code: "Escape" }));
      target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: "Escape", code: "Escape" }));
    };
    esc(inside);
    await settle();
    expect(view.atom.get().selected).toEqual(["table"]);
    esc(s.root);
    await settle();
    expect(view.atom.get().selected).toBe(null);
  });
});
