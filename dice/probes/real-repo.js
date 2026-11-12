// Two peers, for the probe page: each has its OWN replica of every document
// (real Automerge docs), and a change made in one reaches the other only when
// the link delivers it, a little later, by a real Automerge merge. The link
// can be held (nothing gets across: the two peers act at the same moment,
// neither having heard the other) and released (everything held arrives).
// Broadcasts (presence, poses, sends) go the same way.
//
// A handle here is what the stage and the bag use of a DocHandle: url, doc(),
// heads(), change(fn), on/off("change" | "ephemeral-message"), broadcast.
import * as Automerge from "@automerge/automerge";

let counter = 0;
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** A url that passes parseAutomergeUrl (base58-ish, 28 chars). */
function fakeUrl() {
  const n = ++counter;
  let id = "";
  for (let i = 0; i < 28; i++) id += B58[(n * 7919 + i * 104729 + ((n >> (i % 16)) & 31)) % 58];
  return `automerge:${id}`;
}

class Handle {
  constructor(url, doc, peer) {
    this.url = url;
    this._doc = doc;
    this.peer = peer;
    this._listeners = new Map();
  }
  doc() {
    return this._doc;
  }
  heads() {
    return Automerge.getHeads(this._doc);
  }
  change(fn) {
    this._doc = Automerge.change(this._doc, fn);
    this.emit("change", { handle: this, doc: this._doc });
    this.peer.net.changed(this);
  }
  /** The other peer's replica arrives: a real merge. */
  receive(remote) {
    const before = this.heads().join();
    this._doc = Automerge.merge(this._doc, Automerge.clone(remote));
    if (this.heads().join() !== before) this.emit("change", { handle: this, doc: this._doc });
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
  broadcast(message) {
    this.peer.net.broadcast(this, message);
  }
}

class Repo {
  constructor(name, net) {
    this.name = name;
    this.net = net;
    this.handles = new Map();
  }
  /** A new document: this peer's replica, and the other's (as if it had synced before anyone looked). */
  async create2(doc) {
    return this.net.create(this, doc);
  }
  async find(url) {
    const h = this.handles.get(String(url).split("#")[0]);
    if (!h) throw new Error(`unavailable: ${url}`);
    return h;
  }
}

/**
 * @param {{ delay?: number }} [o]  how long a change takes to reach the other peer (ms)
 * @returns {{ a: Repo, b: Repo, hold(): void, release(): void, held(): boolean, stats: object }}
 */
export function twoPeers({ delay = 25 } = {}) {
  let held = false;
  const dirty = new Set(); // handles with changes the other hasn't had
  const waiting = []; // broadcasts held back
  const stats = { merges: 0, heldMerges: 0, broadcasts: 0 };
  const net = {
    create(repo, doc) {
      const url = fakeUrl();
      const base = Automerge.from(doc);
      for (const r of [a, b]) r.handles.set(url, new Handle(url, Automerge.clone(base), r));
      return repo.handles.get(url);
    },
    changed(handle) {
      if (held) return void dirty.add(handle);
      setTimeout(() => (held ? dirty.add(handle) : deliver(handle)), delay);
    },
    broadcast(handle, message) {
      const send = () => {
        stats.broadcasts++;
        twin(handle).emit("ephemeral-message", { message, senderId: handle.peer.name });
      };
      if (held) waiting.push(send);
      else setTimeout(() => (held ? waiting.push(send) : send()), 5);
    },
  };
  const a = new Repo("a", net);
  const b = new Repo("b", net);
  const twin = (handle) => (handle.peer === a ? b : a).handles.get(handle.url);
  function deliver(handle) {
    stats.merges++;
    twin(handle).receive(handle.doc());
  }
  return {
    a,
    b,
    stats,
    held: () => held,
    hold() {
      held = true;
    },
    release() {
      held = false;
      const docs = [...dirty];
      dirty.clear();
      stats.heldMerges += docs.length;
      for (const h of docs) deliver(h);
      for (const send of waiting.splice(0)) send();
    },
  };
}
