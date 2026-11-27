import { describe, it, expect } from "vitest";
import { cuts, putBytes, getBytes, isRef, inlineBytes, externalize, internalize, serverWatch, freshPeer, sha256, SEGMENT_TYPE, SEGMENT_BYTES, INLINE_BYTES } from "./segments.js";

/** Docs by url; create2 copies (as a repo would), find returns them. */
function memRepo() {
  const docs = new Map();
  let n = 0;
  const listeners = new Set();
  const resynced = [];
  return {
    docs,
    resynced,
    async create2(v) {
      const id = `d${++n}`;
      const url = `automerge:${id}`;
      const doc = structuredClone(v);
      const h = { url, documentId: id, doc: () => doc, heads: () => [`${id}-h`] };
      docs.set(url, h);
      return h;
    },
    async find(url) {
      const h = docs.get(url);
      if (!h) throw new Error(`${url} unavailable`);
      return h;
    },
    on: (ev, fn) => ev === "subduction-remote-heads" && listeners.add(fn),
    off: (ev, fn) => listeners.delete(fn),
    resyncSubduction: (id) => resynced.push(id),
    serverHas: (h) => listeners.forEach((fn) => fn({ documentId: h.documentId, heads: h.heads() })),
  };
}
const findNow = async (repo, url) => repo.find(url);
const bytes = (n, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed * 7) & 255);

describe("cuts", () => {
  it("covers every byte once, in order, none bigger than a segment", () => {
    for (const size of [0, 1, 9, 10, 11, 25, 100]) {
      const c = cuts(size, 10);
      expect(c[0][0]).toBe(0);
      expect(c.at(-1)[1]).toBe(size);
      for (let i = 1; i < c.length; i++) expect(c[i][0]).toBe(c[i - 1][1]);
      for (const [a, b] of c) expect(b - a).toBeLessThanOrEqual(10);
      expect(c.length).toBe(Math.max(1, Math.ceil(size / 10)));
    }
  });
});

describe("putBytes / getBytes", () => {
  it("round-trips, in segments no bigger than asked", async () => {
    for (const size of [0, 1, 999, 1000, 1001, 4321]) {
      const repo = memRepo();
      const b = bytes(size, size);
      const { ref, handles } = await putBytes(repo, b, { segmentBytes: 1000 });
      expect(isRef(ref)).toBe(true);
      expect(ref.size).toBe(size);
      expect(handles.length).toBe(Math.max(1, Math.ceil(size / 1000)));
      for (const h of handles) {
        expect(h.doc()["@patchwork"].type).toBe(SEGMENT_TYPE);
        expect(h.doc().data.byteLength).toBeLessThanOrEqual(1000);
      }
      expect(await getBytes(repo, ref, { find: findNow })).toEqual(b);
    }
  });
  it("passes inline bytes through, and null as null", async () => {
    const b = bytes(10);
    expect(await getBytes(memRepo(), b)).toBe(b);
    expect(await getBytes(memRepo(), null)).toBe(null);
  });
  it("refuses segments that were tampered with, reordered or cut short", async () => {
    const repo = memRepo();
    const { ref } = await putBytes(repo, bytes(2500), { segmentBytes: 1000 });
    const [a, b] = ref["@segments"];
    await expect(getBytes(repo, { ...ref, "@segments": [b, a, ref["@segments"][2]] }, { find: findNow })).rejects.toThrow(/segment 1 of 3/);
    await expect(getBytes(repo, { ...ref, "@segments": ref["@segments"].slice(0, 2) }, { find: findNow })).rejects.toThrow();
    repo.docs.get(a).doc().data[0] ^= 1;
    await expect(getBytes(repo, ref, { find: findNow })).rejects.toThrow(/digest/);
  });
  it("defaults to segments of 4 MB", () => expect(SEGMENT_BYTES).toBe(4 * 1024 * 1024));
  it("digests as sha-256", async () => expect(await sha256(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
});

describe("externalize / internalize", () => {
  const doc = () => ({ name: "wake", positions: bytes(INLINE_BYTES * 3, 2), fields: { p: bytes(INLINE_BYTES * 2, 3), tiny: bytes(16, 4) }, list: [bytes(INLINE_BYTES, 5)], n: 3 });
  it("leaves a doc whose bytes fit alone", async () => {
    const repo = memRepo();
    const d = doc();
    const { value, handles } = await externalize(repo, d, { budget: inlineBytes(d) });
    expect(value).toBe(d);
    expect(handles).toEqual([]);
  });
  it("moves every big array out when they don't fit, keeps small ones, and reads back the same", async () => {
    const repo = memRepo();
    const d = doc();
    const { value, handles } = await externalize(repo, d, { budget: INLINE_BYTES, segmentBytes: INLINE_BYTES });
    expect(isRef(value.positions) && isRef(value.fields.p) && isRef(value.list[0])).toBe(true);
    expect(value.fields.tiny).toBe(d.fields.tiny);
    expect(inlineBytes(value)).toBe(16);
    expect(handles.length).toBe(3 + 2 + 1);
    expect(await internalize(repo, value, { find: findNow })).toEqual(d);
  });
});

describe("serverWatch", () => {
  it("resolves when the server has every doc, even ones it acknowledged before anyone asked", async () => {
    const repo = memRepo();
    const watch = serverWatch(repo);
    const { handles } = await putBytes(repo, bytes(3000), { segmentBytes: 1000 });
    repo.serverHas(handles[0]);
    const p = watch.wait(handles, { timeoutMs: 1000 });
    repo.serverHas(handles[1]);
    repo.serverHas(handles[2]);
    expect(await p).toEqual({ ok: true, missing: [], verified: 0 });
  });
  it("names what never arrived, after asking for it again", async () => {
    const repo = memRepo();
    const watch = serverWatch(repo);
    const { handles } = await putBytes(repo, bytes(2000), { segmentBytes: 1000 });
    repo.serverHas(handles[0]);
    const r = await watch.wait(handles, { timeoutMs: 60, resyncEveryMs: 20 });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([handles[1].url]);
    expect(repo.resynced).toContain(handles[1].documentId);
    expect(repo.resynced).not.toContain(handles[0].documentId);
  });
  it("counts a doc a fresh peer fetches as there, though the server never acknowledged it", async () => {
    const repo = memRepo();
    const watch = serverWatch(repo);
    const { handles } = await putBytes(repo, bytes(3000), { segmentBytes: 1000 });
    repo.serverHas(handles[0]);
    // the peer sees what `repo` holds, except the last segment
    const peer = { find: async (u) => (u === handles[2].url ? Promise.reject(new Error("unavailable")) : repo.find(u)) };
    const checker = freshPeer(() => peer, { find: findNow, tries: 1 });
    const r = await watch.wait(handles, { timeoutMs: 80, ackMs: 20, resyncEveryMs: 10, verify: checker.verify });
    expect(r).toEqual({ ok: false, missing: [handles[2].url], verified: 1 });
    expect(watch.has(handles[1])).toBe(true);
  });
  it("can't tell with a repo that doesn't report the server's heads", async () => {
    const watch = serverWatch({ create2: async () => ({}) });
    expect(watch.available).toBe(false);
    expect(await watch.wait([{}])).toEqual({ ok: null, missing: [], verified: 0 });
  });
});
