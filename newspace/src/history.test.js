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
