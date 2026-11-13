// An in-memory network for automerge-repo peers, for tests and probes. Every
// peer is linked to every other, or, with a hub, only to the hub (as Patchwork
// peers are to a sync server). A link delivers in order (as a WebSocket
// does), each message after a latency taken from a fixed table, cycling;
// ephemeral messages can also be dropped by a fixed pattern, cycling. Nothing
// is random, so with fake timers a run is the same every time. Document sync
// is never dropped: the real transports are reliable, and Automerge's sync
// protocol stalls on a lossy link (the rollback experiment's finding).
import { NetworkAdapter } from "@automerge/automerge-repo";

export class SimNet {
  #adapters = new Map(); // name -> SimAdapter
  #links = new Map(); // "a>b" -> { n, last }
  latency;
  loss;
  hub;
  sent = { sync: 0, ephemeral: 0, dropped: 0 };
  /** Per peer name: messages and ephemeral bytes it sent and received. */
  by = new Map();

  /**
   * @param latency ms per message, a table cycled per link (or a number)
   * @param loss    for ephemeral messages, a table of booleans cycled per link
   * @param hub     a peer name: if given, every other peer is linked to it alone
   */
  constructor({ latency = [10], loss = [false], hub = null } = {}) {
    this.latency = [].concat(latency);
    this.loss = [].concat(loss);
    this.hub = hub;
  }

  #count(name) {
    let c = this.by.get(name);
    if (!c) this.by.set(name, (c = { sync: 0, ephemeral: 0, bytes: 0, received: 0, receivedBytes: 0 }));
    return c;
  }

  /** A network adapter for one peer; pass it to new Repo({ network: [...] }). */
  adapter(name) {
    const a = new SimAdapter(this, name);
    this.#adapters.set(name, a);
    return a;
  }

  /** Cuts a peer off: its links go, and the others see it leave. */
  remove(name) {
    const a = this.#adapters.get(name);
    if (!a) return;
    this.#adapters.delete(name);
    for (const other of this.#adapters.values()) {
      if (other.peerId && a.peerId) other.emit("peer-disconnected", { peerId: a.peerId });
    }
    a.gone = true;
  }

  _connected(a) {
    for (const b of this.#adapters.values()) {
      if (b === a || !b.peerId) continue;
      if (this.hub && a.name !== this.hub && b.name !== this.hub) continue;
      b.emit("peer-candidate", { peerId: a.peerId, peerMetadata: a.peerMetadata });
      a.emit("peer-candidate", { peerId: b.peerId, peerMetadata: b.peerMetadata });
    }
  }

  _send(from, message) {
    const to = [...this.#adapters.values()].find((b) => b.peerId === message.targetId);
    if (!to || from.gone) return;
    const key = `${from.peerId}>${to.peerId}`;
    const link = this.#links.get(key) ?? { n: 0, last: 0 };
    this.#links.set(key, link);
    const i = link.n++;
    const ephemeral = message.type === "ephemeral";
    this.sent[ephemeral ? "ephemeral" : "sync"]++;
    const bytes = ephemeral ? (message.data?.byteLength ?? 0) : 0;
    const out = this.#count(from.name);
    out[ephemeral ? "ephemeral" : "sync"]++;
    out.bytes += bytes;
    if (ephemeral && this.loss[i % this.loss.length]) return void this.sent.dropped++;
    if (ephemeral) {
      const into = this.#count(to.name);
      into.received++;
      into.receivedBytes += bytes;
    }
    const at = Math.max(link.last, Date.now() + this.latency[i % this.latency.length]);
    link.last = at;
    setTimeout(() => {
      if (!to.gone && !from.gone) to.emit("message", message);
    }, at - Date.now());
  }
}

class SimAdapter extends NetworkAdapter {
  #net;
  gone = false;

  constructor(net, name) {
    super();
    this.#net = net;
    this.name = name;
  }
  isReady() {
    return true;
  }
  whenReady() {
    return Promise.resolve();
  }
  connect(peerId, peerMetadata) {
    this.peerId = peerId;
    this.peerMetadata = peerMetadata;
    this.#net._connected(this);
  }
  send(message) {
    this.#net._send(this, message);
  }
  disconnect() {
    this.#net.remove(this.name);
  }
}
