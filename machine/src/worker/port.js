// An automerge-repo network adapter over a MessagePort (or anything with
// postMessage and addEventListener("message")): two repos, one at each end,
// as peers. It is how a worker's repo reaches the page's, the same way
// Patchwork's tab repo reaches its shared worker. Messages are copied by
// structured clone; nothing is transferred, since a repo may keep what it
// sends.
import { NetworkAdapter } from "@automerge/automerge-repo";

export class PortAdapter extends NetworkAdapter {
  #port;
  #remote = null;
  #ready;
  #resolve;

  constructor(port) {
    super();
    this.#port = port;
    this.#ready = new Promise((r) => (this.#resolve = r));
  }

  isReady() {
    return this.#remote !== null;
  }

  whenReady() {
    return this.#ready;
  }

  connect(peerId, peerMetadata) {
    this.peerId = peerId;
    this.peerMetadata = peerMetadata;
    this.#port.addEventListener("message", this.#receive);
    this.#port.start?.();
    this.#port.postMessage({ type: "arrive", senderId: peerId, peerMetadata });
  }

  send(message) {
    this.#port.postMessage(message);
  }

  disconnect() {
    this.#port.postMessage({ type: "leave", senderId: this.peerId });
    this.#port.removeEventListener("message", this.#receive);
    this.#gone();
  }

  // Either end may arrive first: each answers an arrival with a welcome,
  // and announces the other once, on whichever it hears first.
  #receive = ({ data: m }) => {
    if (m.type === "arrive" || m.type === "welcome") {
      if (m.type === "arrive") this.#port.postMessage({ type: "welcome", senderId: this.peerId, peerMetadata: this.peerMetadata });
      if (this.#remote === m.senderId) return;
      this.#remote = m.senderId;
      this.#resolve();
      this.emit("peer-candidate", { peerId: m.senderId, peerMetadata: m.peerMetadata });
    } else if (m.type === "leave") this.#gone();
    else this.emit("message", m);
  };

  #gone() {
    if (this.#remote) this.emit("peer-disconnected", { peerId: this.#remote });
    this.#remote = null;
    this.emit("close");
  }
}
