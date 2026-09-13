import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// Relative to the package root, which is where vitest runs.
const css = readFileSync("styles.css", "utf8");
const js = readFileSync("tool.js", "utf8");

describe("styles", () => {
  // The tool hides things by setting `.hidden`, and `[hidden] { display: none }` is only a UA
  // rule — any class that sets `display` beats it. The message overlay is absolutely positioned
  // at inset 0 over the iframe, so when that happened it kept swallowing wheels and clicks while
  // showing nothing: the preview would not scroll and its links would not open. There is no
  // symptom at the place the mistake is, so this guard is worth a test of its own.
  test("hidden beats any display rule", () => {
    expect(js).toMatch(/\.hidden = /);
    expect(css).toMatch(/\[hidden\]\s*{\s*display:\s*none\s*!important/);
  });

  test("the message overlay covers the stage, which is why it has to hide properly", () => {
    expect(css).toMatch(/\.site-viewer__message\s*{[^}]*position:\s*absolute/);
  });
});
