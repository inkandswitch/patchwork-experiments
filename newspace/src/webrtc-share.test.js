import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { shareMyStream, receiveStream } from "./webrtc-share.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

// a minimal fake RTCPeerConnection that records the SDP dance
class FakePC {
  constructor() { this.tracks = []; this.local = null; this.remote = null; this.ice = []; this.closed = false; this.onicecandidate = null; this.ontrack = null; }
  addTrack(t, s) { this.tracks.push(t); }
  async createOffer() { return { type: "offer", sdp: "OFFER" }; }
  async createAnswer() { return { type: "answer", sdp: "ANSWER" }; }
  async setLocalDescription(d) { this.local = d; }
  async setRemoteDescription(d) {
    this.remote = d;
    // a receiver setting the owner's OFFER would then get tracks → fire ontrack
    if (d.type === "offer" && this.ontrack) this.ontrack({ streams: [{ id: "remote-stream" }] });
  }
  async addIceCandidate(c) { this.ice.push(c); }
  close() { this.closed = true; }
  get localDescription() { return this.local; }
}

// a shared ephemeral bus: broadcasting delivers to ALL subscribers (self-messages are
// filtered by `from` inside the module), mirroring the item-scoped channel.
function makeBus() {
  const subs = new Set();
  return {
    peer(myUrl) {
      return {
        broadcast: (msg) => { for (const s of [...subs]) s(msg); },
        onBroadcast: (cb) => { subs.add(cb); return () => subs.delete(cb); },
        myUrl,
      };
    },
  };
}

describe("webrtc-share signaling handshake", () => {
  beforeEach(() => { globalThis.RTCPeerConnection = FakePC; });
  afterEach(() => { delete globalThis.RTCPeerConnection; });

  it("owner offers, receiver answers, and the receiver gets the remote stream", async () => {
    const bus = makeBus();
    const ownerCh = bus.peer("owner");
    const recvCh = bus.peer("receiver");
    const sent = [];
    // tap the bus to observe the message types that flow
    const tap = recvCh.onBroadcast((m) => sent.push(m.rtc + (m.to ? "→" + m.to : "")));

    let gotStream = null;
    const stopRecv = receiveStream({ ...recvCh, onStream: (s) => { gotStream = s; } });
    const stopOwner = shareMyStream({ stream: { getTracks: () => ["video-track"] }, ...ownerCh });
    await flush(); await flush(); await flush();

    // the dance: request → offer(→receiver) → answer(→owner)
    expect(sent).toContain("request");
    expect(sent).toContain("offer→receiver");
    expect(sent).toContain("answer→owner");
    // the receiver received the owner's stream via ontrack
    expect(gotStream).toEqual({ id: "remote-stream" });

    tap(); stopRecv(); stopOwner();
  });

  it("no RTCPeerConnection → no-ops gracefully (returns a stop fn)", () => {
    delete globalThis.RTCPeerConnection;
    const bus = makeBus();
    const stop = shareMyStream({ stream: { getTracks: () => [] }, ...bus.peer("o") });
    expect(typeof stop).toBe("function");
    stop();
  });
});
