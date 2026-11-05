// A tiny in-memory stand-in for an automerge Repo + DocHandle (copied from scene/src/test),
// enough for the slicer: doc(), change(), heads(), on/off("change"), broadcast.
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

export class FakeHandle {
  constructor(url, doc) {
    this.url = url;
    this._doc = structuredClone(doc);
    this._heads = [`h${++counter}`];
    this._listeners = new Map();
    this.broadcasts = [];
  }
  doc() {
    return this._doc;
  }
  heads() {
    return [...this._heads];
  }
  change(fn) {
    const draft = structuredClone(this._doc);
    fn(draft);
    this._doc = draft;
    this._heads = [`h${++counter}`];
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
