import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The About section mounts another tool (<patchwork-view>, light DOM) inside
// .scene-tool, so a rule like `.scene-tool .label { position: absolute }`
// would restyle that tool's own .label. Every descendant rule stops at the
// embed (a nested scene inside it styles itself again), except the few
// viewport-internal ones stacking.test.js pins by their exact text.
const css = readFileSync(fileURLToPath(import.meta.url).replace(/embed-css\.test\.js$/, "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const GUARD = ":where(:not(.about-embed *), .about-embed .scene-tool *)";
const PINNED = (sel) => sel.includes(".viewport") || [".scene-tool [hidden]", ".scene-tool .chooser", ".scene-tool .drop-hint"].includes(sel);

describe("scene styles stop at the About embed", () => {
  it("guards every .scene-tool descendant rule", () => {
    const selectors = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap(([, sel]) => sel.split(",").map((s) => s.trim()));
    const descendant = selectors.filter((s) => /^\.scene-tool(\[[^\]]*\])*[\s>]/.test(s));
    expect(descendant.length).toBeGreaterThan(100);
    const unguarded = descendant.filter((s) => !s.includes(GUARD) && !s.includes("about-embed") && !PINNED(s));
    expect(unguarded).toEqual([]);
  });
});
