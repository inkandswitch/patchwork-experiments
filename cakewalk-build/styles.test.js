import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// Relative to the package root, which is where vitest runs.
const css = readFileSync("styles.css", "utf8");
const editor = readFileSync("editor.js", "utf8");

describe("styles", () => {
  // See the note in styles.css. Both tools here hide things by setting `.hidden`, and a class
  // that sets `display` beats the UA's `[hidden]` rule — silently, with the symptom showing up
  // somewhere else entirely.
  test("hidden beats any display rule", () => {
    expect(editor).toMatch(/\.hidden = /);
    expect(css).toMatch(/\[hidden\]\s*{\s*display:\s*none\s*!important/);
  });

  // A flex item shrinks by default, so the file list squashed its rows instead of scrolling.
  test("file list rows keep their height", () => {
    expect(css).toMatch(/\.cwe__page\s*{[^}]*flex:\s*none/);
  });
});
