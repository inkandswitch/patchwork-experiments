import { describe, expect, it } from "vitest";
import { cameraBasis, frameBounds, orbit, pan, zoom } from "./camera.js";
import { fragmentShader, MODES } from "./shader.js";
import { compile, toGLSL } from "../lang/index.js";

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(...a);

describe("camera", () => {
  it("frames the bounds and looks at the centre", () => {
    const cam = frameBounds({ min: [0, 0, 0], max: [2, 2, 2] });
    expect(cam.target).toEqual([1, 1, 1]);
    const { eye, fwd } = cameraBasis(cam);
    const toTarget = cam.target.map((t, i) => t - eye[i]);
    expect(dot(toTarget, fwd) / len(toTarget)).toBeCloseTo(1, 6);
    expect(eye[1]).toBeGreaterThan(1); // looking down a little
  });
  it("keeps an orthonormal, upright basis while orbiting", () => {
    let cam = frameBounds({ min: [-1, -1, -1], max: [1, 1, 1] });
    for (let i = 0; i < 20; i++) {
      cam = orbit(cam, 37, 23);
      const { right, up, fwd } = cameraBasis(cam);
      for (const v of [right, up, fwd]) expect(len(v)).toBeCloseTo(1, 6);
      expect(dot(right, up)).toBeCloseTo(0, 6);
      expect(dot(up, fwd)).toBeCloseTo(0, 6);
      expect(up[1]).toBeGreaterThan(0);
      expect(Math.abs(cam.pitch)).toBeLessThan(Math.PI / 2);
    }
  });
  it("pans in the view plane and zooms within limits", () => {
    const cam = frameBounds({ min: [-1, -1, -1], max: [1, 1, 1] });
    const moved = pan(cam, 100, 0, 500);
    expect(moved.target).not.toEqual(cam.target);
    expect(moved.dist).toBe(cam.dist);
    expect(zoom(cam, 0.5).dist).toBeCloseTo(cam.dist / 2);
    expect(zoom(cam, 1e-12).dist).toBeGreaterThan(0);
  });
});

describe("shader", () => {
  it("embeds the generated field and declares every mode", () => {
    const glsl = toGLSL(compile("sphere(0.5)").ir, "isf_user");
    const fs = fragmentShader(glsl);
    expect(fs.startsWith("#version 300 es")).toBe(true);
    expect(fs).toContain(glsl);
    expect(fs).toContain("float isf_pow");
    expect(MODES.map((m) => m.value)).toEqual([0, 1, 2, 3, 4]);
    // balanced braces (a cheap sanity check; the browser probe compiles it for real)
    expect(fs.split("{").length).toBe(fs.split("}").length);
  });
});

describe("raymarcher context loss", () => {
  // a WebGL2 stand-in: every method is a no-op that returns a token, links succeed
  function fakeGL() {
    const calls = [];
    const gl = new Proxy(
      {},
      {
        get(_t, key) {
          if (key === "getExtension") return () => null;
          if (key === "getProgramParameter") return () => true;
          if (typeof key === "string" && /^[A-Z_0-9]+$/.test(key)) return 1;
          return (...args) => {
            calls.push(key);
            return { key, args };
          };
        },
      },
    );
    return { gl, calls };
  }

  it("rebuilds and recompiles the last field when the context comes back", async () => {
    const { createRaymarcher } = await import("./raymarcher.js");
    const { gl, calls } = fakeGL();
    const canvas = document.createElement("canvas");
    canvas.getContext = () => gl;
    const events = [];
    let restored = null;
    const rm = createRaymarcher(canvas, {
      onContextLost: () => events.push("lost"),
      onContextRestored: (p) => {
        events.push("restored");
        restored = p;
      },
    });
    rm.state.camera = frameBounds({ min: [-1, -1, -1], max: [1, 1, 1] });
    expect((await rm.setField(toGLSL(compile("sphere(0.5)").ir, "isf_user"))).ok).toBe(true);
    expect(rm.ready).toBe(true);

    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(events).toEqual(["lost"]);
    expect(rm.lost).toBe(true);
    expect(rm.ready).toBe(false);
    expect(rm.render()).toBe(false);

    const before = calls.filter((c) => c === "linkProgram").length;
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(events).toEqual(["lost", "restored"]);
    expect((await restored).ok).toBe(true);
    expect(calls.filter((c) => c === "linkProgram").length).toBe(before + 1);
    expect(rm.lost).toBe(false);
    expect(rm.ready).toBe(true);
    expect(rm.render()).toBe(true);
    rm.dispose();
  });
});
