import { describe, it, expect } from "vitest";
import { highlightJson } from "../src/inspector-editor.js";

describe("highlightJson", () => {
  it("wraps keys, strings, numbers, and literals in token spans", () => {
    const h = highlightJson({ name: "x", n: 42, ok: true, z: null });
    expect(h).toContain('<span class="ns-j-key">&quot;name&quot;</span>');
    expect(h).toContain('<span class="ns-j-str">&quot;x&quot;</span>');
    expect(h).toContain('<span class="ns-j-num">42</span>');
    expect(h).toContain('<span class="ns-j-lit">true</span>');
    expect(h).toContain('<span class="ns-j-lit">null</span>');
  });
  it("escapes HTML in values (no injection)", () => {
    const h = highlightJson({ x: "<script>" });
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;");
  });
  it("handles arrays and nesting", () => {
    const h = highlightJson({ a: [1, 2] });
    expect(h).toContain('<span class="ns-j-num">1</span>');
    expect(h).toContain('<span class="ns-j-num">2</span>');
  });
});
