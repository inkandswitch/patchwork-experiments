// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { FakeRepo, flush } from "./test/fake-repo.js";
import { manualTime } from "./stage/time.js";
import { CLAIM_MS, LISTEN_MS } from "./content/lock.js";
import { RETRY_BACKOFF_MS } from "./content/render-manager.js";

vi.mock("@inkandswitch/patchwork-plugins", () => {
  const plugins = new Map();
  const registry = {
    register: (p) => plugins.set(p.id, { ...p }),
    has: (id) => plugins.has(id),
    get: (id) => plugins.get(id),
    filter: (fn) => [...plugins.values()].filter(fn),
    async load(id) {
      const p = plugins.get(id);
      if (p && !p.module) p.module = await p.load();
      return p;
    },
    on: () => () => {},
  };
  return { getRegistry: () => registry };
});

const { getRegistry } = await import("@inkandswitch/patchwork-plugins");
const { default: Controls } = await import("./controls-tool.js");
const { REBUILD_EVENT } = await import("./shared/embed.js");
const { newRenderDoc } = await import("./shared/datatype.js");
const { encodeGLB } = await import("./glb.js");

const build = vi.fn(async ({ params }) => ({ kind: "glb", glb: encodeGLB({ meshes: [{ positions: [0, 0, 0, params.size, 0, 0, 0, 1, 0] }] }) }));
getRegistry("scene:source").register({
  type: "scene:source",
  id: "thing",
  content: "built",
  name: "Thing maker",
  supportedDatatypes: ["thing"],
  params: [
    { key: "size", label: "Size", kind: "number", default: 1, min: 0.1, max: 10, log: true, cost: "cheap" },
    { key: "count", kind: "integer", default: 3, min: 1, max: 9 },
    { key: "solid", kind: "boolean", default: true },
    { key: "style", kind: "enum", default: "a", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
    { key: "tint", kind: "color", default: "#ff0000" },
    { key: "note", kind: "string", default: "" },
  ],
  async load() {
    return { build };
  },
});

// (GLB hashing without WebCrypto: every step of a build lands on the stepped time)
beforeAll(() => vi.stubGlobal("crypto", {}));
afterAll(() => vi.unstubAllGlobals());

describe("scene-render-controls, alone", () => {
  let cleanup;
  afterEach(() => cleanup?.());

  async function mount() {
    const repo = new FakeRepo();
    const source = repo.add({ "@patchwork": { type: "thing" }, title: "t" });
    const render = repo.add(newRenderDoc({ title: "T", parent: source.url, providerId: "thing", params: { size: 1 } }));
    const element = document.createElement("div");
    element.repo = repo;
    element.time = manualTime();
    document.body.append(element);
    cleanup = Controls(render, element);
    await element.time.advance(100);
    return { repo, source, render, element, time: element.time };
  }

  it("draws a field per ParamSpec and writes params back", async () => {
    const { render, element } = await mount();
    expect(element.querySelector(".provider").textContent).toBe("Thing maker");
    expect(element.querySelectorAll(".param").length).toBe(6);
    const num = element.querySelector('.param[data-kind="number"] input[type="number"]');
    expect(num.value).toBe("1");
    num.value = "4";
    num.dispatchEvent(new Event("change"));
    expect(render.doc().params.size).toBe(4);
    const box = element.querySelector('.param[data-kind="boolean"] input');
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    expect(render.doc().params.solid).toBe(false);
    expect(element.querySelector(".status").textContent).toBe("Not built yet");
  });

  it("toggles pinned", async () => {
    const { render, element } = await mount();
    const pin = element.querySelector(".pinned");
    pin.checked = true;
    pin.dispatchEvent(new Event("change"));
    expect(render.doc().pinned).toBe(true);
  });

  it("rebuilds by itself when no scene claims the request", async () => {
    const { render, element, repo, time } = await mount();
    build.mockClear();
    let seen = null;
    element.addEventListener(REBUILD_EVENT, (e) => (seen = e.detail));
    element.querySelector(".rebuild").click();
    await time.advance(LISTEN_MS + CLAIM_MS + 500); // (it waits for the lock as a scene's build does)
    expect(seen).toEqual({ renderUrl: render.url });
    expect(build).toHaveBeenCalledTimes(1);
    expect(render.doc().glbUrl).toBe(repo.created.at(-1).url);
    expect(element.querySelector(".status").textContent).toBe("Up to date");
  });

  it("builds only when asked, never by itself, and says a failure of what it has now", async () => {
    const { render, element, time } = await mount();
    build.mockClear();
    await time.advance(LISTEN_MS + CLAIM_MS + 1000);
    expect(build).not.toHaveBeenCalled();
    expect(element.querySelector(".status").textContent).toBe("Not built yet");
    build.mockImplementationOnce(async () => {
      throw new Error("syntax error");
    });
    element.querySelector(".rebuild").click();
    await time.advance(CLAIM_MS + 500);
    expect(build).toHaveBeenCalledTimes(1);
    await time.advance(RETRY_BACKOFF_MS.at(-1) * 2);
    expect(build).toHaveBeenCalledTimes(1); // (no retry of its own either)
    expect(element.querySelector(".status").textContent).toBe("Error");
    expect(element.querySelector(".error").textContent).toBe("syntax error");
    expect(render.doc().error).toBe("syntax error");
  });

  it("leaves the build to a scene that claims it", async () => {
    const { render, element, time } = await mount();
    build.mockClear();
    element.addEventListener(REBUILD_EVENT, (e) => e.preventDefault());
    element.querySelector(".rebuild").click();
    await time.advance(100);
    expect(build).not.toHaveBeenCalled();
    expect(render.doc().glbUrl).toBeNull();
  });

  it("cleans up", async () => {
    const { render, source, element } = await mount();
    cleanup();
    cleanup = null;
    expect(element.children.length).toBe(0);
    expect(render.listenerCount("change")).toBe(0);
    expect(source.listenerCount("change")).toBe(0);
  });
});

describe("scene-render-controls, dependencies", () => {
  it("shows stale when a dependency moves, and a build alone records it", async () => {
    getRegistry("scene:source").register({
      type: "scene:source",
      id: "linked",
      content: "built",
      name: "Linked",
      supportedDatatypes: ["linked"],
      params: [],
      async load() {
        return { build: async () => ({ kind: "glb", glb: encodeGLB({ meshes: [{ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }] }) }), dependencies: (doc) => [doc.link] };
      },
    });
    const repo = new FakeRepo();
    const dep = repo.add({ n: 1 });
    const source = repo.add({ "@patchwork": { type: "linked" }, link: dep.url });
    const render = repo.add(newRenderDoc({ title: "L", parent: source.url, providerId: "linked", params: {} }));
    const element = document.createElement("div");
    element.repo = repo;
    element.time = manualTime();
    document.body.append(element);
    const cleanup = Controls(render, element);
    await element.time.advance(100);
    element.querySelector(".rebuild").click();
    await element.time.advance(LISTEN_MS + CLAIM_MS + 500);
    expect(render.doc().builtFrom.deps).toEqual({ [dep.url]: dep.heads() });
    expect(element.querySelector(".status").textContent).toBe("Up to date");
    dep.change((d) => (d.n = 2));
    expect(element.querySelector(".status").textContent).toBe("Stale");
    cleanup();
    expect(dep.listenerCount("change")).toBe(0);
  });
});
