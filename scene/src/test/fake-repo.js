// A tiny in-memory stand-in for an automerge Repo + DocHandle, enough for the
// scene's logic: doc(), change(), heads(), on/off("change"), broadcast, and
// view(heads), modelled on automerge-repo's DocHandle.view: a read-only handle
// whose doc() is the doc at those heads, whose heads() are those heads, whose
// url carries `#heads`, and which emits no "change". Like the real one, a view
// at heads this handle doesn't know gives an empty doc rather than throwing.
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
  /** As Automerge.hasHeads on the doc: does this handle know every one of these changes? */
  hasHeads(heads) {
    return [...heads].every((h) => this._history.has(String(h)));
  }
  heads() {
    return [...this._heads];
  }
  change(fn) {
    const draft = structuredClone(this._doc);
    fn(draft);
    this._doc = draft;
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
