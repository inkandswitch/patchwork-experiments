// A meshopt GLB on a peer that can't run the decoder (no WebAssembly, or the
// decoder chunk didn't load) is this peer's problem, not the bytes': the
// failure is transient, so the flow providers throw rather than store a
// body-less build every other peer would keep.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FILE = "automerge:fi1e111111111111111111111";
const RENDER = "automerge:rend111111111111111111111";
const GLB_DOC = "automerge:g1b1111111111111111111111";
const FLOW = "automerge:flow1111111111111111111111";
const meshopt = () => new Uint8Array(readFileSync(join(process.cwd(), "src/test/fixtures", "solander-freezer.glb")));
const fileDoc = (bytes) => ({ "@patchwork": { type: "file" }, name: "Freezer.glb", extension: "glb", content: bytes });
const fakeRepo = (docs) => ({
  async find(url) {
    if (!docs[url]) throw new Error(`unavailable: ${url}`);
    return { url, doc: () => docs[url], on() {}, off() {} };
  },
});

async function withDecoder(factory) {
  vi.resetModules();
  vi.doMock("./vendor/meshopt_decoder.module.js", factory);
  return { mesh: await import("./mesh-section.js"), section: await import("./section.js") };
}

afterEach(() => {
  vi.doUnmock("./vendor/meshopt_decoder.module.js");
  vi.resetModules();
});

describe("a decoder this peer can't run", () => {
  it("no WebAssembly: decodeGLB throws a transient error, and a linked GLB file is a transient failure", async () => {
    const { mesh, section } = await withDecoder(() => ({ MeshoptDecoder: { supported: false, ready: Promise.resolve() } }));
    const err = await mesh.decodeGLB(meshopt()).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.transient).toBe(true);
    expect(err.message).toMatch(/WebAssembly isn't available/);
    const r = await section.acquireSection({ url: FILE, plane: { kind: "z", z: 1.7 }, repo: fakeRepo({ [FILE]: fileDoc(meshopt()) }) });
    expect(r).toMatchObject({ ok: false, transient: true });
    expect(r.error).toMatch(/can't be decoded here/);
    // so the flow providers throw (keeping the last good render) instead of storing no body
    await expect(section.bodySectionFor({}, { url: FILE, plane: { kind: "waterline" } }, { repo: fakeRepo({ [FILE]: fileDoc(meshopt()) }), url: FLOW })).rejects.toThrow(
      /isn't available here/,
    );
  });

  it("the decoder chunk fails to load: transient too, for a render's GLB", async () => {
    const { section } = await withDecoder(() => {
      throw new Error("Failed to fetch dynamically imported module");
    });
    const render = { "@patchwork": { type: "scene-render" }, title: "Freezer", providerId: "file-glb", source: GLB_DOC, glbUrl: GLB_DOC, status: "ready" };
    const repo = fakeRepo({ [RENDER]: render, [GLB_DOC]: fileDoc(meshopt()) });
    const r = await section.acquireSection({ url: RENDER, plane: { kind: "z", z: 1.7 }, repo });
    expect(r).toMatchObject({ ok: false, transient: true });
    expect(r.error).toMatch(/render's GLB can't be decoded here.*couldn't be loaded/);
  });

  it("bytes that aren't a GLB stay non-transient (the same on every peer)", async () => {
    const { section } = await withDecoder(() => ({ MeshoptDecoder: { supported: false, ready: Promise.resolve() } }));
    const r = await section.acquireSection({ url: FILE, repo: fakeRepo({ [FILE]: fileDoc(new Uint8Array([1, 2, 3, 4, 5])) }) });
    expect(r).toMatchObject({ ok: false, transient: false });
  });
});
