import { describe, it, expect } from "vitest";
import { legendModel, formatTick, tintStop } from "./legend.js";
import { sanitizeLegend } from "./viewport.js";

describe("legends", () => {
  it("turns a provider's legend into a label, a gradient and three ticks", () => {
    const m = legendModel({ title: "Speed", unit: "m/s", min: 2, max: 3, stops: ["#000000", "#808080", "#ffffff"] }, "Streamlines");
    expect(m.label).toBe("Streamlines · Speed (m/s)");
    expect(m.gradient).toBe("linear-gradient(to right, #000000 0.0%, #808080 50.0%, #ffffff 100.0%)");
    expect(m.ticks).toEqual([{ at: 0, text: "2" }, { at: 0.5, text: "2.5" }, { at: 1, text: "3" }]);
    expect(legendModel({ title: "Pressure coefficient Cp", unit: "", min: -0.6, max: 0.6, stops: ["#000000", "#ffffff"] }, "Slice").ticks.map((t) => t.text)).toEqual(["−0.6", "0", "0.6"]);
  });
  it("shows the colours a colour override actually draws (multiplied in linear light)", () => {
    expect(tintStop("#ffffff", "#4e5b73")).toBe("#4e5b73");
    expect(tintStop("#000000", "#4e5b73")).toBe("#000000");
    expect(tintStop("#3b4cc0", "#ffffff")).toBe("#3b4cc0");
    // multiplied in linear light (0.216² → #3d3d3d), not in sRGB (0.502² → #404040)
    expect(tintStop("#808080", "#808080")).toBe("#3d3d3d");
    const m = legendModel({ title: "Cp", unit: "", min: -1, max: 1, stops: ["#3b4cc0", "#dddddd", "#b40426"] }, "Slice", "#4e5b73");
    expect(m.tinted).toBe(true);
    expect(m.gradient).toBe(`linear-gradient(to right, ${tintStop("#3b4cc0", "#4e5b73")} 0.0%, ${tintStop("#dddddd", "#4e5b73")} 50.0%, ${tintStop("#b40426", "#4e5b73")} 100.0%)`);
    expect(legendModel({ title: "Cp", unit: "", min: -1, max: 1, stops: ["#000000", "#ffffff"] }, "Slice", null).tinted).toBe(false);
  });
  it("formats ticks without noise", () => {
    expect(formatTick(-0.0001)).toBe("0");
    expect(formatTick(1.234)).toBe("1.23");
    expect(formatTick(-2)).toBe("−2");
  });
  it("rejects legends it can't draw safely", () => {
    expect(sanitizeLegend(null)).toBe(null);
    expect(sanitizeLegend({ min: 1, max: 1, stops: ["#000000", "#ffffff"] })).toBe(null);
    expect(sanitizeLegend({ min: 0, max: 1, stops: ["red", "url(x)"] })).toBe(null);
    const ok = sanitizeLegend({ title: "T", min: "0", max: 2, stops: ["#000000", "javascript:1", "#FFFFFF"] });
    expect(ok).toEqual({ title: "T", unit: "", min: 0, max: 2, stops: ["#000000", "#FFFFFF"] });
  });
});
