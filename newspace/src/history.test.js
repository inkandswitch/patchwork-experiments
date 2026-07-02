import { describe, it, expect } from "vitest";
import { createHistory, snapshotItems, restoreItem, diffCommand } from "./history.js";

describe("createHistory (command stack)", () => {
  it("undo/redo walk the command stack and toggle can-undo/redo", () => {
    const h = createHistory();
    const log = [];
    h.push({ undo: () => log.push("u1"), redo: () => log.push("r1") });
    h.push({ undo: () => log.push("u2"), redo: () => log.push("r2") });
    expect(h.canUndo()).toBe(true); expect(h.canRedo()).toBe(false);
    h.undo(); expect(log).toEqual(["u2"]);
    h.undo(); expect(log).toEqual(["u2", "u1"]);
    expect(h.canUndo()).toBe(false); expect(h.canRedo()).toBe(true);
    h.redo(); expect(log).toEqual(["u2", "u1", "r1"]);
  });
  it("a new push clears the redo stack", () => {
    const h = createHistory();
    h.push({ undo() {}, redo() {} });
    h.undo();
    expect(h.canRedo()).toBe(true);
    h.push({ undo() {}, redo() {} });
    expect(h.canRedo()).toBe(false);
  });
  it("ignores pushes while applying (no recursive recording)", () => {
    const h = createHistory();
    h.push({ undo: () => h.push({ undo() {}, redo() {} }), redo() {} });
    h.undo(); // the inner push happens while applying → ignored
    expect(h.canRedo()).toBe(true); // only the original command is on the redo stack
    h.redo();
    expect(h.canUndo()).toBe(true);
  });
});

describe("restoreItem", () => {
  it("restores props, drops new keys, replaces nested arrays", () => {
    const live = { id: "a", x: 9, y: 9, extra: 1, points: [[9, 9]] };
    restoreItem(live, { id: "a", x: 1, y: 2, points: [[1, 2], [3, 4]] });
    expect(live).toEqual({ id: "a", x: 1, y: 2, points: [[1, 2], [3, 4]] });
    expect("extra" in live).toBe(false);
  });
});

describe("diffCommand (snapshot → undoable patch)", () => {
  // a plain array stands in for the live items; change(mut) runs mut on it
  const run = (items, mut) => mut(items);

  it("undoes a move and redoes it, touching only the changed item", () => {
    const items = [{ id: "a", x: 0, y: 0 }, { id: "b", x: 5, y: 5 }];
    const before = snapshotItems(items);
    items[0].x = 100; items[0].y = 50; // "move a"
    const after = snapshotItems(items);
    const cmd = diffCommand(before, after, (mut) => run(items, mut), "move");
    cmd.undo(); expect(items.find((i) => i.id === "a")).toMatchObject({ x: 0, y: 0 });
    expect(items.find((i) => i.id === "b")).toMatchObject({ x: 5, y: 5 }); // untouched
    cmd.redo(); expect(items.find((i) => i.id === "a")).toMatchObject({ x: 100, y: 50 });
  });

  it("undoes a create (removes it) and a delete (re-adds it)", () => {
    let items = [{ id: "a" }];
    let before = snapshotItems(items);
    items.push({ id: "b", x: 1 }); // create b
    let cmd = diffCommand(before, snapshotItems(items), (mut) => run(items, mut));
    cmd.undo(); expect(items.map((i) => i.id)).toEqual(["a"]);
    cmd.redo(); expect(items.map((i) => i.id)).toEqual(["a", "b"]);

    before = snapshotItems(items);
    items.splice(0, 1); // delete a
    cmd = diffCommand(before, snapshotItems(items), (mut) => run(items, mut));
    cmd.undo(); expect(items.some((i) => i.id === "a")).toBe(true);
  });

  it("returns null when nothing changed", () => {
    const items = [{ id: "a", x: 1 }];
    const before = snapshotItems(items);
    expect(diffCommand(before, snapshotItems(items), (mut) => run(items, mut))).toBe(null);
  });
});

describe("diffCommand — order changes (z-order IS array order)", () => {
  const run = (items, mut) => mut(items);
  const ids = (items) => items.map((i) => i.id);

  it("a PURE REORDER records a command; undo restores the order, redo reapplies it", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const before = snapshotItems(items);
    items.splice(0, 3, { id: "c" }, { id: "a" }, { id: "b" }); // send c to back-most position
    const cmd = diffCommand(before, snapshotItems(items), (mut) => run(items, mut), "reorder");
    expect(cmd).not.toBe(null); // used to be null → ⌘Z fell through to the previous command
    cmd.undo(); expect(ids(items)).toEqual(["a", "b", "c"]);
    cmd.redo(); expect(ids(items)).toEqual(["c", "a", "b"]);
  });

  it("undoing a reorder does NOT fall through and revert the previous command", () => {
    const h = createHistory();
    const items = [{ id: "a", x: 0 }, { id: "b", x: 0 }];
    // command 1: move a
    let before = snapshotItems(items);
    items[0].x = 100;
    h.push(diffCommand(before, snapshotItems(items), (mut) => run(items, mut), "move"));
    // command 2: send a to back → [b, a]
    before = snapshotItems(items);
    const [a] = items.splice(0, 1); items.push(a);
    h.push(diffCommand(before, snapshotItems(items), (mut) => run(items, mut), "reorder"));
    // ONE undo undoes ONLY the reorder
    h.undo();
    expect(ids(items)).toEqual(["a", "b"]);
    expect(items.find((i) => i.id === "a").x).toBe(100); // the move survives
    h.undo(); // the second undo reverts the move
    expect(items.find((i) => i.id === "a").x).toBe(0);
  });

  it("a peer's concurrent add keeps a slot through an order undo", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const before = snapshotItems(items);
    items.splice(0, 3, { id: "c" }, { id: "b" }, { id: "a" }); // reverse
    const cmd = diffCommand(before, snapshotItems(items), (mut) => run(items, mut), "reorder");
    items.splice(1, 0, { id: "peer" }); // a peer adds an item mid-stack
    cmd.undo();
    expect(items.some((i) => i.id === "peer")).toBe(true); // not thrown away
    expect(ids(items).filter((id) => id !== "peer")).toEqual(["a", "b", "c"]); // order restored
  });
});

describe("diffCommand — per-field restore (concurrent edits survive undo)", () => {
  const run = (items, mut) => mut(items);

  it("undo reverts only x/y; a concurrent recolor is left alone", () => {
    const items = [{ id: "a", x: 0, y: 0, color: "red" }];
    const before = snapshotItems(items);
    items[0].x = 100; items[0].y = 50; // the recorded command changes ONLY x/y
    const cmd = diffCommand(before, snapshotItems(items), (mut) => run(items, mut), "move");
    items[0].color = "blue"; // a PEER recolors after the move was recorded
    cmd.undo();
    expect(items[0]).toMatchObject({ x: 0, y: 0, color: "blue" }); // recolor SURVIVES
    cmd.redo();
    expect(items[0]).toMatchObject({ x: 100, y: 50, color: "blue" });
  });

  it("a field the command deleted comes back on undo; one it added goes away", () => {
    const items = [{ id: "a", rotation: 45 }];
    const before = snapshotItems(items);
    delete items[0].rotation; items[0].locked = true;
    const cmd = diffCommand(before, snapshotItems(items), (mut) => run(items, mut));
    cmd.undo();
    expect(items[0].rotation).toBe(45);
    expect("locked" in items[0]).toBe(false);
  });
});

describe("diffCommand — delete undo re-inserts at the ORIGINAL index", () => {
  const run = (items, mut) => mut(items);

  it("undoing a mid-stack delete does not resurrect at the top of the z-order", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const before = snapshotItems(items);
    items.splice(1, 1); // delete b (index 1)
    const cmd = diffCommand(before, snapshotItems(items), (mut) => run(items, mut), "delete");
    cmd.undo();
    expect(items.map((i) => i.id)).toEqual(["a", "b", "c"]); // b back at index 1, not pushed
  });

  it("the recorded index is clamped when the array shrank meanwhile", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const before = snapshotItems(items);
    items.splice(2, 1); // delete c (index 2)
    const cmd = diffCommand(before, snapshotItems(items), (mut) => run(items, mut));
    items.splice(0, 2); // a peer deletes a and b meanwhile → []
    cmd.undo();
    expect(items.map((i) => i.id)).toEqual(["c"]); // clamped insert, no crash
  });
});

import { createRoot } from "solid-js";
import { makeDocumentProjection } from "solid-automerge";
import { makeRepo, makeSurface, flush } from "./test-harness.js";

describe("undo against a REAL automerge doc + Solid projection", () => {
  it("send-to-back → undo restores z-order on the doc", async () => {
    const repo = makeRepo();
    const { layout } = makeSurface(repo, { items: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    const before = snapshotItems(layout.doc().items);
    layout.change((d) => { const m = JSON.parse(JSON.stringify(d.items[2])); d.items.splice(2, 1); d.items.splice(0, 0, m); }); // c to back
    await flush();
    expect(layout.doc().items.map((x) => x.id)).toEqual(["c", "a", "b"]);
    const cmd = diffCommand(before, snapshotItems(layout.doc().items), (mut) => layout.change((d) => mut(d.items)), "reorder");
    expect(cmd).not.toBe(null);
    cmd.undo(); await flush();
    expect(layout.doc().items.map((x) => x.id)).toEqual(["a", "b", "c"]);
    cmd.redo(); await flush();
    expect(layout.doc().items.map((x) => x.id)).toEqual(["c", "a", "b"]);
  });

  // PIN (for the datatype.js note): MAP-KEY DELETION is safe under the current
  // solid-automerge projection — an undo that deletes an item key (restoreFields /
  // restoreItem do this, as do ungroup and chrome edits) reconciles cleanly, both
  // nested and at the top level.
  it("an undo that DELETES an item key reconciles through the projection", async () => {
    const repo = makeRepo();
    const { layout } = makeSurface(repo, { items: [{ id: "a", x: 0 }] });
    const before = snapshotItems(layout.doc().items);
    layout.change((d) => { d.items[0].locked = true; });
    await flush();
    const cmd = diffCommand(before, snapshotItems(layout.doc().items), (mut) => layout.change((d) => mut(d.items)), "lock");
    let dispose, proj;
    createRoot((d) => { dispose = d; proj = makeDocumentProjection(layout); });
    expect(proj.items[0].locked).toBe(true);
    cmd.undo(); await flush();
    expect(layout.doc().items[0].locked).toBeUndefined();
    expect(proj.items[0].locked).toBeUndefined(); // the projection APPLIED the key deletion
    dispose();
  });

  it("TOP-LEVEL map-key deletion also reconciles through the projection", async () => {
    const repo = makeRepo();
    const layout = repo.create({ items: [], extra: "x", title: "t" });
    let dispose, proj;
    createRoot((d) => { dispose = d; proj = makeDocumentProjection(layout); });
    expect(proj.extra).toBe("x");
    layout.change((d) => { delete d.extra; });
    await flush();
    expect(proj.extra).toBeUndefined();
    expect(proj.title).toBe("t");
    dispose();
  });
});
