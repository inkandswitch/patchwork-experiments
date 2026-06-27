// Local undo/redo via the COMMAND pattern. A command is a plain object with
// `undo()` and `redo()` (and an optional `label`). Operations record a command;
// plugins can push their own too (ctx.history.push). Undo is LOCAL — it replays
// the inverse of your own operations, it doesn't roll back the CRDT globally.
//
// The snapshot/diff helpers below build a command from before/after snapshots of
// a surface's `items`, touching ONLY the items that changed (by id) — so
// unchanged items keep their identity (live embeds aren't torn down on undo).

export function createHistory() {
  const undoStack = [], redoStack = [];
  let applying = false;
  return {
    get applying() { return applying; },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    push(cmd) { if (applying || !cmd) return; undoStack.push(cmd); redoStack.length = 0; },
    undo() { const c = undoStack.pop(); if (!c) return false; applying = true; try { c.undo(); } finally { applying = false; } redoStack.push(c); return true; },
    redo() { const c = redoStack.pop(); if (!c) return false; applying = true; try { c.redo(); } finally { applying = false; } undoStack.push(c); return true; },
    clear() { undoStack.length = 0; redoStack.length = 0; },
  };
}

// deep snapshot of an items array, keyed by id
export function snapshotItems(items) {
  const m = new Map();
  for (const it of items || []) m.set(it.id, structuredClone(it));
  return m;
}

// restore a live item `o` to match the plain snapshot `t` (drops keys not in t,
// replaces arrays/objects wholesale — automerge accepts assigning new values)
export function restoreItem(o, t) {
  for (const k of Object.keys(o)) if (!(k in t)) delete o[k];
  for (const k of Object.keys(t)) {
    const v = t[k];
    o[k] = (v !== null && typeof v === "object") ? structuredClone(v) : v;
  }
}

// build a command from before/after item snapshots. `change(mut)` runs `mut`
// against the live items array. Returns null when nothing changed.
export function diffCommand(before, after, change, label) {
  const ids = new Set([...before.keys(), ...after.keys()]);
  const ops = [];
  for (const id of ids) {
    const b = before.get(id), a = after.get(id);
    if (b && a && JSON.stringify(b) === JSON.stringify(a)) continue;
    ops.push({ id, b, a });
  }
  if (!ops.length) return null;
  const run = (pick) => change((items) => {
    for (const { id, b, a } of ops) {
      const target = pick === "b" ? b : a;
      const i = items.findIndex((x) => x.id === id);
      if (!target) { if (i >= 0) items.splice(i, 1); }       // absent in this state
      else if (i < 0) items.push(structuredClone(target));    // re-create
      else restoreItem(items[i], target);                     // restore props, keep identity
    }
  });
  return { label, undo: () => run("b"), redo: () => run("a") };
}
