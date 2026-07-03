import { describe, it, expect } from "vitest";
import {
  useLayerTransform, itemLayer, defaultLayers,
  cameraTransform, viewportTransform, canvasKind, overlayKind,
} from "../src/layers.js";

// env stub: a settable camera + viewport, exposed as accessors (like Solid signals)
function env(cam = { x: 0, y: 0, z: 1 }) {
  let c = cam;
  return { camera: () => c, viewport: () => ({ w: 800, h: 600 }), layer: () => ({}), set: (n) => (c = n) };
}

describe("cameraTransform — pan/zoom space", () => {
  it("toItem inverts the camera; toScreen reapplies it (round-trips)", () => {
    const e = env({ x: 100, y: 50, z: 2 });
    const t = cameraTransform.use(e);
    expect(t.toItem(300, 250)).toEqual({ x: 100, y: 100 }); // (300-100)/2, (250-50)/2
    expect(t.toScreen(100, 100)).toEqual({ x: 300, y: 250 });
    expect(t.scale()).toBe(2);
  });
  it("transform() is a live CSS string that tracks the camera", () => {
    const e = env({ x: 10, y: 20, z: 1 });
    const t = cameraTransform.use(e);
    expect(t.transform()).toBe("translate(10px, 20px) scale(1)");
    e.set({ x: 0, y: 0, z: 3 });
    expect(t.transform()).toBe("translate(0px, 0px) scale(3)"); // reactive: reads env at call time
  });
});

describe("viewportTransform — screen IS item space (pinned chrome)", () => {
  it("is the identity mapping at any camera", () => {
    const t = viewportTransform.use(env({ x: 999, y: 999, z: 9 }));
    expect(t.toItem(40, 60)).toEqual({ x: 40, y: 60 });
    expect(t.toScreen(40, 60)).toEqual({ x: 40, y: 60 });
    expect(t.transform()).toBe("none");
    expect(t.scale()).toBe(1);
  });
});

describe("useLayerTransform — registry resolution (no host registry in tests)", () => {
  it("resolves a KNOWN kind's built-in transform even with no registry (camera, not identity)", () => {
    const t = useLayerTransform({ id: "x", kind: "canvas" }, env({ x: 5, y: 5, z: 1 }));
    expect(t.transform()).toBe("translate(5px, 5px) scale(1)"); // camera built-in, not "none"
  });
  it("falls back to identity for an UNKNOWN kind/transform (never throws)", () => {
    const t = useLayerTransform({ id: "x", kind: "nope", transform: "alsonope" }, env());
    expect(t.toItem(5, 7)).toEqual({ x: 5, y: 7 });
    expect(t.transform()).toBe("none");
  });
});

describe("layer helpers", () => {
  it("itemLayer defaults an untagged item to the base canvas layer", () => {
    expect(itemLayer({})).toBe("canvas");
    expect(itemLayer({ layer: "overlay" })).toBe("overlay");
    expect(itemLayer(null)).toBe("canvas");
  });
  it("defaultLayers is canvas (base) then overlay (top)", () => {
    expect(defaultLayers().map((l) => l.id)).toEqual(["canvas", "overlay"]);
  });
  it("built-in kinds name their default transforms (no hardcoded switch)", () => {
    expect(canvasKind.transform).toBe("camera");
    expect(overlayKind.transform).toBe("viewport");
    expect(overlayKind.frost).toBe(true);
  });
});
