// The table's matrix copy (scene/src/shared/transform.js): a pose read back from its
// matrix is the same frame, even a hair from gimbal lock, where a tile
// standing on edge in a rack turned a hair is (y → ±π/2).
import { describe, it, expect } from "vitest";
import { composeMatrix, decompose, levelPose, multiply } from "./frame.js";

describe("decompose", () => {
  it.each([0, 1e-13, 1e-10, 1e-7, 1e-5, 1e-4, 3e-4, 4.4e-4, 1e-3])("keeps the whole turn %s short of gimbal lock", (eps) => {
    for (const sign of [1, -1]) {
      for (const [x, z] of [[0, 0], [0.3, 0.2], [Math.PI / 2, 0], [-2.5, 1.1], [1e-4, 0], [0, Math.PI - 1e-4]]) {
        const m = composeMatrix({ rotation: [x, sign * (Math.PI / 2 - eps), z] });
        const back = composeMatrix(decompose(m));
        // kept to 1e-9 (the table's tidy), so the frame to a few of that
        for (let k = 0; k < 16; k++) expect(Math.abs(back[k] - m[k]), `y = ${sign}(π/2 − ${eps}), x ${x}, z ${z}: [${k}]`).toBeLessThan(4e-9);
      }
    }
  });

  it("a tile standing in a rack turned a hair keeps the hair (levelPose of a standing frame)", () => {
    for (const t of [1e-4, 3e-4, Math.PI - 1e-4]) {
      const inRack = multiply(composeMatrix({ rotation: [0, t, 0] }), composeMatrix({ rotation: [Math.PI / 2, Math.PI / 2, 0] }));
      const back = composeMatrix(levelPose(inRack));
      for (let k = 0; k < 16; k++) expect(Math.abs(back[k] - inRack[k]), `rack yawed ${t}: [${k}]`).toBeLessThan(4e-9);
    }
  });
});
