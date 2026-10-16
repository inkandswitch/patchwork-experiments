import { describe, it, expect } from "vitest";
import { debounceFor, decide, sourceKeyFor, staleReason } from "./staleness.js";
import { currentSourceKey } from "./source.js";
import { renderKey } from "./render-read.js";
import { normalizeJob } from "./datatype.js";
import { settingsKey } from "./settings.js";
import { fileDoc, renderDoc } from "./test/models.js";

const SRC = "automerge:2j9mK3vG7pQx4TzR8wYbN5cD6eF1";
const GLB1 = "automerge:3k8nL4wH8qRy5UaS9xZcP6dE7fG2";
const GLB2 = "automerge:4m7pM5xJ9rSz6VbT1yAdQ7eF8gH3";

const job = (o = {}) => normalizeJob({ source: SRC, auto: true, ...o });
const now = (o = {}) => ({ sourceState: "ok", sourceKey: sourceKeyFor(SRC, renderKey({ glbUrl: GLB1 })), settingsKey: settingsKey({}), ...o });
const built = (n = now()) => ({ sourceKey: n.sourceKey, settingsKey: n.settingsKey });

describe("staleReason", () => {
  it("never sliced, source, settings, or fresh", () => {
    expect(staleReason(null, now())).toBe("never-sliced");
    expect(staleReason(built(), now())).toBe(null);
    expect(staleReason(built(), now({ sourceKey: "other" }))).toBe("source");
    expect(staleReason(built(), now({ settingsKey: settingsKey({ layerHeight: 0.1 }) }))).toBe("settings");
  });
});

describe("decide", () => {
  it("fresh after a slice of exactly these inputs; survives reload (it's all in the doc)", () => {
    expect(decide(job({ builtFrom: built() }), now())).toEqual({ state: "fresh", slice: false });
  });

  it("re-slices by itself only when auto is on", () => {
    expect(decide(job({ builtFrom: built() }), now({ sourceKey: "x" }))).toMatchObject({ state: "stale", reason: "source", slice: true });
    expect(decide(job({ auto: false, builtFrom: built() }), now({ sourceKey: "x" }))).toMatchObject({ state: "stale", reason: "source", slice: false });
  });

  it("a new GLB on the render is a source change; a rename or status write is not", async () => {
    const r1 = renderDoc({ title: "Hull", glbUrl: GLB1 });
    const k1 = await currentSourceKey(SRC, r1);
    expect(k1).toEqual({ sourceState: "ok", sourceKey: now().sourceKey });
    const renamed = await currentSourceKey(SRC, { ...r1, title: "Hull v2", status: "building" });
    expect(renamed.sourceKey).toBe(k1.sourceKey);
    const rebuilt = await currentSourceKey(SRC, { ...r1, glbUrl: GLB2 });
    expect(rebuilt.sourceKey).not.toBe(k1.sourceKey);
    expect(decide(job({ builtFrom: built() }), now({ sourceKey: rebuilt.sourceKey })).reason).toBe("source");
  });

  it("a file's key is its content: renaming the file keeps it, new bytes change it", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const a = await currentSourceKey(SRC, fileDoc("part.stl", bytes));
    const renamed = await currentSourceKey(SRC, fileDoc("renamed.stl", bytes));
    const edited = await currentSourceKey(SRC, fileDoc("part.stl", new Uint8Array([1, 2, 3, 5])));
    expect(renamed.sourceKey).toBe(a.sourceKey);
    expect(edited.sourceKey).not.toBe(a.sourceKey);
  });

  it("re-pointing the job at another doc is a source change, even with identical bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const a = await currentSourceKey(SRC, fileDoc("a.stl", bytes));
    const b = await currentSourceKey(GLB1, fileDoc("a.stl", bytes));
    expect(a.sourceKey).not.toBe(b.sourceKey);
  });

  it("an unbuilt render waits rather than failing", async () => {
    const k = await currentSourceKey(SRC, renderDoc({ glbUrl: null }));
    expect(k.sourceState).toBe("unbuilt");
    expect(decide(job(), now(k))).toMatchObject({ state: "waiting", reason: "unbuilt", slice: false });
  });

  it("does not retry a slice that failed on the same inputs, but does once they change", () => {
    const n = now();
    const failed = job({ builtFrom: null, status: "error", error: "too big", errorFrom: built(n) });
    expect(decide(failed, n)).toMatchObject({ state: "error", slice: false });
    expect(decide(failed, now({ settingsKey: settingsKey({ scale: 0.1 }) }))).toMatchObject({ state: "stale", slice: true });
  });

  it("holds off while slicing here or while a peer slices the same inputs", () => {
    expect(decide(job(), now(), { busy: true })).toMatchObject({ state: "slicing", slice: false });
    expect(decide(job(), now(), { peerSlicing: true })).toMatchObject({ state: "slicing", reason: "peer", slice: false });
  });

  it("no source, unsupported source, loading", () => {
    expect(decide(normalizeJob({}), now()).state).toBe("no-source");
    expect(decide(job(), now({ sourceState: "unsupported", sourceKey: null })).state).toBe("unsupported");
    expect(decide(job(), now({ sourceState: "loading", sourceKey: null })).state).toBe("waiting");
  });

  it("a never-sliced job slices at once; edits are debounced", () => {
    expect(debounceFor("never-sliced")).toBe(0);
    expect(debounceFor("settings")).toBeGreaterThan(0);
    expect(debounceFor("source")).toBeGreaterThan(0);
  });
});
