import { describe, it, expect } from "vitest";
// Pins the chrome ↔ canvas contract: canvas.jsx's toolbar-drag drop (dropStamp /
// dropToolAt) imports STAMPS / STAMP_IDS / sampleSvgPath from chrome.jsx — if these
// stop being exported the drop crashes with a ReferenceError (a real regression).
import { STAMPS, STAMP_IDS, sampleSvgPath } from "./brush/ui/chrome.jsx";

describe("chrome.jsx stamp exports (used by canvas.jsx toolbar drag-drop)", () => {
  it("exports the stamp table, ids and the path sampler", () => {
    expect(typeof sampleSvgPath).toBe("function");
    expect(STAMP_IDS instanceof Set).toBe(true);
    expect(STAMP_IDS.size).toBeGreaterThan(0);
  });

  it("every draggable stamp id has a multi-stroke stamp with paths", () => {
    for (const id of STAMP_IDS) {
      const stamp = STAMPS[id];
      expect(stamp, `STAMPS.${id}`).toBeTruthy();
      expect(Array.isArray(stamp.paths)).toBe(true);
      expect(stamp.paths.length).toBeGreaterThan(0);
    }
  });
});
