// An in-memory stand-in for an automerge Repo and DocHandle, for the tests.
// A copy of probes/fake-repo.js (itself scene/src/test/fake-repo.js's), which
// also keeps each change's message, so a test can check who a write names.
// Beside the original it has what the task kit (src/task-client.js) calls:
// `create`, `flush`, a handle's `documentId` and `broadcast`, and `hear`,
// which delivers a message on a handle's channel as another peer's broadcast
// would arrive.
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
    this.documentId = url.replace(/^automerge:/, "");
    this._doc = structuredClone(doc);
    this._heads = [`h${++counter}`];
    this._listeners = new Map();
    /** Each change's message (null for none), in order. */
    this.messages = [];
  }
  doc() {
    return this._doc;
  }
  heads() {
    return [...this._heads];
  }
  change(fn, opts) {
    const draft = structuredClone(this._doc);
    fn(draft);
    this._doc = draft;
    this._heads = [`h${++counter}`];
    this.messages.push(opts?.message ?? null);
    this.emit("change", { handle: this, doc: this._doc });
  }
  on(ev, fn) {
    if (!this._listeners.has(ev)) this._listeners.set(ev, new Set());
    this._listeners.get(ev).add(fn);
  }
  off(ev, fn) {
    this._listeners.get(ev)?.delete(fn);
  }
  broadcast(message) {
    this.broadcasts ??= [];
    this.broadcasts.push(message);
  }
  emit(ev, payload) {
    for (const fn of [...(this._listeners.get(ev) ?? [])]) fn(payload);
  }
  hear(message) {
    this.emit("ephemeral-message", { message });
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
  create(doc) {
    const h = this.add(doc);
    this.created.push(h);
    return h;
  }
  async flush() {}
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
