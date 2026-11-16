// Document mutations. Every function here mutates a Diagram in place and is
// meant to be called inside handle.change(). They stick to fine-grained edits
// (push / splice / field assignment / delete) so concurrent changes merge.
import {
  type BlockKind,
  type Cell,
  type Diagram,
  type Pt,
  ANNOTATION_STYLE,
  BLOCK_SIZES,
  BLOCK_STYLES,
  BLOCK_VALUES,
  EDGE_STYLE,
  LABEL_STYLE,
  TRUSTED_COLORS,
  UNTRUSTED_COLORS,
  ancestors,
  autoAnchor,
  boundsOf,
  buildGraph,
  escapeHtml,
  isGate,
  kindOf,
  plainText,
  rectOf,
  styleSet,
  titleLabel,
  uid,
} from "./model";

const GRID = 10;
const snap = (v: number) => Math.round(v / GRID) * GRID;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function nextInputNumber(dg: Diagram): number {
  let max = 0;
  for (const c of dg.cells) {
    if (!c.vertex || !(c.style || "").startsWith("text")) continue;
    const m = /^in\s*(\d+)$/i.exec(plainText(c.value || ""));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** Add an edge source → target. Returns its id, or null if it is not allowed. */
export function connect(dg: Diagram, source: string, target: string): string | null {
  if (source === target) return null;
  const s = dg.cells.find((c) => c.id === source);
  const t = dg.cells.find((c) => c.id === target);
  if (!s?.vertex || !t?.vertex) return null;
  if (dg.cells.some((c) => c.edge && c.source === source && c.target === target)) return null;
  // keep the graph acyclic
  if (ancestors(buildGraph(dg.cells), source).has(target)) return null;
  const id = uid("e_");
  dg.cells.push({ id, value: "", style: EDGE_STYLE, parent: "1", edge: true, source, target, relative: true });
  autoAnchor(dg.cells, target);
  return id;
}

/**
 * Add a new block centred on `center`. With `connectTo`, the block is placed
 * as a new input above that node and wired into it.
 */
export function addBlock(dg: Diagram, kind: BlockKind, center: Pt, connectTo?: string): string {
  const size = BLOCK_SIZES[kind];
  let x = snap(center.x - size.w / 2);
  let y = snap(center.y - size.h / 2);
  const target = connectTo ? dg.cells.find((c) => c.id === connectTo && c.vertex) : undefined;
  if (target) {
    const tr = rectOf(target);
    const inputs = dg.cells
      .filter((c) => c.edge && c.target === target.id)
      .map((e) => dg.cells.find((c) => c.id === e.source))
      .filter((c): c is Cell => !!c?.vertex)
      .map(rectOf)
      .filter((r) => r.y + r.h <= tr.y);
    if (inputs.length) {
      const rightmost = inputs.reduce((a, b) => (b.x + b.w > a.x + a.w ? b : a));
      x = snap(rightmost.x + rightmost.w + 20);
      y = snap(rightmost.y + rightmost.h - size.h);
    } else {
      x = snap(tr.x + tr.w / 2 - size.w / 2);
      y = snap(tr.y - 110 - size.h);
    }
  }
  while (dg.cells.some((c) => c.vertex && c.x === x && c.y === y)) {
    x += 2 * GRID;
    y += 2 * GRID;
  }
  const id = uid("n_");
  dg.cells.push({
    id,
    value: BLOCK_VALUES[kind],
    style: BLOCK_STYLES[kind],
    parent: "1",
    vertex: true,
    x,
    y,
    width: size.w,
    height: size.h,
  });
  if (kind === "trusted" || kind === "untrusted") {
    dg.cells.push({
      id: id + "_l",
      value: `in<sub>${nextInputNumber(dg)}</sub>`,
      style: LABEL_STYLE,
      parent: "1",
      vertex: true,
      x: x + size.w / 2 - 25,
      y: y - 24,
      width: 50,
      height: 24,
    });
  }
  if (target) connect(dg, id, target.id);
  return id;
}

/** Delete cells, plus any edge that would be left dangling. */
export function deleteCells(dg: Diagram, ids: Iterable<string>): void {
  const gone = new Set(ids);
  const retarget = new Set<string>();
  for (let i = dg.cells.length - 1; i >= 0; i--) {
    const c = dg.cells[i];
    const dangling = c.edge && ((c.source && gone.has(c.source)) || (c.target && gone.has(c.target)));
    if (gone.has(c.id) || dangling) {
      if (c.edge && c.target) retarget.add(c.target);
      dg.cells.splice(i, 1);
    }
  }
  for (const t of retarget) if (!gone.has(t)) autoAnchor(dg.cells, t);
}

/** Move vertices by a delta and re-route the edges that touch them. */
export function moveCells(dg: Diagram, ids: Iterable<string>, dx: number, dy: number): void {
  const moved = new Set(ids);
  if (!dx && !dy) return;
  for (const c of dg.cells) {
    if (!c.vertex || !moved.has(c.id)) continue;
    c.x = (c.x ?? 0) + dx;
    c.y = (c.y ?? 0) + dy;
  }
  const targets = new Set<string>();
  for (const c of dg.cells) {
    if (!c.edge || !c.source || !c.target) continue;
    if (moved.has(c.source) || moved.has(c.target)) targets.add(c.target);
  }
  for (const t of targets) autoAnchor(dg.cells, t);
}

/** Flip a block between trusted and untrusted. */
export function toggleTrust(dg: Diagram, id: string): void {
  const c = dg.cells.find((x) => x.id === id);
  if (!c) return;
  const kind = kindOf(c);
  if (kind !== "trusted" && kind !== "untrusted") return;
  // swap only the colours; keep whatever else the style carries
  c.style = styleSet(c.style, kind === "trusted" ? UNTRUSTED_COLORS : TRUSTED_COLORS);
}

export function setValue(dg: Diagram, id: string, value: string): void {
  const c = dg.cells.find((x) => x.id === id);
  if (c && c.value !== value) c.value = value;
}

/**
 * Rename a node as shown when collapsed. A gate's title is the label beside
 * it, so that label is rewritten (keeping an "establishes:" prefix), created
 * if the gate had none, and removed when the title is cleared.
 */
export function setTitle(dg: Diagram, id: string, text: string): void {
  const c = dg.cells.find((x) => x.id === id);
  if (!c?.vertex) return;
  const title = text.replace(/\s+/g, " ").trim();
  if (!isGate(kindOf(c))) {
    if (title && plainText(c.value) !== title) c.value = escapeHtml(title);
    return;
  }
  const label = titleLabel(buildGraph(dg.cells), id);
  if (label) {
    if (!title) return deleteCells(dg, [label.id]);
    const prefix = /^establishes:/i.test(plainText(label.value)) ? "establishes: " : "";
    setValue(dg, label.id, prefix + escapeHtml(title));
  } else if (title) addLabel(dg, { x: 0, y: 0 }, id, escapeHtml(title));
}

/**
 * Add a free-standing text label centred on `center`. With `besideId`, it is
 * placed just below and to the right of that node instead, which attaches it:
 * it then moves, hides and collapses with the node, and titles a gate.
 */
export function addLabel(dg: Diagram, center: Pt, besideId?: string, value = "Label"): string {
  const w = 280;
  const h = 26;
  const beside = besideId ? dg.cells.find((c) => c.id === besideId && c.vertex) : undefined;
  let id = uid("t_");
  let x = snap(center.x - w / 2);
  let y = snap(center.y - h / 2);
  if (beside) {
    const r = rectOf(beside);
    x = r.x + r.w + 8;
    y = r.y + r.h + 2;
    // this id ties the note to the node whatever else is nearby
    if (!dg.cells.some((c) => c.id === beside.id + "_note")) id = beside.id + "_note";
  }
  while (dg.cells.some((c) => c.vertex && c.x === x && c.y === y)) y += h + 2;
  dg.cells.push({ id, value, style: ANNOTATION_STYLE, parent: "1", vertex: true, x, y, width: w, height: h });
  return id;
}

/**
 * Add copies of `cells` (vertices, and the edges between them) shifted by a
 * delta. Ids are re-prefixed, which keeps "<id>_l" / "<id>_note" labels tied
 * to their copied node. Returns the ids of the new vertices.
 */
export function pasteCells(dg: Diagram, cells: Cell[], dx: number, dy: number): string[] {
  const prefix = uid("c") + "_";
  const copied = new Set(cells.filter((c) => c.vertex).map((c) => c.id));
  const ids: string[] = [];
  for (const c of clone(cells)) {
    if (c.vertex) {
      dg.cells.push({ ...c, id: prefix + c.id, parent: "1", x: (c.x ?? 0) + dx, y: (c.y ?? 0) + dy });
      ids.push(prefix + c.id);
    } else if (c.edge && c.source && c.target && copied.has(c.source) && copied.has(c.target)) {
      const copy: Cell = { ...c, id: prefix + c.id, parent: "1", source: prefix + c.source, target: prefix + c.target };
      if (copy.points) copy.points = copy.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      dg.cells.push(copy);
    }
  }
  return ids;
}

export type InsertResult = { ids: string[]; note: string };

/**
 * Copy the logic graph of `source` into `dg`.
 *
 * - `targetId` is an input block (trusted / untrusted, no inputs of its own):
 *   the inserted graph *replaces* it — its result feeds whatever the block fed.
 * - `targetId` is any other node: the inserted graph becomes a new input of it.
 * - no target: the graph is dropped in whole, centred on `at`.
 *
 * When wiring into a target, the source's output box is dropped (its feeding
 * gate is wired in directly) and its text is kept as an "establishes: …" note,
 * which becomes the title of the subgraph when collapsed.
 */
export function insertGraph(dg: Diagram, source: Diagram, at: Pt, targetId?: string): InsertResult {
  const src = clone(source.cells ?? []);
  const g = buildGraph(src);
  const logic = new Set<string>([...g.preds.keys(), ...g.succs.keys()]);
  if (logic.size === 0) for (const c of g.vertices) if (!g.owner.has(c.id)) logic.add(c.id);
  if (logic.size === 0) return { ids: [], note: "That graph is empty." };

  const target = targetId ? dg.cells.find((c) => c.id === targetId && c.vertex) : undefined;
  const sinks = [...logic].filter((id) => (g.succs.get(id) ?? []).length === 0);

  // which source nodes carry the result, and which output boxes are dropped
  const dropped = new Set<string>();
  const roots: string[] = [];
  const notes: { gate: string; text: string }[] = [];
  for (const s of sinks) {
    const preds = g.preds.get(s) ?? [];
    if (target && kindOf(g.byId.get(s)!) === "output" && preds.length) {
      dropped.add(s);
      for (const t of g.owned.get(s) ?? []) dropped.add(t);
      for (const p of preds) if (!roots.includes(p)) roots.push(p);
      if (preds.length === 1 && isGate(kindOf(g.byId.get(preds[0])!))) {
        const hasNote = (g.owned.get(preds[0]) ?? []).some((t) =>
          /^establishes:/i.test(plainText(g.byId.get(t)!.value)),
        );
        const text = plainText(g.byId.get(s)!.value).replace(/^E\s*:\s*/i, "");
        if (!hasNote && text) notes.push({ gate: preds[0], text });
      }
    } else roots.push(s);
  }

  const keep = new Set<string>();
  for (const id of logic) {
    if (dropped.has(id)) continue;
    keep.add(id);
    for (const t of g.owned.get(id) ?? []) keep.add(t);
  }
  const box = boundsOf([...keep].map((id) => rectOf(g.byId.get(id)!)))!;

  const targetKind = target ? kindOf(target) : null;
  const targetHasInputs = !!target && dg.cells.some((c) => c.edge && c.target === target.id);
  const replace =
    !!target && (targetKind === "trusted" || targetKind === "untrusted") && !targetHasInputs && roots.length === 1;
  const attach = !!target && !replace && targetKind !== "trusted" && targetKind !== "untrusted";

  let dx: number;
  let dy: number;
  if (replace) {
    const rr = rectOf(g.byId.get(roots[0])!);
    const tr = rectOf(target!);
    dx = tr.x + tr.w / 2 - (rr.x + rr.w / 2);
    dy = tr.y + tr.h / 2 - (rr.y + rr.h / 2);
  } else if (attach) {
    const all = boundsOf(dg.cells.filter((c) => c.vertex).map(rectOf))!;
    const tr = rectOf(target!);
    dx = all.x + all.w + 80 - box.x;
    dy = tr.y - 60 - (box.y + box.h);
  } else {
    dx = at.x - (box.x + box.w / 2);
    dy = at.y - (box.y + box.h / 2);
  }
  dx = snap(dx);
  dy = snap(dy);

  const prefix = uid("g") + "_";
  const ids: string[] = [];
  for (const c of src) {
    if (c.vertex && keep.has(c.id)) {
      const copy: Cell = { ...c, id: prefix + c.id, parent: "1", x: (c.x ?? 0) + dx, y: (c.y ?? 0) + dy };
      dg.cells.push(copy);
      ids.push(copy.id);
    } else if (c.edge && c.source && c.target && keep.has(c.source) && keep.has(c.target)) {
      const copy: Cell = { ...c, id: prefix + c.id, parent: "1", source: prefix + c.source, target: prefix + c.target };
      if (copy.points) copy.points = copy.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      dg.cells.push(copy);
    }
  }
  for (const n of notes) {
    const r = rectOf(g.byId.get(n.gate)!);
    const id = prefix + n.gate + "_note";
    dg.cells.push({
      id,
      value: "establishes: " + n.text.replace(/&/g, "&amp;").replace(/</g, "&lt;"),
      style: ANNOTATION_STYLE,
      parent: "1",
      vertex: true,
      x: r.x + r.w + 8 + dx,
      y: r.y + r.h + 2 + dy,
      width: 280,
      height: 26,
    });
    ids.push(id);
  }

  if (replace) {
    const newRoot = prefix + roots[0];
    const fed = new Set<string>();
    for (const c of dg.cells) {
      if (c.edge && c.source === target!.id && c.target) {
        c.source = newRoot;
        fed.add(c.target);
      }
    }
    deleteCells(dg, [target!.id, target!.id + "_l"]);
    for (const t of fed) autoAnchor(dg.cells, t);
    return { ids, note: "Replaced the selected input with the inserted graph." };
  }
  if (attach) {
    for (const r of roots) connect(dg, prefix + r, target!.id);
    return { ids, note: "Inserted as a new input of the selected node. Drag it into place." };
  }
  return { ids, note: "Inserted. Drag it into place." };
}
