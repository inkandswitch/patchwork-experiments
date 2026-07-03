import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pixelsToRGBA, mountAudioFile, mountSpeaker } from "./media-nodes.js";

describe("pixelsToRGBA — normalise a raw pixel buffer to RGBA", () => {
  it("null/undefined → null", () => {
    expect(pixelsToRGBA(null)).toBe(null);
    expect(pixelsToRGBA(undefined)).toBe(null);
  });

  it("a byte RGBA array passes through with given dims", () => {
    const data = new Uint8ClampedArray([10, 20, 30, 40, 50, 60, 70, 80]); // 2 px
    const r = pixelsToRGBA(data, { width: 2, height: 1, channels: 4 });
    expect(r.width).toBe(2); expect(r.height).toBe(1);
    expect([...r.data]).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
  });

  it("grayscale (1 channel) fans out to r=g=b, opaque alpha", () => {
    const r = pixelsToRGBA(new Uint8Array([100, 200]), { width: 2, height: 1, channels: 1 });
    expect([...r.data]).toEqual([100, 100, 100, 255, 200, 200, 200, 255]);
  });

  it("3-channel RGB gets a full-opacity alpha added", () => {
    const r = pixelsToRGBA(new Uint8Array([1, 2, 3]), { width: 1, height: 1, channels: 3 });
    expect([...r.data]).toEqual([1, 2, 3, 255]);
  });

  it("float values in 0..1 scale by 255 (unit)", () => {
    const r = pixelsToRGBA(new Float32Array([0, 0.5, 1]), { width: 1, height: 1, channels: 3 });
    expect([...r.data]).toEqual([0, 128, 255, 255]); // Uint8ClampedArray rounds 127.5 → 128
  });

  it("float values outside 0..1 auto-stretch to the min–max range", () => {
    // values 10..20 over one gray pixel pair → min maps to 0, max to 255
    const r = pixelsToRGBA(new Float32Array([10, 20]), { width: 2, height: 1, channels: 1 });
    expect(r.data[0]).toBe(0);   // 10 → 0
    expect(r.data[4]).toBe(255); // 20 → 255
  });

  it("infers a square when dims are absent (RGBA)", () => {
    const r = pixelsToRGBA(new Uint8Array(2 * 2 * 4), { channels: 4 }); // 4 px → 2×2
    expect(r.width).toBe(2); expect(r.height).toBe(2);
  });

  it("{ data, width, height } object form carries its own dims", () => {
    const r = pixelsToRGBA({ data: new Uint8Array([5, 6, 7]), width: 1, height: 1, channels: 3 });
    expect([...r.data]).toEqual([5, 6, 7, 255]);
  });

  it("non-array junk → null", () => {
    expect(pixelsToRGBA({ nope: 1 })).toBe(null);
    expect(pixelsToRGBA(42)).toBe(null);
  });
});

describe("mountAudioFile — own/mine stream sharing", () => {
  beforeEach(() => { window.accountDocHandle = { doc: () => ({ contactUrl: "me" }) }; });
  afterEach(() => { delete window.accountDocHandle; });

  // a fake per-item ShareSession mesh (the `share` prop the mount receives)
  const fakeMesh = () => ({
    streams: [], onStreamCb: null, unshared: 0,
    stream(s) { this.streams.push(s); },
    unshare() { this.unshared++; },
    onStream(cb) { this.onStreamCb = cb; return () => { this.onStreamCb = null; }; },
  });

  it("own (default): local UI shown, checkbox unchecked, nothing shared", () => {
    const element = document.createElement("div");
    const mesh = fakeMesh();
    const cleanup = mountAudioFile({ element, setOutlet() {}, share: mesh });
    expect(element.querySelector('input[type="file"]').style.display).toBe("");
    expect(element.querySelector('input[type="checkbox"]').checked).toBe(false);
    expect(mesh.streams).toEqual([]);
    expect(mesh.onStreamCb).toBe(null); // never receiving in own mode
    cleanup();
  });

  it("toggling share persists {share:'mine', owner:me} and captures the element's stream; untoggling unshares", () => {
    const element = document.createElement("div");
    const mesh = fakeMesh();
    const cfgs = [];
    const cleanup = mountAudioFile({ element, setOutlet() {}, setConfig: (p) => cfgs.push(p), share: mesh });
    const fake = { fake: "stream" };
    element.querySelector("audio").captureStream = () => fake; // pre-graph captureStream fallback
    const cb = element.querySelector('input[type="checkbox"]');
    cb.checked = true; cb.onchange();
    expect(cfgs.at(-1)).toEqual({ share: "mine", owner: "me" }); // the toggle state persists
    expect(mesh.streams).toEqual([fake]);                        // owner shares the captured stream
    cb.checked = false; cb.onchange();
    expect(cfgs.at(-1)).toEqual({ share: "own", owner: null });
    expect(mesh.unshared).toBe(1);
    cleanup();
  });

  it("receiver (someone else owns): hides local UI, subscribes, plays the shared stream + pushes {shared:true}", () => {
    const element = document.createElement("div");
    const mesh = fakeMesh();
    let out;
    const cleanup = mountAudioFile({ element, setOutlet: (_n, s) => (out = s), config: { share: "mine", owner: "someone-else" }, share: mesh });
    expect(element.querySelector('input[type="file"]').style.display).toBe("none"); // receivers pick no file
    expect(typeof mesh.onStreamCb).toBe("function"); // subscribed to the owner's stream
    expect(mesh.streams).toEqual([]);                // a receiver never shares
    const before = element.querySelectorAll("audio").length;
    mesh.onStreamCb({ id: "remote" });
    expect(out.value).toEqual({ shared: true });
    expect(element.querySelectorAll("audio").length).toBe(before + 1); // playSharedStream's element
    cleanup();
  });

  it("onConfig flips the node live between own and receiving (and unsubscribes on the way back)", () => {
    const element = document.createElement("div");
    const mesh = fakeMesh();
    let onCfg;
    const cleanup = mountAudioFile({ element, setOutlet() {}, config: {}, onConfig: (cb) => (onCfg = cb), share: mesh });
    const file = element.querySelector('input[type="file"]');
    expect(file.style.display).toBe("");
    onCfg({ share: "mine", owner: "someone-else" }); // another viewer flips it to "mine"
    expect(file.style.display).toBe("none");
    expect(typeof mesh.onStreamCb).toBe("function");
    onCfg({ share: "own", owner: null });            // …and back
    expect(file.style.display).toBe("");
    expect(mesh.onStreamCb).toBe(null);              // receiver unsubscribed
    cleanup();
  });
});

describe("mountSpeaker — connects via its OWN gain; teardown never mutes the source", () => {
  const rig = () => {
    const destination = { the: "speakers" };
    const gain = { connect: vi.fn(), disconnect: vi.fn() };
    const analyser = { connect: vi.fn(), disconnect: vi.fn() };
    const audioContext = { destination, createGain: () => gain };
    const inlet = { complement: { analyser, audioContext }, connect(cb) { cb(); return () => {}; } };
    return { destination, gain, analyser, inlet };
  };

  it("routes analyser → gain → destination (never analyser → destination directly)", () => {
    const { destination, gain, analyser, inlet } = rig();
    const element = document.createElement("div");
    const cleanup = mountSpeaker({ element, inlets: { audio: inlet } });
    expect(analyser.connect).toHaveBeenCalledTimes(1);
    expect(analyser.connect).toHaveBeenCalledWith(gain);   // OUR gain, not the destination
    expect(gain.connect).toHaveBeenCalledWith(destination);
    cleanup();
  });

  it("teardown disconnects only its own edges — the source's analyser→destination survives", () => {
    const { destination, gain, analyser, inlet } = rig();
    const element = document.createElement("div");
    const cleanup = mountSpeaker({ element, inlets: { audio: inlet } });
    cleanup();
    expect(analyser.disconnect).toHaveBeenCalledTimes(1);
    expect(analyser.disconnect).toHaveBeenCalledWith(gain); // precise: only the analyser→gain edge
    expect(analyser.disconnect).not.toHaveBeenCalledWith(destination); // the audible dedup trap
    expect(gain.disconnect).toHaveBeenCalled();
  });

  it("never-connected (no analyser wired) teardown touches nothing", () => {
    const element = document.createElement("div");
    const inlet = { complement: {}, connect(cb) { cb(); return () => {}; } };
    const cleanup = mountSpeaker({ element, inlets: { audio: inlet } });
    expect(() => cleanup()).not.toThrow();
  });
});

describe("mountAudioFile — the share tap is disconnected on unshare (no tap pile-up)", () => {
  class FakeAC {
    constructor() { this.destination = { the: "speakers" }; this.state = "running"; }
    createMediaElementSource() { return { connect: vi.fn() }; }
    createAnalyser() { return { fftSize: 0, connect: vi.fn(), disconnect: vi.fn(), getFloatTimeDomainData: vi.fn() }; }
    createMediaStreamDestination() { return { stream: { id: "tap" } }; }
    resume() {}
    close() { return Promise.resolve(); }
  }
  beforeEach(() => {
    window.accountDocHandle = { doc: () => ({ contactUrl: "me" }) };
    window.AudioContext = FakeAC;
  });
  afterEach(() => { delete window.accountDocHandle; delete window.AudioContext; });

  const fakeMesh = () => ({
    streams: [], unshared: 0,
    stream(s) { this.streams.push(s); },
    unshare() { this.unshared++; },
    onStream() { return () => {}; },
  });

  it("stopShare disconnects the analyser tap; re-share taps afresh instead of accumulating", () => {
    const element = document.createElement("div");
    const mesh = fakeMesh();
    let out;
    const cleanup = mountAudioFile({ element, setOutlet: (_n, s) => (out = s), setConfig() {}, share: mesh });
    element.querySelector("audio").onplay(); // builds the web-audio graph (own mode: no share yet)
    const analyser = out.complement.analyser;
    expect(analyser.connect).toHaveBeenCalledTimes(1); // audible: analyser → destination

    const cb = element.querySelector('input[type="checkbox"]');
    cb.checked = true; cb.onchange(); // owner shares → tap via the analyser
    expect(mesh.streams.length).toBe(1);
    expect(analyser.connect).toHaveBeenCalledTimes(2);
    const tap = analyser.connect.mock.calls[1][0];

    cb.checked = false; cb.onchange(); // unshare must remove the tap edge
    expect(mesh.unshared).toBe(1);
    expect(analyser.disconnect).toHaveBeenCalledWith(tap);

    cb.checked = true; cb.onchange(); // re-share: a fresh tap, not a second edge on the old one
    expect(analyser.connect).toHaveBeenCalledTimes(3);
    expect(analyser.connect.mock.calls[2][0]).not.toBe(tap);
    cleanup();
  });
});

describe("mountAudioFile — object URL lifecycle", () => {
  it("revokes the previous object URL on re-pick, and the last one on disposal", () => {
    const revoked = [];
    const spyCreate = vi.spyOn(URL, "createObjectURL").mockImplementation((f) => `blob:${f.name}`);
    const spyRevoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation((u) => revoked.push(u));
    try {
      const element = document.createElement("div");
      const cleanup = mountAudioFile({ element, setOutlet() {} });
      const input = element.querySelector('input[type="file"]');
      Object.defineProperty(input, "files", { configurable: true, value: [{ name: "a.mp3" }] });
      input.onchange();
      expect(revoked).toEqual([]); // nothing to revoke yet
      Object.defineProperty(input, "files", { configurable: true, value: [{ name: "b.mp3" }] });
      input.onchange();
      expect(revoked).toEqual(["blob:a.mp3"]); // the previous pick's URL is released
      cleanup();
      expect(revoked).toEqual(["blob:a.mp3", "blob:b.mp3"]); // and the current one on disposal
    } finally {
      spyCreate.mockRestore();
      spyRevoke.mockRestore();
    }
  });
});
