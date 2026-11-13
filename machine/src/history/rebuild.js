// Rebuilds any state in a history (history.js) on an engine of its own: the
// nearest state it has (its own position, a cached snapshot, or the root's),
// then the rows on the path from there stepped in order. Exact, because an
// engine is deterministic and its state is all in its memory; this engine is
// never the live one, so looking costs the game nothing.

export class Rebuilder {
  #machine;
  #content;
  #engine = null;
  #here = null; // the node the engine is at, if any
  #cache = new Map(); // node -> snapshot, least recently used first
  #keep;
  #every;

  /**
   * @param machine  compile(wasm)
   * @param content  what it boots
   * @param o.keep   snapshots kept (most recently used)
   * @param o.every  on the way to a node, keep the state at ticks that are
   *                 multiples of this, so the next look nearby is short
   */
  constructor(machine, content, { keep = 24, every = 64 } = {}) {
    this.#machine = machine;
    this.#content = content;
    this.#keep = keep;
    this.#every = every;
  }

  /** Steps taken by all the rebuilding so far. */
  steps = 0;

  /** The engine, in node's state. Use it (frame, query, hash, snapshot) before the next call. */
  at(node) {
    const engine = (this.#engine ??= this.#machine.boot(this.#content));
    const chain = [];
    let n = node;
    while (n !== this.#here && !this.#cache.has(n) && n.parent) {
      chain.push(n);
      n = n.parent;
    }
    if (n !== this.#here) {
      const snap = this.#cache.get(n) ?? n.snapshot;
      if (!snap) throw new Error(`no state to rebuild tick ${node.tick} from`);
      engine.restore(snap);
      this.#use(n, snap);
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      const k = chain[i];
      engine.step(k.row);
      this.steps++;
      if (k.tick % this.#every === 0 || i === 0) this.#use(k, null);
    }
    this.#here = node;
    return engine;
  }

  /** A copy of node's state. */
  snapshot(node) {
    const s = this.#cache.get(node);
    return s ? s.slice() : this.at(node).snapshot();
  }

  // Marks a snapshot as just used (taking one of the engine if snap is null).
  #use(node, snap) {
    snap ??= this.#cache.get(node) ?? this.#engine.snapshot();
    this.#cache.delete(node);
    this.#cache.set(node, snap);
    while (this.#cache.size > this.#keep) this.#cache.delete(this.#cache.keys().next().value);
  }
}
