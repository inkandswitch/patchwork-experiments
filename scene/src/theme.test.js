// The colour scheme the stage's root asks for (theme.js colorSchemeOf): native
// controls follow Patchwork's theme, whatever the OS's.
import { describe, it, expect } from "vitest";
import { colorSchemeOf } from "./theme.js";

describe("colorSchemeOf", () => {
  it.each([
    ["white", [1, 1, 1], "light"],
    ["the default viewport grey", [0.96, 0.96, 0.96], "light"],
    ["black", [0, 0, 0], "dark"],
    ["a dark theme's fill", [0.12, 0.12, 0.14], "dark"],
    ["mid-grey, just under", [0.49, 0.49, 0.49], "dark"],
    ["mid-grey, at", [0.5, 0.5, 0.5], "light"],
    ["saturated blue is dark by luma", [0, 0, 1], "dark"],
    ["saturated yellow is light", [1, 1, 0], "light"],
    ["nothing read: light", undefined, "light"],
  ])("%s → %s", (_name, rgb, want) => {
    expect(colorSchemeOf(rgb)).toBe(want);
  });
});
