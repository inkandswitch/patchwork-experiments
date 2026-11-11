// The panel, mounted alone on a bag doc (no scene): the (handle, element) =>
// cleanup contract, what it shows, and what its buttons write.
import { describe, it, expect, vi } from "vitest";

vi.mock("@inkandswitch/patchwork-plugins", () => ({ getRegistry: () => ({ filter: () => [{ id: "scene", importUrl: "automerge:2zt6LbnDAzvNj9WDNDA4ew21R85F" }] }) }));
import { inside, outside, putIn, takeOut } from "./contents.js";
import { newBag } from "./datatype.js";
import Tool, { drewText } from "./tool.js";
import { FakeHandle, FakeRepo } from "./test/fake-repo.js";

const SCENE = "automerge:3yt6LbnDAzvNj9WDNDA4ew21R85G";
const thing = (id, name) => ({ id, object: { name, sourceUrl: `automerge:glb-${name}`, providerId: "file-glb" }, scale: 1 });

function mount({ host = null, rule = "top", repo = null } = {}) {
  const doc = newBag({ title: "Tile bag", rule });
  putIn(doc, [thing("a", "Cube"), thing("b", "Disc"), thing("c", "Cube"), thing("d", "Meeple")], { from: SCENE });
  const handle = new FakeHandle("automerge:bag", doc);
  const element = document.createElement("div");
  if (repo) element.repo = repo;
  document.body.append(element);
  const cleanup = Tool(handle, element, host);
  const $ = (sel) => element.querySelector(sel);
  const button = (text) => [...element.querySelectorAll("button")].find((b) => b.textContent === text);
  const rows = (sel) => [...element.querySelectorAll(`${sel} li`)].map((li) => li.textContent);
  return { handle, element, cleanup, $, button, rows };
}

describe("the bag's panel on its own", () => {
  it("shows the contents by kind with counts, the total, the rule, and says plainly that it isn't a secret", () => {
    const t = mount();
    expect(t.$(".title").value).toBe("Tile bag");
    expect(t.$(".total").dataset.count).toBe("4");
    expect(t.rows(".kinds")).toEqual(["Cube× 2", "Disc× 1", "Meeple× 1"]);
    expect(t.$("select").value).toBe("top");
    expect(t.$(".note").textContent).toMatch(/Not a secret: anyone who opens this bag can read what is inside/);
    expect(t.$(".out").hidden).toBe(true);
    t.cleanup();
  });

  it("Draw takes one out by the rule and says what came out; Out of the bag puts it back", () => {
    const t = mount();
    t.button("Draw").click();
    expect(t.$(".status").textContent).toBe("Drew: Meeple");
    expect(inside(t.handle.doc()).map((x) => x.entry.id)).toEqual(["a", "b", "c"]);
    expect(t.$(".total").dataset.count).toBe("3");
    expect(t.rows(".out")).toEqual(["Meeple× 1Put back"]);
    t.$(".out li button").click();
    expect(inside(t.handle.doc()).map((x) => x.entry.id)).toEqual(["a", "b", "c", "d"]);
    expect(outside(t.handle.doc())).toEqual([]);
    expect(t.$(".out").hidden).toBe(true);
    t.cleanup();
  });

  it("Draw several takes that many, each on its own; Empty takes the rest; Forget drops the record of them", () => {
    const t = mount();
    t.$('input[type="number"]').value = "3";
    t.button("Draw several").click();
    expect(t.$(".status").textContent).toBe("Drew: Meeple, Cube, Disc");
    expect(t.$(".total").dataset.count).toBe("1");
    expect(t.button("Draw several").disabled).toBe(true);
    t.button("Empty").click();
    expect(t.$(".status").textContent).toBe("Emptied: 1 out.");
    expect(inside(t.handle.doc())).toEqual([]);
    expect([t.button("Draw").disabled, t.button("Empty").disabled]).toEqual([true, true]);
    expect(t.rows(".kinds")[0]).toMatch(/Nothing inside/);
    expect(outside(t.handle.doc()).length).toBe(4);
    t.button("Put all back").click();
    expect(inside(t.handle.doc()).map((x) => x.entry.id)).toEqual(["a", "b", "c", "d"]);
    t.button("Draw").click();
    t.button("Forget").click();
    expect(Object.keys(t.handle.doc().items).length).toBe(3);
    t.cleanup();
  });

  it("with replacement, a draw reports a copy and leaves the bag as it was", () => {
    const t = mount({ rule: "random-replace" });
    t.button("Draw").click();
    expect(t.$(".status").textContent).toMatch(/^Drew: (Cube|Disc|Meeple) \(copies: they stay in the bag\)$/);
    expect(t.$(".total").dataset.count).toBe("4");
    expect(outside(t.handle.doc())).toEqual([]);
    t.cleanup();
  });

  it("the title, the rule and the look are written to the doc, and follow it", () => {
    const t = mount();
    t.$(".title").value = "Chit cup";
    t.$(".title").dispatchEvent(new Event("change"));
    t.$("select").value = "random-replace";
    t.$("select").dispatchEvent(new Event("change"));
    const size = [...t.element.querySelectorAll('input[type="number"]')].at(-1);
    size.value = "35";
    size.dispatchEvent(new Event("change"));
    expect([t.handle.doc().title, t.handle.doc().rule, t.handle.doc().look.size]).toEqual(["Chit cup", "random-replace", 0.35]);
    // a peer's change shows
    t.handle.change((d) => {
      d.title = "Renamed elsewhere";
      putIn(d, [thing("e", "Disc")], { from: SCENE });
    });
    expect(t.$(".title").value).toBe("Renamed elsewhere");
    expect(t.$(".total").dataset.count).toBe("5");
    t.cleanup();
  });

  it("cleanup removes everything it mounted and stops listening", () => {
    const t = mount();
    expect(t.handle.listenerCount("change")).toBe(1);
    t.cleanup();
    expect(t.element.children.length).toBe(0);
    expect(t.handle.listenerCount("change")).toBe(0);
  });

  it("Put it in a new scene makes a whole scene doc with the bag on it, carrying the scene package, and opens it", async () => {
    const repo = new FakeRepo();
    const t = mount({ repo });
    const opened = [];
    t.element.addEventListener("patchwork:open-document", (e) => opened.push(e.detail));
    t.button("Put it in a new scene").click();
    await vi.waitFor(() => expect(opened.length).toBe(1));
    const [file, scene] = repo.created.map((h) => h.doc());
    expect(file["@patchwork"]).toEqual({ type: "file" });
    expect(scene["@patchwork"]).toEqual({ type: "scene", suggestedImportUrl: "automerge:2zt6LbnDAzvNj9WDNDA4ew21R85F" });
    expect(scene.packages).toEqual([]);
    expect(Object.values(scene.objects).map((o) => o.traits)).toEqual([{ "bag.container": { doc: "automerge:bag" } }]);
    expect(opened[0]).toEqual({ url: repo.created[1].url, toolId: "scene" });
    t.cleanup();
  });
});

describe("the panel docked beside a scene", () => {
  it("reads by the scene's rule and hands Draw and Empty to the scene", () => {
    const calls = [];
    let refresh = null;
    let onTable = new Set(["a@3yt6LbnDAzvNj9WDNDA4ew21R85G"]);
    const host = { shadow: () => (key) => onTable.has(key), draw: (n) => calls.push(["draw", n]), empty: () => calls.push(["empty"]), subscribe: (fn) => (refresh = fn) };
    const t = mount({ host });
    // a's object is on the table: it isn't inside
    expect(t.$(".total").dataset.count).toBe("3");
    expect(t.rows(".kinds")).toEqual(["Cube× 1", "Disc× 1", "Meeple× 1"]);
    t.button("Draw").click();
    t.button("Empty").click();
    expect(calls).toEqual([["draw", 1], ["empty"]]);
    expect(inside(t.handle.doc()).length).toBe(4); // nothing was taken here: the scene does it
    expect(t.button("Put it in a new scene")).toBeUndefined();
    // what is out is on the table, not a list to put back from
    t.handle.change((d) => takeOut(d, inside(d)[0].key, "someone"));
    expect(t.$(".out").hidden).toBe(true);
    t.handle.change((d) => putIn(d, [thing("a", "Cube")], { from: SCENE }));
    // the scene changed (the object left the table): the panel is told, and reads again
    onTable = new Set();
    refresh();
    expect(t.$(".total").dataset.count).toBe("4");
    t.cleanup();
  });
});

describe("what a draw says", () => {
  it("names what came out, or that there was nothing", () => {
    expect(drewText([])).toBe("The bag is empty.");
    expect(drewText(["Cube"])).toBe("Drew: Cube");
    expect(drewText(["Cube", "Disc"], { copies: true })).toBe("Drew: Cube, Disc (copies: they stay in the bag)");
  });
});
