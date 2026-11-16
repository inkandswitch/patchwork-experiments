// Document model + pure graph logic (no DOM, no framework).
//
// The document mirrors a draw.io file: a list of diagrams (pages), each a flat
// list of mxCells. Node kinds (trusted / untrusted / AND / OR / output) are not
// stored separately — they are read off the draw.io style, exactly as in the
// hand-drawn examples, so a file round-trips through draw.io unchanged.

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export type Cell = {
  id: string;
  value: string;
  style: string;
  parent: string;
  vertex?: boolean;
  edge?: boolean;
  source?: string;
  target?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  relative?: boolean;
  points?: Pt[];
  /** any other mxCell attributes, kept for round-tripping */
  attrs?: Record<string, string>;
};

export type Diagram = {
  id: string;
  name: string;
  /** mxGraphModel attributes (grid, pageWidth, …) */
  model: Record<string, string>;
  cells: Cell[];
};

export type GraphDoc = {
  title: string;
  diagrams: Diagram[];
};

export type Kind = "trusted" | "untrusted" | "and" | "or" | "output" | "note" | "text" | "box";
export type BlockKind = "trusted" | "untrusted" | "and" | "or" | "output";

export const DEFAULT_MODEL: Record<string, string> = {
  grid: "1",
  page: "1",
  gridSize: "10",
  guides: "1",
  tooltips: "1",
  connect: "1",
  arrows: "1",
  fold: "1",
  pageScale: "1",
  pageWidth: "1260",
  pageHeight: "840",
  math: "0",
  shadow: "0",
};

export function uid(prefix = ""): string {
  return prefix + Math.random().toString(36).slice(2, 10);
}

export function newDiagram(name: string): Diagram {
  return { id: uid("d"), name, model: { ...DEFAULT_MODEL }, cells: [] };
}

// ---------------------------------------------------------------- styles

export const TRUSTED_COLORS = { fillColor: "#d5e8d4", strokeColor: "#82b366", fontColor: "#000000" };
export const UNTRUSTED_COLORS = { fillColor: "#f5f5f5", strokeColor: "#666666", fontColor: "#333333" };

export const BLOCK_STYLES: Record<BlockKind, string> = {
  trusted:
    "rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontColor=#000000;fontSize=12;",
  untrusted:
    "rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;fontColor=#333333;fontSize=12;",
  and: "rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#000000;fontStyle=1;fontSize=13;strokeWidth=1.5;",
  or: "rhombus;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#000000;fontStyle=1;fontSize=13;strokeWidth=1.5;",
  output:
    "rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#000000;strokeWidth=2;fontSize=13;",
};
export const BLOCK_SIZES: Record<BlockKind, { w: number; h: number }> = {
  trusted: { w: 190, h: 100 },
  untrusted: { w: 190, h: 100 },
  and: { w: 84, h: 40 },
  or: { w: 96, h: 56 },
  output: { w: 400, h: 56 },
};
export const BLOCK_VALUES: Record<BlockKind, string> = {
  trusted: "<b>Assumption</b><br>describe the trusted input",
  untrusted: "<b>Attestation</b><br>describe the attested input",
  and: "AND",
  or: "OR",
  output: "<b>E: result</b><br>describe what is established",
};
export const LABEL_STYLE =
  "text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;fontSize=14;fontStyle=2;";
export const ANNOTATION_STYLE =
  "text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;fontSize=11;fontStyle=2;fontColor=#555555;whiteSpace=wrap;";
export const EDGE_STYLE = "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=classic;";

export function styleGet(style: string, key: string): string | undefined {
  for (const part of style.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === key) return part.slice(i + 1);
  }
  return undefined;
}

export function styleHas(style: string, flag: string): boolean {
  return style.split(";").includes(flag);
}

/** Set (or with `null`, remove) keys in a draw.io style string, keeping order. */
export function styleSet(style: string, values: Record<string, string | number | null>): string {
  const parts = style.split(";").filter((p) => p !== "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const i = part.indexOf("=");
    const key = i > 0 ? part.slice(0, i) : null;
    if (key !== null && key in values) {
      if (seen.has(key)) continue;
      seen.add(key);
      const v = values[key];
      if (v !== null) out.push(`${key}=${v}`);
    } else out.push(part);
  }
  for (const [key, v] of Object.entries(values)) {
    if (!seen.has(key) && v !== null) out.push(`${key}=${v}`);
  }
  return out.join(";") + ";";
}

export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>|<\/div>|<\/p>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function kindOf(cell: Cell): Kind {
  const style = cell.style || "";
  if (style.startsWith("text")) return "text";
  if (styleGet(style, "shape") === "note") return "note";
  if (styleHas(style, "rhombus") || styleGet(style, "shape") === "rhombus") return "or";
  const fill = (styleGet(style, "fillColor") || "").toLowerCase();
  if (fill === TRUSTED_COLORS.fillColor) return "trusted";
  if (fill === UNTRUSTED_COLORS.fillColor) return "untrusted";
  const text = plainText(cell.value || "").toUpperCase();
  if (text === "AND") return "and";
  if (text === "OR") return "or";
  if (styleGet(style, "strokeWidth") === "2") return "output";
  return "box";
}

export const isGate = (k: Kind) => k === "and" || k === "or";

export function rectOf(c: Cell): Rect {
  return { x: c.x ?? 0, y: c.y ?? 0, w: c.width ?? 0, h: c.height ?? 0 };
}

function rectDistance(a: Rect, b: Rect): number {
  const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0);
  const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0);
  return Math.hypot(dx, dy);
}

// ---------------------------------------------------------------- graph

export type Graph = {
  byId: Map<string, Cell>;
  vertices: Cell[];
  edges: Cell[];
  preds: Map<string, string[]>;
  succs: Map<string, string[]>;
  /** text cell id → the node it annotates */
  owner: Map<string, string>;
  /** node id → text cells annotating it */
  owned: Map<string, string[]>;
  /** text cells that sit directly above their owner: the "in₃" style name */
  topLabel: Map<string, string>;
};

const ATTACH_DISTANCE = 60;

export function buildGraph(cells: Cell[]): Graph {
  const byId = new Map<string, Cell>();
  for (const c of cells) byId.set(c.id, c);
  const vertices = cells.filter((c) => c.vertex);
  const edges = cells.filter(
    (c) => c.edge && c.source && c.target && byId.get(c.source)?.vertex && byId.get(c.target)?.vertex,
  );
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const e of edges) {
    if (!preds.has(e.target!)) preds.set(e.target!, []);
    if (!succs.has(e.source!)) succs.set(e.source!, []);
    if (!preds.get(e.target!)!.includes(e.source!)) preds.get(e.target!)!.push(e.source!);
    if (!succs.get(e.source!)!.includes(e.target!)) succs.get(e.source!)!.push(e.target!);
  }

  // Free-floating text cells are attached to the node they sit next to, so
  // they move, hide and collapse together with it.
  const owner = new Map<string, string>();
  const owned = new Map<string, string[]>();
  const topLabel = new Map<string, string>();
  const anchors = vertices.filter((c) => {
    const k = kindOf(c);
    return k !== "text" && k !== "note";
  });
  for (const t of vertices) {
    if (kindOf(t) !== "text") continue;
    const tr = rectOf(t);
    let best: Cell | undefined;
    let isTop = false;
    // id conventions take precedence over proximity: "<id>_l" is the name
    // above a node, "<id>_note" a note about it
    const base = t.id.endsWith("_l") ? byId.get(t.id.slice(0, -2)) : undefined;
    const noted = t.id.endsWith("_note") ? byId.get(t.id.slice(0, -5)) : undefined;
    if (base?.vertex && kindOf(base) !== "text") {
      best = base;
      isTop = true;
    } else if (noted?.vertex && kindOf(noted) !== "text") {
      best = noted;
    } else {
      let bestD = ATTACH_DISTANCE;
      for (const a of anchors) {
        const d = rectDistance(tr, rectOf(a));
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      }
      if (best) {
        const br = rectOf(best);
        const cx = tr.x + tr.w / 2;
        isTop = Math.abs(tr.y + tr.h - br.y) <= 4 && cx >= br.x && cx <= br.x + br.w;
        // A caption that merely sits closest to an input block usually
        // describes the gate beside it ("both attested: …" under an AND).
        if (!isTop && !isGate(kindOf(best))) {
          let gateD = ATTACH_DISTANCE;
          for (const a of anchors) {
            if (!isGate(kindOf(a))) continue;
            const d = rectDistance(tr, rectOf(a));
            if (d < gateD) {
              gateD = d;
              best = a;
            }
          }
        }
      }
    }
    if (!best) continue;
    owner.set(t.id, best.id);
    if (!owned.has(best.id)) owned.set(best.id, []);
    owned.get(best.id)!.push(t.id);
    if (isTop && !topLabel.has(best.id)) topLabel.set(best.id, t.id);
  }
  return { byId, vertices, edges, preds, succs, owner, owned, topLabel };
}

/** All strict ancestors (transitive inputs) of a node. */
export function ancestors(g: Graph, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [...(g.preds.get(id) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n) || n === id) continue;
    seen.add(n);
    for (const p of g.preds.get(n) ?? []) stack.push(p);
  }
  return seen;
}

/** Does the node hold, given which inputs are trusted? AND = all, OR = any. */
export function evaluate(g: Graph, id: string, memo = new Map<string, boolean>()): boolean {
  if (memo.has(id)) return memo.get(id)!;
  memo.set(id, false); // cycle guard
  const cell = g.byId.get(id);
  const kind = cell ? kindOf(cell) : "box";
  const preds = g.preds.get(id) ?? [];
  let result: boolean;
  if (kind === "trusted") result = true;
  else if (kind === "untrusted") result = false;
  else if (preds.length === 0) result = false;
  else if (kind === "or") result = preds.some((p) => evaluate(g, p, memo));
  else result = preds.every((p) => evaluate(g, p, memo));
  memo.set(id, result);
  return result;
}

const ESTABLISHES = /^establishes:\s*/i;

/** The text cell beside a gate that names it: its "establishes: …" note, else its first note. */
export function titleLabel(g: Graph, id: string): Cell | undefined {
  const notes = (g.owned.get(id) ?? []).filter((t) => g.topLabel.get(id) !== t).map((t) => g.byId.get(t)!);
  return notes.find((c) => ESTABLISHES.test(plainText(c.value))) ?? notes[0];
}

/** Human title for a node: for gates, the "establishes: …" note next to it. */
export function titleOf(g: Graph, id: string): string {
  const cell = g.byId.get(id);
  if (!cell) return "";
  const kind = kindOf(cell);
  if (isGate(kind)) {
    const label = titleLabel(g, id);
    if (label) return plainText(label.value).replace(ESTABLISHES, "");
    const n = (g.preds.get(id) ?? []).length;
    return `${kind.toUpperCase()} of ${n} input${n === 1 ? "" : "s"}`;
  }
  return plainText(cell.value);
}

/** "[in₁–in₃, in₆]" summary of the leaf inputs feeding a node (as HTML). */
export function inputSummary(g: Graph, id: string): string {
  const leaves = [...ancestors(g, id)].filter((n) => (g.preds.get(n) ?? []).length === 0);
  const nums = new Set<number>();
  let unnamed = false;
  for (const leaf of leaves) {
    const label = g.topLabel.get(leaf);
    const m = label ? /^in\s*(\d+)$/i.exec(plainText(g.byId.get(label)!.value)) : null;
    if (m) nums.add(Number(m[1]));
    else unnamed = true;
  }
  if (unnamed || nums.size === 0) return `${leaves.length} input${leaves.length === 1 ? "" : "s"}`;
  const sorted = [...nums].sort((a, b) => a - b);
  const parts: string[] = [];
  const name = (n: number) => `in<sub>${n}</sub>`;
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (j === i) parts.push(name(sorted[i]));
    else if (j === i + 1) parts.push(name(sorted[i]), name(sorted[j]));
    else parts.push(`${name(sorted[i])}–${name(sorted[j])}`);
    i = j + 1;
  }
  return `[${parts.join(", ")}]`;
}

// ---------------------------------------------------------------- chosen path

/** OR id → the one input chosen for it. */
export type Choices = Record<string, string>;

/** An OR only poses a choice when it has more than one input. */
const isChoice = (g: Graph, id: string) => {
  const cell = g.byId.get(id);
  return !!cell && kindOf(cell) === "or" && (g.preds.get(id) ?? []).length > 1;
};

/** The ORs (with alternatives) that a node is an input of. */
export function choiceGates(g: Graph, id: string): string[] {
  return (g.succs.get(id) ?? []).filter((s) => isChoice(g, s));
}

/** Where every path ends: logic nodes that have inputs and feed nothing. */
export function sinks(g: Graph): string[] {
  return g.vertices
    .filter((c) => (g.preds.get(c.id) ?? []).length > 0 && (g.succs.get(c.id) ?? []).length === 0)
    .map((c) => c.id);
}

/**
 * The path through the graph, walked upstream from `roots`: everything that
 * is decided (all inputs of an AND, the lone input of anything else) plus, at
 * each OR, only the chosen input. An OR with no choice ends the path there.
 */
export function chosenPath(g: Graph, chosen: Choices, roots: string[]): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>();
  const links = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const n = stack.pop()!;
    if (nodes.has(n)) continue;
    nodes.add(n);
    let preds = g.preds.get(n) ?? [];
    if (isChoice(g, n)) preds = preds.filter((p) => p === chosen[n]);
    for (const p of preds) {
      links.add(`${p}\n${n}`);
      stack.push(p);
    }
  }
  const edges = new Set(g.edges.filter((e) => links.has(`${e.source}\n${e.target}`)).map((e) => e.id));
  return { nodes, edges };
}

/** Is this node the chosen input of every OR it feeds? */
export function isChosen(g: Graph, chosen: Choices, id: string): boolean {
  const gates = choiceGates(g, id);
  return gates.length > 0 && gates.every((o) => chosen[o] === id);
}

/**
 * Choose `id` at the OR(s) it feeds — replacing whichever sibling was chosen —
 * or, if it is already the choice, clear it. Choosing inside a branch that is
 * not itself on the path also switches the ORs downstream to that branch, so
 * the result is always one connected path to the output.
 */
export function toggleChoice(g: Graph, chosen: Choices, id: string): Choices {
  const gates = choiceGates(g, id);
  if (!gates.length) return chosen;
  const next: Choices = {};
  // drop choices that no longer match the graph
  for (const [o, p] of Object.entries(chosen)) if (isChoice(g, o) && g.preds.get(o)!.includes(p)) next[o] = p;
  if (isChosen(g, next, id)) {
    for (const o of gates) delete next[o];
    return next;
  }
  const roots = sinks(g);
  for (const o of gates) {
    next[o] = id;
    if (chosenPath(g, next, roots).nodes.has(o)) continue;
    // shortest way downstream to the existing path; it joins at an OR
    const on = chosenPath(g, next, roots).nodes;
    const from = new Map<string, string>();
    const queue = [o];
    let hit: string | undefined;
    while (queue.length && !hit) {
      const n = queue.shift()!;
      for (const s of g.succs.get(n) ?? []) {
        if (s === o || from.has(s)) continue;
        from.set(s, n);
        if (on.has(s)) {
          hit = s;
          break;
        }
        queue.push(s);
      }
    }
    for (let n = hit; n && n !== o; n = from.get(n)) if (isChoice(g, n)) next[n] = from.get(n)!;
  }
  return next;
}

// ---------------------------------------------------------------- evidence bundles

/** One column of the table: an input, which may be drawn as several leaves. */
export type BundleInput = { label: string; title: string; leaves: string[] };
/** One valid path: a choice at every OR it reaches, and which inputs it uses. */
export type Bundle = { choices: Choices; title: string; bits: boolean[] };
export type BundleTable = { inputs: BundleInput[]; bundles: Bundle[]; truncated: boolean };

/**
 * Every valid path through the graph — each consistent way of picking one
 * input at every OR the path reaches — with the inputs it relies on.
 */
export function evidenceBundles(g: Graph, limit = 200): BundleTable {
  const roots = sinks(g);
  let truncated = false;
  const cap = (list: Choices[]) => {
    if (list.length <= limit) return list;
    truncated = true;
    return list.slice(0, limit);
  };
  /** both sets of choices at once, or null if they differ at a shared OR */
  const merge = (a: Choices, b: Choices): Choices | null => {
    for (const k in b) if (k in a && a[k] !== b[k]) return null;
    return { ...a, ...b };
  };
  const all = (ids: string[]): Choices[] => {
    let acc: Choices[] = [{}];
    for (const id of ids) {
      const next: Choices[] = [];
      for (const a of acc) {
        for (const b of options(id)) {
          const m = merge(a, b);
          if (m) next.push(m);
        }
        if (next.length > limit) break;
      }
      acc = cap(next);
    }
    return acc;
  };
  const memo = new Map<string, Choices[]>();
  const options = (id: string): Choices[] => {
    const hit = memo.get(id);
    if (hit) return hit;
    memo.set(id, []); // cycle guard
    const preds = g.preds.get(id) ?? [];
    let result: Choices[];
    if (isChoice(g, id)) {
      result = [];
      // the outer choice goes first, so a bundle reads from the output inwards
      for (const p of preds) for (const sub of options(p)) if (!(id in sub)) result.push({ [id]: p, ...sub });
      result = cap(result);
    } else result = all(preds);
    memo.set(id, result);
    return result;
  };
  const paths = roots.length ? all(roots) : [];

  // columns: the leaves that feed an output, grouped by their "inN" name
  const reach = new Set<string>();
  for (const r of roots) for (const a of ancestors(g, r)) reach.add(a);
  const named = new Map<number, string[]>();
  const inputs: BundleInput[] = [];
  const describe = (id: string) => plainText(g.byId.get(id)!.value);
  for (const c of g.vertices) {
    if (!reach.has(c.id) || (g.preds.get(c.id) ?? []).length > 0) continue;
    const label = g.topLabel.get(c.id);
    const m = label ? /^in\s*(\d+)$/i.exec(plainText(g.byId.get(label)!.value)) : null;
    if (m) {
      const n = Number(m[1]);
      if (!named.has(n)) named.set(n, []);
      named.get(n)!.push(c.id);
    } else {
      const text = describe(c.id);
      inputs.push({ label: escapeHtml(text.length > 22 ? text.slice(0, 21) + "…" : text), title: text, leaves: [c.id] });
    }
  }
  const numbered = [...named.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, leaves]) => ({ label: `in<sub>${n}</sub>`, title: describe(leaves[0]), leaves }));
  inputs.unshift(...numbered);

  // a gate nobody captioned is named by the inputs behind it: "[in1–in5, in7]"
  const name = (id: string) => {
    const title = titleOf(g, id);
    return /^(AND|OR) of \d+ inputs?$/.test(title) ? plainText(inputSummary(g, id)) : title;
  };
  const bundles = paths.map((choices) => {
    const on = chosenPath(g, choices, roots).nodes;
    const picked = Object.values(choices);
    return {
      choices,
      title: picked.length ? picked.map(name).join(" · ") : "The only path",
      bits: inputs.map((input) => input.leaves.some((leaf) => on.has(leaf))),
    };
  });
  return { inputs, bundles, truncated };
}

/** Is the current choice exactly this bundle's path? */
export function matchesChoices(chosen: Choices, bundle: Choices): boolean {
  for (const k in bundle) if (chosen[k] !== bundle[k]) return false;
  return true;
}

// ---------------------------------------------------------------- view

/** Per-page view state: collapsed subgraphs, the zoom path, the chosen path, the bundles drawer. */
export type ViewState = { collapsed: string[]; zoom: string[]; chosen?: Choices; bundles?: boolean };

export type VNode = {
  id: string;
  kind: Kind;
  rect: Rect;
  html: string;
  style: string;
  /** shown as a single node standing for its whole input subgraph */
  collapsed: boolean;
  /** derived trust of a collapsed subgraph */
  holds: boolean;
  caption: string;
  /** collapsed only: "AND: 3 inputs" / "OR: 3 paths" */
  heading: string;
  /** collapsed only: the label beside the node, "" when it has none */
  title: string;
  /** gets the collapse / expand toggle */
  foldable: boolean;
  /** synthetic (not in the document): the output box of a zoomed view */
  virtual: boolean;
  /** takes part in the logic graph (can be wired up) */
  logic: boolean;
  hasInputs: boolean;
  /** an input of an OR with alternatives: can be chosen as the path */
  choosable: boolean;
  /** currently the chosen input of the OR(s) it feeds */
  chosen: boolean;
  /** on the highlighted path */
  onPath: boolean;
};

export type VEdge = { id: string; source: string; target: string; style: string; points: Pt[]; virtual: boolean };

export type View = {
  graph: Graph;
  nodes: VNode[];
  nodeById: Map<string, VNode>;
  edges: VEdge[];
  edgeById: Map<string, VEdge>;
  /** collapsed node id → every cell hidden inside it */
  hiddenIn: Map<string, string[]>;
  /** edges on the highlighted path */
  pathEdges: Set<string>;
  zoomRoot: string | null;
  /** valid zoom path, with titles, outermost first */
  crumbs: { id: string; title: string }[];
};

export const COLLAPSED_SIZE = { w: 190, h: 100 };
export const ZOOM_OUTPUT_ID = "__zoom_output__";
export const ZOOM_EDGE_ID = "__zoom_edge__";

export function computeView(cells: Cell[], state: ViewState): View {
  const g = buildGraph(cells);

  // Zoom: only the chosen node and everything feeding into it.
  const crumbsIds = state.zoom.filter((id) => g.byId.get(id)?.vertex && (g.preds.get(id) ?? []).length > 0);
  const zoomRoot = crumbsIds.length ? crumbsIds[crumbsIds.length - 1] : null;
  let scope: Set<string>;
  if (zoomRoot) {
    scope = ancestors(g, zoomRoot);
    scope.add(zoomRoot);
  } else {
    scope = new Set(g.vertices.filter((c) => kindOf(c) !== "text" || !g.owner.has(c.id)).map((c) => c.id));
  }

  // Collapse: a collapsed node swallows the inputs that feed *only* it.
  const collapsed = new Set(
    state.collapsed.filter((id) => scope.has(id) && id !== zoomRoot && (g.preds.get(id) ?? []).length > 0),
  );
  const inside = new Set<string>(); // K: strict ancestors of any collapsed node
  for (const c of collapsed) for (const a of ancestors(g, c)) inside.add(a);
  // A node inside survives if it still reaches something outside without
  // passing through a collapsed node (i.e. it is shared with another branch).
  const survives = new Set<string>();
  const stack: string[] = [];
  for (const id of scope) if (!inside.has(id)) stack.push(id);
  while (stack.length) {
    const n = stack.pop()!;
    if (survives.has(n)) continue;
    survives.add(n);
    if (collapsed.has(n)) continue; // edges into a collapsed node are cut
    for (const p of g.preds.get(n) ?? []) if (scope.has(p)) stack.push(p);
  }
  const visibleNode = (id: string) => scope.has(id) && survives.has(id);

  const hiddenIn = new Map<string, string[]>();
  for (const c of collapsed) {
    if (!visibleNode(c)) continue;
    const hidden: string[] = [];
    for (const a of ancestors(g, c)) {
      if (visibleNode(a)) continue;
      hidden.push(a, ...(g.owned.get(a) ?? []));
    }
    hiddenIn.set(c, hidden);
  }

  // The path is walked from where the view ends: the zoomed node, else the outputs.
  const chosen = state.chosen ?? {};
  const path = chosenPath(g, chosen, zoomRoot ? [zoomRoot] : sinks(g));

  const memo = new Map<string, boolean>();
  const nodes: VNode[] = [];
  for (const c of g.vertices) {
    const kind = kindOf(c);
    const ownerId = g.owner.get(c.id);
    if (kind === "text" && ownerId) {
      // annotations follow their node; a collapsed node carries its own text
      if (!visibleNode(ownerId) || collapsed.has(ownerId)) continue;
    } else if (!visibleNode(c.id)) continue;

    const isCollapsed = collapsed.has(c.id);
    let rect = rectOf(c);
    let html = c.value || "";
    let caption = "";
    let heading = "";
    let title = "";
    if (isCollapsed) {
      const n = (g.preds.get(c.id) ?? []).length;
      if (kind === "or") heading = `OR: ${n} path${n === 1 ? "" : "s"}`;
      else heading = `${kind === "and" ? "AND" : "Group"}: ${n} input${n === 1 ? "" : "s"}`;
      title = isGate(kind) ? (titleLabel(g, c.id) ? titleOf(g, c.id) : "") : plainText(c.value || "");
      rect = {
        x: rect.x + rect.w / 2 - COLLAPSED_SIZE.w / 2,
        y: rect.y + rect.h / 2 - COLLAPSED_SIZE.h / 2,
        ...COLLAPSED_SIZE,
      };
      html = `<b>${heading}</b><br>${escapeHtml(title || "Untitled")}`;
      caption = inputSummary(g, c.id);
    }
    nodes.push({
      id: c.id,
      kind,
      rect,
      html,
      style: c.style || "",
      collapsed: isCollapsed,
      holds: isCollapsed ? evaluate(g, c.id, memo) : false,
      caption,
      heading,
      title,
      foldable: isCollapsed || (isGate(kind) && c.id !== zoomRoot && (g.preds.get(c.id) ?? []).length > 0),
      virtual: false,
      logic: kind !== "text" && kind !== "note",
      hasInputs: (g.preds.get(c.id) ?? []).length > 0,
      choosable: choiceGates(g, c.id).length > 0,
      chosen: isChosen(g, chosen, c.id),
      onPath: path.nodes.has(c.id),
    });
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const edges: VEdge[] = [];
  for (const e of g.edges) {
    if (!nodeById.has(e.source!) || !nodeById.has(e.target!)) continue;
    if (collapsed.has(e.target!)) continue;
    edges.push({
      id: e.id,
      source: e.source!,
      target: e.target!,
      style: e.style || "",
      points: (e.points ?? []).map((p) => ({ x: p.x, y: p.y })),
      virtual: false,
    });
  }

  // A zoomed gate gets a synthetic output box naming what it establishes,
  // like the hand-drawn "Zoom: …" pages.
  if (zoomRoot && !g.byId.has(ZOOM_OUTPUT_ID)) {
    const root = nodeById.get(zoomRoot)!;
    if (isGate(root.kind)) {
      const w = 400;
      const h = 56;
      const out: VNode = {
        id: ZOOM_OUTPUT_ID,
        kind: "output",
        rect: { x: root.rect.x + root.rect.w / 2 - w / 2, y: root.rect.y + root.rect.h + 64, w, h },
        html: `<b>E:</b> ${escapeHtml(titleOf(g, zoomRoot))}`,
        style: BLOCK_STYLES.output,
        collapsed: false,
        holds: false,
        caption: "",
        heading: "",
        title: "",
        foldable: false,
        virtual: true,
        logic: false,
        hasInputs: true,
        choosable: false,
        chosen: false,
        onPath: true,
      };
      nodes.push(out);
      nodeById.set(out.id, out);
      edges.push({
        id: ZOOM_EDGE_ID,
        source: zoomRoot,
        target: ZOOM_OUTPUT_ID,
        style: EDGE_STYLE,
        points: [],
        virtual: true,
      });
      path.edges.add(ZOOM_EDGE_ID);
    }
  }

  return {
    graph: g,
    nodes,
    nodeById,
    edges,
    edgeById: new Map(edges.map((e) => [e.id, e])),
    hiddenIn,
    pathEdges: path.edges,
    zoomRoot,
    crumbs: crumbsIds.map((id) => ({ id, title: titleOf(g, id) })),
  };
}

// ---------------------------------------------------------------- edges

const num = (v: string | undefined, fallback: number) => {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Orthogonal polyline for an edge, honouring draw.io exit/entry anchors. */
export function routeEdge(src: Rect, dst: Rect, style: string, waypoints: Pt[]): Pt[] {
  const ex = num(styleGet(style, "exitX"), 0.5);
  const ey = num(styleGet(style, "exitY"), 1);
  const nx = num(styleGet(style, "entryX"), 0.5);
  const ny = num(styleGet(style, "entryY"), 0);
  const start = { x: src.x + src.w * ex, y: src.y + src.h * ey };
  const end = { x: dst.x + dst.w * nx, y: dst.y + dst.h * ny };
  const startVert = !(ex === 0 || ex === 1);
  const endVert = !(nx === 0 || nx === 1);

  const pts = [start, ...waypoints, end];
  const out: Pt[] = [start];
  const EPS = 0.5;
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    if (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS) {
      const first = i === 1;
      const last = i === pts.length - 1;
      if (first && last) {
        if (startVert && endVert) {
          const my = (a.y + b.y) / 2;
          out.push({ x: a.x, y: my }, { x: b.x, y: my });
        } else if (startVert) out.push({ x: a.x, y: b.y });
        else if (endVert) out.push({ x: b.x, y: a.y });
        else {
          const mx = (a.x + b.x) / 2;
          out.push({ x: mx, y: a.y }, { x: mx, y: b.y });
        }
      } else if (first) out.push(startVert ? { x: a.x, y: b.y } : { x: b.x, y: a.y });
      else if (last) out.push(endVert ? { x: b.x, y: a.y } : { x: a.x, y: b.y });
      else out.push({ x: a.x, y: b.y });
    }
    out.push(b);
  }
  return out;
}

/**
 * Re-anchor every edge entering `targetId`: inputs above the node are spread
 * along its top (left to right, so they never cross), inputs beside it enter
 * from the side. Stored waypoints are dropped so the route is recomputed.
 * Mutates cells in place (call inside a change).
 */
export function autoAnchor(cells: Cell[], targetId: string): void {
  const target = cells.find((c) => c.id === targetId);
  if (!target) return;
  const tr = rectOf(target);
  const diamond = kindOf(target) === "or";
  const incoming = cells
    .filter((c) => c.edge && c.target === targetId && c.source)
    .map((edge) => ({ edge, src: cells.find((c) => c.id === edge.source) }))
    .filter((x): x is { edge: Cell; src: Cell } => !!x.src);
  const above: { edge: Cell; src: Cell }[] = [];
  for (const item of incoming) {
    const sr = rectOf(item.src);
    if (sr.y + sr.h / 2 < tr.y - 10) {
      above.push(item);
      continue;
    }
    const fromLeft = sr.x + sr.w / 2 < tr.x + tr.w / 2;
    item.edge.style = styleSet(item.edge.style || EDGE_STYLE, {
      exitX: fromLeft ? 1 : 0,
      exitY: 0.5,
      exitDx: 0,
      exitDy: 0,
      entryX: fromLeft ? 0 : 1,
      entryY: 0.5,
      entryDx: 0,
      entryDy: 0,
    });
    if (item.edge.points) delete item.edge.points;
  }
  above.sort((a, b) => rectOf(a.src).x + rectOf(a.src).w / 2 - (rectOf(b.src).x + rectOf(b.src).w / 2));
  above.forEach((item, i) => {
    const f = Math.round(((i + 1) / (above.length + 1)) * 10000) / 10000;
    item.edge.style = styleSet(item.edge.style || EDGE_STYLE, {
      exitX: 0.5,
      exitY: 1,
      exitDx: 0,
      exitDy: 0,
      entryX: f,
      // on a rhombus the top edge slopes away from the apex
      entryY: diamond ? Math.round(Math.abs(0.5 - f) * 10000) / 10000 : 0,
      entryDx: 0,
      entryDy: 0,
    });
    if (item.edge.points) delete item.edge.points;
  });
}

export function boundsOf(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
