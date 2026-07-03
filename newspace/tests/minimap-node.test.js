import { describe, it, expect } from "vitest";
import { jumpCamera, plugin } from "../src/minimap-node.js";

describe("jumpCamera — minimap click → camera that centres (wx,wy)", () => {
  // a view 800×600 world units at zoom 1: centring on (400,300) needs cam (0,0)? No —
  // cam.x = (w/2 - wx)*z = (400-400)*1 = 0 only when wx = w/2. General check below.
  it("places the target at the viewport centre (screen check)", () => {
    const view = { x: 0, y: 0, w: 800, h: 600 };
    const cam = jumpCamera(view, { z: 1 }, 1000, 700);
    // verify: wx*z + cam.x === view.w/2 (the centre, in this 1:1 world)
    expect(1000 * 1 + cam.x).toBe(400);
    expect(700 * 1 + cam.y).toBe(300);
    expect(cam.z).toBe(1);
  });
  it("keeps the current zoom and scales the offset by it", () => {
    const cam = jumpCamera({ w: 400, h: 300 }, { z: 2 }, 50, 25);
    // cam.x = (200 - 50)*2 = 300 ; cam.y = (150 - 25)*2 = 250
    expect(cam).toEqual({ x: 300, y: 250, z: 2 });
  });
  it("defaults safely with no view / no camera", () => {
    expect(jumpCamera(null, null, 0, 0)).toEqual({ x: 0, y: 0, z: 1 });
  });
});

describe("minimap plugin shape", () => {
  it("is a BARE sketchy:surface with canvas-fed inlets and no outlets", () => {
    expect(plugin.type).toBe("sketchy:surface");
    expect(plugin.id).toBe("minimap");
    expect(plugin.bare).toBe(true);
    expect(plugin.inlets.map((i) => i.name)).toEqual(["rects", "bounds", "peers", "view", "camera"]);
    expect(plugin.outlets).toEqual([]);
  });
});
