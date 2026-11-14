import { describe, it, expect } from "vitest";
import { convert3dm } from "./source.js";

describe("truncated file", () => {
  it("says so", async () => {
    const bytes = new TextEncoder().encode("3D Geometry File Format       80" + "x".repeat(40));
    await expect(convert3dm(bytes)).rejects.toThrow(/truncated|not a Rhino/);
  }, 60000);
});
