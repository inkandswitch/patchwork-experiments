// A copy (via sailing/probes) of scene/src/test/fake-repo.js (FakeHandle with view(heads), FakeRepo), for the probe pages: an
// in-memory stand-in for an automerge Repo + DocHandle (packages don't import each other).
let counter = 0;
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** A url that passes parseAutomergeUrl (base58-ish, 28 chars). */
export function fakeUrl() {
  let n = ++counter;
  let id = "";
  for (let i = 0; i < 28; i++) {
    id += B58[(n * 7919 + i * 104729 + ((n >> (i % 16)) & 31)) % 58];
  }
  return `automerge:${id}`;
}

/**
 * A head shaped like automerge-repo's (49 base58 characters), so a URL with
 * `#<head>` passes parseAutomergeLink. Not a real change hash.
 */
export function fakeHead() {
  let n = ++counter;
  let tail = "";
  do {
    tail = B58[n % 58] + tail;
    n = Math.floor(n / 58);
  } while (n > 0);
  return `H${"x".repeat(48 - tail.length)}${tail}`; // unique per call
}

/**
 * Patches from one plain value to another, shaped as Automerge's ({ action,
 * path }): a put or del at each key that differs, recursing into maps; a
 * list that differs is one put at each index that differs (and a del past
 * the new end). Enough for what reads a patch's path.
 */
export function diffPatches(a, b, path = []) {
  const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Uint8Array);
  if (Array.isArray(a) && Array.isArray(b)) {
    const out = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i >= b.length) out.push({ action: "del", path: [...path, i] });
      else if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) out.push({ action: "put", path: [...path, i], value: b[i] });
    }
    return out;
  }
  if (!isMap(a) || !isMap(b)) return JSON.stringify(a) === JSON.stringify(b) ? [] : [{ action: b === undefined ? "del" : "put", path, value: b }];
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(k in b)) out.push({ action: "del", path: [...path, k] });
    else if (!(k in a)) out.push({ action: "put", path: [...path, k], value: b[k] });
    else out.push(...diffPatches(a[k], b[k], [...path, k]));
  }
  return out;
}

export class FakeHandle {
  constructor(url, doc) {
    this.url = url;
    this._doc = structuredClone(doc);
    this._heads = [fakeHead()];
    this._history = new Map([[this._heads[0], structuredClone(this._doc)]]);
    this._listeners = new Map();
    this.broadcasts = [];
  }
  view(heads) {
    const hs = [...heads].map(String);
    const known = hs.length === 1 && this._history.has(hs[0]);
    return new FakeViewHandle(this, hs, known ? structuredClone(this._history.get(hs[0])) : {});
  }
  isReadOnly() {
    return false;
  }
  doc() {
    return this._doc;
  }
  /** As DocHandle.containsHeads: does this handle know every one of these changes? */
  containsHeads(heads) {
    return [...heads].every((h) => this._history.has(String(h)));
  }
  heads() {
    return [...this._heads];
  }
  change(fn, opts = {}) {
    const before = this._doc;
    const draft = structuredClone(this._doc);
    fn(draft);
    this._doc = draft;
    // like Automerge's: a change's patches, with the doc before and after (only when it changed something)
    if (typeof opts.patchCallback === "function") {
      const patches = diffPatches(before, draft);
      if (patches.length) opts.patchCallback(patches, { before, after: draft });
    }
    this._heads = [fakeHead()];
    this._history.set(this._heads[0], structuredClone(draft));
    this.emit("change", { handle: this, doc: this._doc });
  }
  on(ev, fn) {
    if (!this._listeners.has(ev)) this._listeners.set(ev, new Set());
    this._listeners.get(ev).add(fn);
  }
  off(ev, fn) {
    this._listeners.get(ev)?.delete(fn);
  }
  emit(ev, payload) {
    for (const fn of [...(this._listeners.get(ev) ?? [])]) fn(payload);
  }
  listenerCount(ev) {
    return this._listeners.get(ev)?.size ?? 0;
  }
  broadcast(message) {
    this.broadcasts.push(message);
  }
}

export class FakeViewHandle {
  constructor(parent, heads, doc) {
    this.parent = parent;
    this.url = `${parent.url}#${[...heads].sort().join("|")}`;
    this._heads = heads;
    this._doc = doc;
  }
  doc() {
    return this._doc;
  }
  heads() {
    return [...this._heads];
  }
  view(heads) {
    return this.parent.view(heads);
  }
  isReadOnly() {
    return true;
  }
  change() {
    throw new Error(`Cannot change on ${this.parent.url}: it is in view-only mode at specific heads.`);
  }
  on() {}
  off() {}
  broadcast() {}
}

export class FakeRepo {
  constructor() {
    this.handles = new Map();
    this.created = [];
  }
  add(doc, url = fakeUrl()) {
    const h = new FakeHandle(url, doc);
    this.handles.set(url, h);
    return h;
  }
  async create2(doc) {
    const h = this.add(doc);
    this.created.push(h);
    return h;
  }
  async find(url) {
    const h = this.handles.get(url);
    if (!h) throw new Error(`unavailable: ${url}`);
    return h;
  }
}

/** Manual timers so debounce is deterministic. */
export function fakeTimers() {
  let now = 0;
  let id = 0;
  const pending = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      pending.set(++id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(t) {
      pending.delete(t);
    },
    pendingDelays: () => [...pending.values()].map((p) => p.at - now),
    async advance(ms) {
      now += ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, p]) => p.at <= now).sort((a, b) => a[1].at - b[1].at);
        if (!due.length) break;
        const [tid, p] = due[0];
        pending.delete(tid);
        p.fn();
        await flush();
      }
      await flush();
    },
  };
}

export async function flush() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}
