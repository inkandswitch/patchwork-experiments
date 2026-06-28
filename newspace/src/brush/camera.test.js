import { describe, it, expect } from "vitest";
import { viewRect, fitRect, centerCam, zoomAt, contentBounds } from "./camera.js";

describe("camera math", () => {
  it("viewRect is the inverse of the cam transform", () => {
    // cam {x:0,y:0,z:1} over a 800x600 viewport → world rect 0,0,800,600
    const a = viewRect({ x: 0, y: 0, z: 1 }, 800, 600);
    expect([a.x === 0, a.y === 0, a.w, a.h]).toEqual([true, true, 800, 600]); // (avoid -0 deep-equal)
    // zoomed 2x, panned: world origin shifts, extent halves
    expect(viewRect({ x: -100, y: -50, z: 2 }, 800, 600)).toEqual({ x: 50, y: 25, w: 400, h: 300 });
  });

  it("fitRect centres a rect and scales it to fit (min axis), clamped", () => {
    const c = fitRect({ x: 0, y: 0, w: 400, h: 300 }, 800, 600);
    expect(c.z).toBe(2); // min(800/400, 600/300) = 2
    // the rect's centre (200,150) lands at the viewport centre (400,300)
    expect(200 * c.z + c.x).toBe(400);
    expect(150 * c.z + c.y).toBe(300);
  });

  it("fitRect clamps zoom to [lo,hi]", () => {
    expect(fitRect({ x: 0, y: 0, w: 1, h: 1 }, 800, 600).z).toBe(8); // would be 600, clamped
    expect(fitRect({ x: 0, y: 0, w: 1e9, h: 1e9 }, 800, 600).z).toBe(0.15); // tiny, clamped
  });

  it("centerCam puts a world point at the viewport centre, keeping zoom", () => {
    const c = centerCam({ x: 0, y: 0, z: 2 }, 100, 50, 800, 600);
    expect(c.z).toBe(2);
    expect(100 * c.z + c.x).toBe(400);
    expect(50 * c.z + c.y).toBe(300);
  });

  it("zoomAt keeps the screen point fixed under the new zoom", () => {
    const cam = { x: 0, y: 0, z: 1 };
    const px = 400, py = 300;
    const worldBefore = { x: (px - cam.x) / cam.z, y: (py - cam.y) / cam.z };
    const c = zoomAt(cam, 2, px, py);
    expect(c.z).toBe(2);
    // the same world point still maps to (px,py)
    expect(worldBefore.x * c.z + c.x).toBeCloseTo(px, 6);
    expect(worldBefore.y * c.z + c.y).toBeCloseTo(py, 6);
  });

  it("zoomAt clamps", () => {
    expect(zoomAt({ x: 0, y: 0, z: 6 }, 4, 0, 0).z).toBe(8);
    expect(zoomAt({ x: 0, y: 0, z: 0.2 }, 0.1, 0, 0).z).toBe(0.15);
  });
});

describe("contentBounds", () => {
  it("encloses items, cursors, and the view, with padding", () => {
    const b = contentBounds(
      [{ x: 0, y: 0, w: 10, h: 10 }, { x: 90, y: 40, w: 10, h: 10 }],
      [{ x: -20, y: 5 }, null],
      { x: 0, y: 0, w: 50, h: 50 },
      80
    );
    // x: [-20 (cursor) .. 100 (item)] → -100, w 120+160=280; y: [0..50] → -80, h 210
    expect(b).toEqual({ x: -100, y: -80, w: 280, h: 210 });
  });
  it("falls back to a default box when empty", () => {
    expect(contentBounds([], [], null)).toEqual({ x: 0, y: 0, w: 1000, h: 1000 });
  });
});
