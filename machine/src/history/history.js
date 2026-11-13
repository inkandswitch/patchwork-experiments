// Every state one peer's engine was in, as a tree, made from a timeline's
// trace (host/timeline.js). A node is a state; its parent is the state it was
// stepped from and its row the inputs that step used, so a state is the
// root's with the rows on its path stepped in order (rebuild.js does that).
//
// A state is a value: the same state stepped with the same row is the same
// state. So a re-step after a rewind that uses the row it used before
// reaches the node it reached before, and the tree forks only where a row
// changed. A fork is a conflict: the timeline predicted some port's input,
// stepped on, learned the real one, rewound and stepped again. The branch the
// head is on is how it was resolved; the other is what this peer believed for
// a while and, if a frame ended on it, showed.
//
// Nothing here knows what an engine is or what its inputs mean: rows are
// bytes, players × inputBytes, compared as bytes.

/**
 * @typedef {object} Node
 * @property {number} id
 * @property {number} tick     the tick the state is at
 * @property {Uint8Array|null} row  the inputs stepped from the parent (null at a root)
 * @property {Node|null} parent
 * @property {Node[]} kids
 * @property {number} born     ms (the last frame's clock) when first stepped to
 * @property {number} shown    how many frames ended with this as the head
 * @property {Uint8Array} [snapshot]  a root's state (a copy)
 *
 * @typedef {object} Conflict
 * @property {number} at       ms (the last frame's clock) of the rewind that made it
 * @property {Node} parent     the state both branches were stepped from
 * @property {Node} abandoned  the child stepped first, on a prediction
 * @property {Node} kept       the child stepped instead
 * @property {Node} leaf       the furthest state the abandoned branch had reached
 * @property {number[]} ports  the ports whose input differs between the two rows
 * @property {number} restepped  steps after the rewind, until the head passed
 *                             the leaf's tick or the next rewind came
 */

export class History {
  /** Every start kept (genesis, or a checkpoint after a rebase), oldest first: { root, at }. */
  epochs = [];
  /** The state the engine is in. */
  head = null;
  /** Ticks below this are confirmed (the host's, at the last frame). */
  frontier = 0;
  /** The tick the clock said at the last frame. */
  target = 0;
  /** The last frame's clock, ms. */
  at = 0;
  /** Conflicts, in the order they were made. */
  conflicts = [];
  /** Rewinds whose re-steps reached the same states again: work, no conflict. */
  idle = 0;
  /** Nodes held, over every epoch kept. */
  size = 0;
  /** Bumped on every event, for a view to know when to look again. */
  version = 0;

  #ids = 0;
  #width;
  #keep;
  #window;
  // The rewind being re-stepped: the branch it left (path[i] at tick
  // path[0].tick + i), and the conflict once the re-steps leave it.
  #open = null; // { at, path, restepped, conflict }

  /**
   * @param o.inputBytes  one port's input width (the whole row is one port if absent)
   * @param o.epochs      how many starts to keep; older ones go, nodes and all
   * @param o.keep        ticks of history to keep, at least: when a confirmed
   *                      state (the trace's) is further than this from the
   *                      root, it becomes the root. So a history spans between
   *                      keep and keep plus the host's checkpoint period.
   */
  constructor({ inputBytes = Infinity, epochs = 2, keep = Infinity } = {}) {
    this.#width = inputBytes;
    this.#keep = epochs;
    this.#window = keep;
  }

  /** The trace function to give a Host or a Timeline. */
  record = (e) => {
    this.version++;
    if ("step" in e) this.#step(e.step, e.row);
    else if ("rewind" in e) this.#rewind(e.rewind);
    else if ("frame" in e) this.#frame(e);
    else if ("start" in e) this.#start(e.start, e.snapshot);
    else if ("confirmed" in e) this.#confirmed(e.confirmed, e.snapshot);
  };

  /** The current epoch's root. */
  get root() {
    return this.epochs.at(-1)?.root ?? null;
  }

  /** The state on the head's path at tick, or null (past the head, before the root). */
  onPath(tick) {
    return ancestorAt(this.head, tick);
  }

  /** Whether node is on the path from the root to the head. */
  kept(node) {
    return this.onPath(node.tick) === node;
  }

  /**
   * Makes `node`, on the head's path, the current epoch's root, with its
   * state `snapshot` (rebuild.js gives it): everything before it goes, and
   * the conflicts there with it. A long session's history stays bounded so.
   */
  reroot(node, snapshot) {
    if (!this.kept(node)) throw new Error("a new root must be on the head's path");
    const epoch = this.epochs.at(-1);
    this.size -= count(epoch.root) - count(node);
    node.parent = null;
    node.row = null;
    node.snapshot = snapshot.slice();
    epoch.root = node;
    const roots = new Set(this.epochs.map((e) => e.root));
    this.conflicts = this.conflicts.filter((c) => roots.has(rootOf(c.parent)));
  }

  // A leaf's kids are one shared empty list, and a row equal to its
  // parent's is its parent's: inputs change seldom, so most rows are shared.
  #node(tick, row, parent) {
    this.size++;
    if (row && parent?.row && equal(row, parent.row)) row = parent.row;
    return { id: this.#ids++, tick, row, parent, kids: NONE, born: this.at, shown: 0 };
  }

  #start(tick, snapshot) {
    this.#open = null;
    const root = this.#node(tick, null, null);
    root.snapshot = snapshot.slice();
    this.epochs.push({ root, at: this.at });
    this.head = root;
    while (this.epochs.length > this.#keep) {
      const gone = this.epochs.shift();
      this.size -= count(gone.root);
      this.conflicts = this.conflicts.filter((c) => rootOf(c.parent) !== gone.root);
    }
  }

  #step(tick, row) {
    const h = this.head;
    if (!h || h.tick !== tick) throw new Error(`a step from ${tick}, but the history is at ${h?.tick}`);
    let next = h.kids.find((k) => equal(k.row, row));
    if (!next) {
      next = this.#node(tick + 1, row, h);
      if (h.kids === NONE) h.kids = [];
      h.kids.push(next);
    }
    this.head = next;
    const o = this.#open;
    if (!o) return;
    o.restepped++;
    const leaf = o.path.at(-1);
    if (o.conflict) {
      o.conflict.restepped = o.restepped;
      if (next.tick >= leaf.tick) this.#open = null;
      return;
    }
    const was = o.path[next.tick - o.path[0].tick];
    if (!was) return this.#close(); // past the old branch's end without leaving it
    if (was === next) {
      if (next === leaf) this.#close(); // back where it was: nothing changed
      return;
    }
    // The re-steps leave the old branch here: that is the conflict.
    o.conflict = { at: o.at, parent: h, abandoned: was, kept: next, leaf, ports: differ(was.row, row, this.#width), restepped: o.restepped };
    this.conflicts.push(o.conflict);
    if (next.tick >= leaf.tick) this.#open = null;
  }

  #rewind(tick) {
    // A rewind before the last one's re-steps left its branch compares with
    // that branch still: it is the furthest the old belief got.
    const o = this.#open;
    const leaf = o && !o.conflict ? o.path.at(-1) : this.head;
    this.#close();
    const to = ancestorAt(this.head, tick);
    if (!to) throw new Error(`a rewind to ${tick}, off the history's root`);
    const path = [];
    for (let n = leaf; n.tick > tick; n = n.parent) path.push(n);
    path.push(to);
    path.reverse();
    if (path[0] !== ancestorAt(leaf, tick)) throw new Error("a rewind off the branch the head is on");
    this.#open = { at: this.at, path, restepped: 0, conflict: null };
    this.head = to;
  }

  // The rewind being re-stepped ends; if its re-steps never left the branch
  // they came back to, it was idle.
  #close() {
    const o = this.#open;
    if (o && !o.conflict && o.restepped > 0) this.idle++;
    this.#open = null;
  }

  #confirmed(tick, snapshot) {
    const node = this.onPath(tick);
    if (node && tick - this.root.tick > this.#window) this.reroot(node, snapshot);
  }

  #frame({ frame, target, frontier }) {
    this.at = frame;
    this.target = target;
    this.frontier = frontier;
    if (this.head) this.head.shown++;
  }
}

const NONE = Object.freeze([]);

/** The ancestor of node (or node itself) at tick, or null. */
export function ancestorAt(node, tick) {
  let n = node;
  while (n && n.tick > tick) n = n.parent;
  return n && n.tick === tick ? n : null;
}

/** The nodes from the root to node. */
export function pathTo(node) {
  const out = [];
  for (let n = node; n; n = n.parent) out.push(n);
  return out.reverse();
}

export function rootOf(node) {
  let n = node;
  while (n.parent) n = n.parent;
  return n;
}

/** Every node of the abandoned side of a conflict, the leaf's path first. */
export function branch(conflict) {
  const out = [];
  const stack = [conflict.abandoned];
  while (stack.length) {
    const n = stack.pop();
    out.push(n);
    stack.push(...n.kids);
  }
  return out;
}

/** The ports whose bytes differ between two rows of `width`-byte inputs. */
export function differ(a, b, width = Infinity) {
  const out = [];
  const w = Math.min(width, a.length);
  for (let p = 0; p * w < a.length; p++)
    for (let i = p * w; i < (p + 1) * w; i++)
      if (a[i] !== b[i]) {
        out.push(p);
        break;
      }
  return out;
}

export function equal(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function count(root) {
  let n = 0;
  const stack = [root];
  while (stack.length) {
    const x = stack.pop();
    n++;
    for (const k of x.kids) stack.push(k);
  }
  return n;
}
