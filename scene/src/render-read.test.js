import { describe, it, expect } from "vitest";
import { FakeRepo } from "./test/fake-repo.js";
import { readRender, renderKey, isRenderDoc } from "./render-read.js";
import { newRenderDoc } from "./datatype.js";
import { glbFileDoc } from "./build.js";
import { encodeGLB } from "./glb.js";

describe("render-read", () => {
  it("reads an unbuilt render as glb: null", async () => {
    const repo = new FakeRepo();
    const r = repo.add(newRenderDoc({ title: "x", parent: "automerge:src", providerId: "p", params: {} }));
    const out = await readRender(repo, r.url);
    expect(out).toMatchObject({ glb: null, glbUrl: null, status: "idle", source: "automerge:src" });
    expect(renderKey(out.render)).toBe("render:");
  });

  it("reads a built render's GLB bytes", async () => {
    const repo = new FakeRepo();
    const bytes = encodeGLB({ meshes: [] });
    const file = await repo.create2(glbFileDoc("x", bytes));
    const r = repo.add({ ...newRenderDoc({ title: "x", parent: "automerge:src", providerId: "p", params: {} }), glbUrl: file.url });
    const out = await readRender(repo, r.url);
    expect(out.glb).toEqual(bytes);
    expect(renderKey(out.render)).toBe(`render:${file.url}`);
  });

  it("refuses a doc that isn't a render", async () => {
    const repo = new FakeRepo();
    const d = repo.add({ "@patchwork": { type: "file" }, content: "x" });
    expect(isRenderDoc(d.doc())).toBe(false);
    await expect(readRender(repo, d.url)).rejects.toThrow(/not a scene render/);
  });
});
