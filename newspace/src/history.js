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

// restore only the fields in `keys` on live item `o` from the plain snapshot
// `t` — a PER-FIELD restore, so undoing my move doesn't also revert a peer's
// concurrent recolor of the same item (fields this command never touched are
// left alone).
function restoreFields(o, t, keys) {
  for (const k of keys) {
    if (!(k in t)) { if (k in o) delete o[k]; continue; }
    const v = t[k];
    o[k] = (v !== null && typeof v === "object") ? structuredClone(v) : v;
  }
}

// reorder the live `items` so the ids in `targetIds` appear in that sequence.
// Items NOT in the target order (a peer's concurrent adds) keep their slots:
// we pull the ranked items out, sort them, and refill the same slot positions.
// Clone-out/splice-in (the applyReorder dance) — automerge needs the clone.
function applyOrder(items, targetIds) {
  const rank = new Map(targetIds.map((id, i) => [id, i]));
  const slots = [], pulled = [];
  for (let i = items.length - 1; i >= 0; i--) {
    if (!rank.has(items[i].id)) continue;
    slots.unshift(i);
    pulled.unshift(JSON.parse(JSON.stringify(items[i]))); // items may be automerge drafts
    items.splice(i, 1);
  }
  pulled.sort((x, y) => rank.get(x.id) - rank.get(y.id));
  for (let k = 0; k < pulled.length; k++) items.splice(Math.min(slots[k], items.length), 0, pulled[k]);
}

// build a command from before/after item snapshots. `change(mut)` runs `mut`
// against the live items array. Returns null when nothing changed.
export function diffCommand(before, after, change, label) {
  const ids = new Set([...before.keys(), ...after.keys()]);
  const beforeIds = [...before.keys()], afterIds = [...after.keys()];
  const ops = [];
  for (const id of ids) {
    const b = before.get(id), a = after.get(id);
    if (b && a && JSON.stringify(b) === JSON.stringify(a)) continue;
    // the fields THIS command changed (b vs a) — undo/redo touch only these
    let keys = null;
    if (b && a) {
      keys = [...new Set([...Object.keys(b), ...Object.keys(a)])]
        .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
    }
    ops.push({ id, b, a, keys });
  }
  // ORDER: z-order IS array order, so a pure reorder changes no item's content —
  // only the id sequence. Compare the sequences of ids present in BOTH snapshots
  // (adds/removes alone are already covered by the content ops above).
  const bShared = beforeIds.filter((id) => after.has(id));
  const aShared = afterIds.filter((id) => before.has(id));
  const order = bShared.join("\n") !== aShared.join("\n") ? { b: beforeIds, a: afterIds } : null;
  if (!ops.length && !order) return null;
  const run = (pick) => change((items) => {
    for (const { id, b, a, keys } of ops) {
      const target = pick === "b" ? b : a;
      const i = items.findIndex((x) => x.id === id);
      if (!target) { if (i >= 0) items.splice(i, 1); }       // absent in this state
      else if (i < 0) {
        // re-create at the index it held in the target snapshot (undoing a delete
        // must NOT resurrect the item at the TOP of the z-order), clamped
        const at = Math.min(Math.max((pick === "b" ? beforeIds : afterIds).indexOf(id), 0), items.length);
        items.splice(at, 0, structuredClone(target));
      }
      else if (keys) restoreFields(items[i], target, keys);   // only the changed fields
      else restoreItem(items[i], target);                     // restore props, keep identity
    }
    if (order) applyOrder(items, pick === "b" ? order.b : order.a);
  });
  return { label, undo: () => run("b"), redo: () => run("a") };
}
