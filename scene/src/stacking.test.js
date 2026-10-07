import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The renderer appends its <canvas> after the viewport's overlays, so without
// an explicit order the canvas paints over the provider chooser, the toast and
// the hints, and a real click on "Flow slice" lands on the canvas instead.
// happy-dom has no WebGL (so no canvas to hit-test); check the rules instead.
// (Vitest stubs CSS imports, and happy-dom replaces the global URL, so read
// the file through node's own helpers.)
const css = readFileSync(fileURLToPath(import.meta.url).replace(/stacking\.test\.js$/, "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function zIndexOf(selector) {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  for (const [, sel, body] of rules) {
    const selectors = sel.split(",").map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    const m = body.match(/z-index:\s*(-?\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}

describe("viewport stacking order", () => {
  it("isolates the viewport so its z-indexes stay local", () => {
    expect(css).toMatch(/\.scene-tool \.viewport \{[^}]*isolation: isolate/);
  });

  it("puts every overlay above the canvas, and the chooser above everything", () => {
    const canvas = zIndexOf(".scene-tool .viewport > .canvas");
    const labels = zIndexOf(".scene-tool .viewport > .labels");
    expect(canvas).not.toBeNull();
    expect(labels).toBeGreaterThan(canvas);
    for (const overlay of ["hud", "empty", "no-webgl", "measure-hint", "toast", "drop-hint"]) {
      expect(zIndexOf(`.scene-tool .viewport > .${overlay}`), overlay).toBeGreaterThan(labels);
    }
    const chooser = zIndexOf(".scene-tool .viewport > .chooser");
    expect(chooser).toBeGreaterThan(zIndexOf(".scene-tool .viewport > .toast"));
  });

  it("keeps [hidden] overlays hidden even though they set their own display", () => {
    // .chooser (flex) and .drop-hint (grid) come after the [hidden] rule at the
    // same specificity; without !important the empty chooser box and the
    // dashed drop hint sat over the viewport all the time.
    expect(css).toMatch(/\.scene-tool \[hidden\] \{\s*display: none !important;/);
    expect(css).toMatch(/\.scene-render-controls \[hidden\] \{\s*display: none !important;/);
    for (const overlay of ["chooser", "drop-hint"]) {
      expect(css).toMatch(new RegExp(`\\.scene-tool \\.${overlay} \\{[^}]*display: (flex|grid)`));
    }
  });
});
