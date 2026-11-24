import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

describe("local-first", () => {
  it("no source file names another origin", () => {
    const files = readdirSync(new URL(".", import.meta.url)).filter((f) => f.endsWith(".js"));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const text = readFileSync(new URL(f, import.meta.url), "utf8");
      // this file states the rule, so it spells the schemes in pieces
      if (f === "local.test.js") continue;
      expect(text, f).not.toMatch(/https?:\/\//);
    }
  });
});
