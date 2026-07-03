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

  it("ownership is per-write, not a one-way latch: a local set() RECLAIMS it (audit)", () => {
    // there is NO provider-close signal in patchwork-providers, so when a parent
    // canvas unmounts, "the provider went away" is undetectable — owned() used
    // to latch false forever, freezing a nested canvas on the last provided
    // value. Mitigation: the next LOCAL write takes the entry back.
    const ctx = createCanvasContext(null, { fallbacks: { tool: "select" } });
    expect(ctx.tool.owned()).toBe(true);
    ctx.tool._accepted(); // what the subscribe callback does per provided push
    ctx.tool.push("hand");
    expect(ctx.tool.owned()).toBe(false);
    ctx.tool.set("pen"); // the parent is gone; a local gesture writes
    expect(ctx.tool.owned()).toBe(true); // reclaimed — no longer frozen
    expect(ctx.tool.value).toBe("pen");
    ctx.tool._accepted(); // a live provider pushing again re-marks it — per-write
    ctx.tool.push("marker");
    expect(ctx.tool.owned()).toBe(false);
    expect(ctx.tool.value).toBe("marker");
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

// ── the DRAW-CLAIM protocol (the pure predicate + the context marker) ─────────
import { drawClaim, claimDraws, drawsClaimed, toolIsClaimable, UNCLAIMABLE_TOOLS } from "./context.js";

describe("drawClaim — the claim decision (pure, load-bearing beyond the map)", () => {
  it("select/hand/wire/text/place are NEVER claimed — the inner tool stays live", () => {
    for (const tool of UNCLAIMABLE_TOOLS) {
      expect(toolIsClaimable(tool)).toBe(false);
      expect(drawClaim({ tool, claimed: true, entered: false })).toBe("none");
      expect(drawClaim({ tool, claimed: false, entered: false })).toBe("none");
    }
    expect(drawClaim({ tool: null, claimed: true, entered: false })).toBe("none");
  });
  it("an UN-ENTERED spatial box under a claiming canvas → the outer canvas claims (annotation)", () => {
    for (const tool of ["pen", "marker", "rectangle", "ellipse", "line", "arrow", "eraser"]) {
      expect(drawClaim({ tool, claimed: true, entered: false })).toBe("annotation");
    }
  });
  it("an ENTERED box owns its gestures — entering RE-ROOTS the claim (content)", () => {
    expect(drawClaim({ tool: "pen", claimed: true, entered: true })).toBe("content");
    expect(drawClaim({ tool: "eraser", claimed: true, entered: true })).toBe("content");
  });
  it("standalone (nobody claims) → fallback-to-own: the box captures its own draws", () => {
    expect(drawClaim({ tool: "pen", claimed: false, entered: false })).toBe("own");
    expect(drawClaim({ tool: "eraser", claimed: false, entered: false })).toBe("own");
  });
});

describe("claimDraws / drawsClaimed — the marker on the context object", () => {
  it("a canvas claims by marking its own context; a mount reads the same object", () => {
    const ctx = createCanvasContext(null, { fallbacks: { tool: "select" } });
    expect(drawsClaimed(ctx)).toBe(false); // fresh context: unclaimed (standalone hosts)
    claimDraws(ctx);
    expect(drawsClaimed(ctx)).toBe(true);
    ctx.destroy();
  });
  it("tolerates absent/foreign contexts (a standalone map has none)", () => {
    expect(drawsClaimed(null)).toBe(false);
    expect(drawsClaimed({})).toBe(false);
  });
});
