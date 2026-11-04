import { describe, it, expect } from "vitest";
import { clampValue, closestOnLine, handleBase, handleSpecs } from "./handles.js";

const provider = {
  params: [
    { key: "height", label: "Height (m)", kind: "number", default: 0, min: -10, max: 10, step: 0.05 },
    { key: "resolution", kind: "integer", default: 110, min: 8, max: 160 },
    { key: "colorBy", kind: "enum", default: "cp" },
  ],
  handles: [
    { param: "height", axis: [0, 2, 0], label: "Slice height" },
    { param: "colorBy", axis: [1, 0, 0] }, // not a number
    { param: "missing", axis: [1, 0, 0] },
    { param: "resolution", axis: [0, 0, 0] }, // no direction
  ],
};

describe("handles", () => {
  it("come from a provider's declared number params, with their ranges, the value from the render doc", () => {
    expect(handleSpecs(provider, { height: 1.5 })).toEqual([{ key: "height", label: "Slice height", axis: [0, 1, 0], value: 1.5, min: -10, max: 10, step: 0.05, integer: false }]);
    expect(handleSpecs(provider, {})[0].value).toBe(0); // the default
    expect(handleSpecs({ params: provider.params }, {})).toEqual([]);
  });

  it("sit on the line through the middle of the geometry, along the axis", () => {
    expect(handleBase([3, 2, -1], [0, 1, 0])).toEqual([3, 0, -1]);
  });

  it("follow the pointer to the nearest point on their line", () => {
    // the line is the y axis through (1, 0, 0); a ray along -z through (1, 2, 5) crosses it at y = 2
    expect(closestOnLine([1, 0, 0], [0, 1, 0], [1, 2, 5], [0, 0, -1])).toBeCloseTo(2);
    // a skew ray: nearest at y = 3
    expect(closestOnLine([0, 0, 0], [0, 1, 0], [5, 3, 0], [-1, 0, 1])).toBeCloseTo(3);
    // a ray along the line itself says nothing
    expect(closestOnLine([0, 0, 0], [0, 1, 0], [0, 5, 0], [0, 1, 0])).toBeNull();
  });

  it("keep a dragged value in range and on its step", () => {
    const [h] = handleSpecs(provider, {});
    expect(clampValue(h, 12)).toBe(10);
    expect(clampValue(h, 1.234)).toBe(1.25);
    expect(clampValue({ min: 8, max: 160, integer: true }, 9.6)).toBe(10);
  });
});
