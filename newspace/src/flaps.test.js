// FLAPS — dormant since 2026-07-02: the registry-flap chrome is no longer
// mounted by the canvas (see flaps.jsx's header + TODO.md — flaps return as
// named STICKY container windows). The pure pieces stay pinned: per-viewer
// state resolution, the edge maths, and the registry listing.
import { describe, it, expect } from "vitest";
import { registerPlugins } from "@inkandswitch/patchwork-plugins";
import { listFlaps, resolveFlapState, nearestEdge, FLAP_EDGES } from "./flaps.jsx";

describe("flap state (pure)", () => {
  it("resolveFlapState: viewer state wins, else descriptor edge, else bottom; open defaults closed", () => {
    expect(resolveFlapState(null, { edge: "left" })).toEqual({ edge: "left", open: false });
    expect(resolveFlapState({ edge: "right", open: true }, { edge: "left" })).toEqual({ edge: "right", open: true });
    expect(resolveFlapState(null, null)).toEqual({ edge: "bottom", open: false });
    expect(resolveFlapState({ edge: "top" }, { edge: "up" })).toEqual({ edge: "bottom", open: false }); // junk edges fall through
  });

  it("nearestEdge picks the closest of left/right/bottom (never top)", () => {
    expect(nearestEdge(2, 300, 1000, 800)).toBe("left");
    expect(nearestEdge(995, 300, 1000, 800)).toBe("right");
    expect(nearestEdge(500, 790, 1000, 800)).toBe("bottom");
    expect(nearestEdge(500, 5, 1000, 800)).not.toBe("top");
    expect(FLAP_EDGES).toEqual(["bottom", "left", "right"]);
  });
});

describe("the sketchy:flap registry (dormant — nothing ships a registration)", () => {
  it("listFlaps still reads the registry (a future registration would be seen)", () => {
    registerPlugins([{ type: "sketchy:flap", id: "test-flap", name: "Bits", edge: "bottom", async load() { return () => () => {}; } }]);
    const flaps = listFlaps();
    expect(flaps.some((f) => f.id === "test-flap" && f.name === "Bits")).toBe(true);
    // the shipped registries no longer include the old default "parts" flap
    expect(flaps.some((f) => f.id === "parts")).toBe(false);
  });
});
