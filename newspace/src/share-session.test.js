import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ShareSession } from "./share-session.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

// a minimal fake RTCPeerConnection — just enough state machine for the session's
// signaling, eviction, and track plumbing
class FakePC {
  constructor() {
    this.connectionState = "new";
    this.signalingState = "stable";
    this.closed = false;
    this.senders = [];
    this.localDescription = null;
    this.remoteDescription = null;
    this.iceAdded = [];
    this.onconnectionstatechange = null;
    this.oniceconnectionstatechange = null;
    this.ondatachannel = null;
    this.ontrack = null;
    this.onicecandidate = null;
    this.onnegotiationneeded = null;
  }
  createDataChannel(label) { return { label, readyState: "open", sent: [], send(m) { this.sent.push(m); } }; }
  addTrack(track) { const s = { track }; this.senders.push(s); return s; }
  getSenders() { return this.senders; }
  removeTrack(sender) { this.senders = this.senders.filter((s) => s !== sender); }
  async setLocalDescription(d) {
    const type = d ? d.type : this.signalingState === "have-remote-offer" ? "answer" : "offer";
    this.localDescription = { type, sdp: "fake", toJSON() { return { type: this.type, sdp: this.sdp }; } };
    this.signalingState = type === "offer" ? "have-local-offer" : "stable";
  }
  async setRemoteDescription(d) {
    if (this.signalingState === "closed") throw new Error("pc is closed");
    this.remoteDescription = d;
    this.signalingState = d.type === "offer" ? "have-remote-offer" : "stable";
  }
  async addIceCandidate(c) { this.iceAdded.push(c); }
  close() { this.closed = true; this.signalingState = "closed"; this.connectionState = "closed"; }
}

class FakeMediaStream {
  constructor() { this._tracks = []; }
  addTrack(t) { this._tracks.push(t); }
  removeTrack(t) { this._tracks = this._tracks.filter((x) => x !== t); }
  getTracks() { return [...this._tracks]; }
  getTrackById(id) { return this._tracks.find((t) => t.id === id) || null; }
}

// a fake folder handle: broadcast records, on() captures the ephemeral handler
function makeSession(myUrl = "me") {
  const sent = [];
  let handler = null;
  const handle = {
    broadcast: (m) => sent.push(m),
    on: (ev, cb) => { if (ev === "ephemeral-message") handler = cb; },
    off: () => { handler = null; },
  };
  const session = new ShareSession(handle, myUrl);
  const deliver = (m) => handler({ message: m }); // join is handled synchronously
  const deliverAsync = async (m) => { handler({ message: m }); await flush(); };
  return { session, deliver, deliverAsync, sent };
}

describe("ShareSession — eviction + reconnect", () => {
  let sessions;
  beforeEach(() => {
    sessions = [];
    globalThis.RTCPeerConnection = FakePC;
    globalThis.MediaStream = FakeMediaStream;
  });
  afterEach(() => {
    for (const s of sessions) s.destroy();
    delete globalThis.RTCPeerConnection;
    delete globalThis.MediaStream;
  });
  const track = (s) => (sessions.push(s.session), s);

  it("evicts a failed pc and builds a FRESH one on the peer's next join", () => {
    const { session, deliver } = track(makeSession());
    deliver({ ns: "share", t: "join", from: "zz-peer" });
    const pr1 = session.peers.get("zz-peer");
    expect(pr1).toBeTruthy();
    pr1.pc.connectionState = "failed";
    pr1.pc.onconnectionstatechange();
    expect(session.peers.has("zz-peer")).toBe(false); // zombie gone
    expect(pr1.pc.closed).toBe(true);
    // the reloaded peer's heartbeat join reconnects with a new pc
    deliver({ ns: "share", t: "join", from: "zz-peer" });
    const pr2 = session.peers.get("zz-peer");
    expect(pr2).toBeTruthy();
    expect(pr2.pc).not.toBe(pr1.pc);
  });

  it("an offer arriving for a dead pc tears it down and answers on a fresh one", async () => {
    const { session, deliver, deliverAsync, sent } = track(makeSession());
    deliver({ ns: "share", t: "join", from: "zz-peer" });
    const pr1 = session.peers.get("zz-peer");
    pr1.pc.signalingState = "closed"; // died mid-signal, not yet evicted
    await deliverAsync({ ns: "share", t: "offer", from: "zz-peer", to: "me", sdp: { type: "offer", sdp: "x" } });
    const pr2 = session.peers.get("zz-peer");
    expect(pr1.pc.closed).toBe(true);
    expect(pr2.pc).not.toBe(pr1.pc);
    expect(pr2.pc.remoteDescription && pr2.pc.remoteDescription.type).toBe("offer");
    expect(sent.some((m) => m.t === "answer" && m.to === "zz-peer")).toBe(true);
  });

  it("a long disconnect evicts; a recovered one doesn't", () => {
    const { session, deliver } = track(makeSession());
    deliver({ ns: "share", t: "join", from: "zz-peer" });
    const pr = session.peers.get("zz-peer");
    vi.useFakeTimers();
    try {
      // recovers → the grace timer is cancelled
      pr.pc.connectionState = "disconnected"; pr.pc.onconnectionstatechange();
      pr.pc.connectionState = "connected"; pr.pc.onconnectionstatechange();
      vi.advanceTimersByTime(10000);
      expect(session.peers.has("zz-peer")).toBe(true);
      // stays disconnected → evicted after the grace period
      pr.pc.connectionState = "disconnected"; pr.pc.onconnectionstatechange();
      expect(session.peers.has("zz-peer")).toBe(true); // still in grace
      vi.advanceTimersByTime(10000);
      expect(session.peers.has("zz-peer")).toBe(false);
      expect(pr.pc.closed).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});

describe("ShareSession — per-item streams", () => {
  let sessions;
  beforeEach(() => {
    sessions = [];
    globalThis.RTCPeerConnection = FakePC;
    globalThis.MediaStream = FakeMediaStream;
  });
  afterEach(() => {
    for (const s of sessions) s.destroy();
    delete globalThis.RTCPeerConnection;
    delete globalThis.MediaStream;
  });
  const track = (s) => (sessions.push(s.session), s);
  const dcMsg = (pr, m) => pr.dc.onmessage({ data: JSON.stringify(m) });

  it("routes each item's tracks to its OWN stream (no conflation across items)", () => {
    const { session, deliver } = track(makeSession());
    deliver({ ns: "share", t: "join", from: "zz-peer" });
    const pr = session.peers.get("zz-peer");
    const a = [], b = [];
    session.onStream("A", (s) => a.push(s));
    session.onStream("B", (s) => b.push(s));
    dcMsg(pr, { t: "map", item: "A", trackIds: ["t1"] });
    dcMsg(pr, { t: "map", item: "B", trackIds: ["t2"] });
    pr.pc.ontrack({ track: { id: "t1" } });
    pr.pc.ontrack({ track: { id: "t2" } });
    expect(a.at(-1).getTracks().map((t) => t.id)).toEqual(["t1"]);
    expect(b.at(-1).getTracks().map((t) => t.id)).toEqual(["t2"]);
    expect(a.at(-1)).not.toBe(b.at(-1)); // two shares from one peer ⇒ two streams
    // a LATE subscriber gets the per-item stream too
    let late = null;
    session.onStream("B", (s) => (late = s));
    expect(late && late.getTracks().map((t) => t.id)).toEqual(["t2"]);
  });

  it("an unmap message drops the mapping and delivers null (clears the frozen frame)", () => {
    const { session, deliver } = track(makeSession());
    deliver({ ns: "share", t: "join", from: "zz-peer" });
    const pr = session.peers.get("zz-peer");
    const a = [];
    session.onStream("A", (s) => a.push(s));
    dcMsg(pr, { t: "map", item: "A", trackIds: ["t1"] });
    pr.pc.ontrack({ track: { id: "t1" } });
    expect(a.at(-1).getTracks().length).toBe(1);
    dcMsg(pr, { t: "unmap", item: "A" });
    expect(a.at(-1)).toBe(null);
    expect(pr.trackMap.has("t1")).toBe(false);
    expect(pr.itemStreams.has("A")).toBe(false);
  });

  it("unshare removes the senders AND tells receivers over the data channel", () => {
    const { session, deliver } = track(makeSession());
    deliver({ ns: "share", t: "join", from: "zz-peer" });
    const pr = session.peers.get("zz-peer"); // "me" < "zz-peer" ⇒ polite ⇒ dc exists
    const stream = new FakeMediaStream();
    stream.addTrack({ id: "lt1" });
    session.shareStream("A", stream);
    expect(pr.pc.getSenders().length).toBe(1);
    session.unshare("A");
    expect(pr.pc.getSenders().length).toBe(0);
    const msgs = pr.dc.sent.map((m) => JSON.parse(m));
    expect(msgs.some((m) => m.t === "unmap" && m.item === "A")).toBe(true);
  });
});
