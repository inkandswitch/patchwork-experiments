import { describe, it, expect } from "vitest";
import { createCanvasContext, CONTEXT_SELECTORS } from "./context.js";
import { subscribe } from "@inkandswitch/patchwork-providers";

// a few ms — reliably covers MessagePort delivery (provide/accept) even under the
// parallel-test-file load that made a 0ms flush occasionally race
const flush = () => new Promise((r) => setTimeout(r, 10));

describe("createCanvasContext — fallback-to-own", () => {
  it("owns each entry with its fallback when no provider answers", () => {
    const ctx = createCanvasContext(null, {
      fallbacks: { camera: { x: 0, y: 0, z: 1 }, tool: "select", brush: { color: "line" }, selection: [], pointer: { x: 0, y: 0 } },
    });
    expect(ctx.camera.value).toEqual({ x: 0, y: 0, z: 1 });
    expect(ctx.tool.value).toBe("select");
    expect(ctx.tool.owned()).toBe(true);
    expect(Object.keys(ctx.selectors)).toEqual(["camera", "pointer", "tool", "brush", "selection"]);
  });

  it(".set() drives the source and connect() streams it", () => {
    const ctx = createCanvasContext(null, { fallbacks: { tool: "select" } });
    const seen = [];
    ctx.tool.connect((op) => seen.push(op.value));
    expect(seen[0]).toBe("select"); // snapshot on connect
    ctx.tool.set("pen");
    expect(ctx.tool.value).toBe("pen");
    expect(seen).toEqual(["select", "pen"]);
  });

  it("uses the default selectors (sketchy:*)", () => {
    expect(CONTEXT_SELECTORS).toMatchObject({
      camera: "sketchy:camera",
      pointer: "sketchy:pointer",
      tool: "sketchy:tool",
      brush: "sketchy:brush-config",
      selection: "sketchy:selection",
    });
  });

  it("destroy() removes the provide listeners", () => {
    const el = document.createElement("div");
    let n = 0;
    const orig = el.addEventListener.bind(el);
    el.addEventListener = (...a) => { if (a[0] === "patchwork:subscribe") n++; return orig(...a); };
    const ctx = createCanvasContext(el, { fallbacks: { tool: "select" } });
    expect(n).toBe(5); // one provide listener per selector
    ctx.destroy(); // should not throw
  });
});

// The full cross-view provide/accept round-trip needs MessageChannel.
describe.runIf(typeof MessageChannel !== "undefined")("provide/accept round-trip", () => {
  it("a nested-canvas subscribe receives the provider's value, then updates", async () => {
    // Real topology: the canvas mount lives INSIDE a host patchwork-view; a nested
    // canvas sits in a DESCENDANT patchwork-view. `subscribe` dispatches from the
    // nearest enclosing patchwork-view, so the nested one's event bubbles UP through
    // the canvas mount (the provider) — while the provider's own subscribe dispatches
    // from the host view (above it), so it never self-catches.
    const hostView = document.createElement("patchwork-view");
    const element = document.createElement("div"); // the canvas mount (provider)
    const nestedView = document.createElement("patchwork-view");
    const child = document.createElement("div"); // a nested-canvas consumer
    hostView.append(element);
    element.append(nestedView);
    nestedView.append(child);
    document.body.append(hostView);

    const provider = createCanvasContext(element, { fallbacks: { tool: "select" } });
    expect(provider.tool.owned()).toBe(true); // no ancestor provider → owns it

    const seen = [];
    const off = subscribe(child, { type: CONTEXT_SELECTORS.tool }, (v) => seen.push(v));
    await flush();
    expect(seen.at(-1)).toBe("select"); // got the provider's current value
    provider.tool.set("pen");
    await flush();
    expect(seen.at(-1)).toBe("pen"); // live update
    off();
    provider.destroy();
  });
});
