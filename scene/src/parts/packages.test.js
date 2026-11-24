import { describe, it, expect } from "vitest";
import { cardOf, promptText, shortUrl } from "./packages.js";

const A = "automerge:2zt6LbnDAzvNj9WDNDA4ew21R85F";
const B = "automerge:3aB6LbnDAzvNj9WDNDA4ew21R85G";
const e = (url, extra = {}) => ({ url, name: null, ...extra });
const HTTPS = "https://tools.example.com/scene/index.js";

describe("the packages card (cardOf, pure)", () => {
  // what's asked about (0, 1, 2), what failed (0, 1, 2), what's loading (0, 1, 2): all 27
  it("says nothing when there's nothing; else asks first, then failures, then loading: every combination", () => {
    const some = (n, extra) => [A, B].slice(0, n).map((u) => e(u, extra));
    for (const a of [0, 1, 2]) {
      for (const f of [0, 1, 2]) {
        for (const l of [0, 1, 2]) {
          const c = cardOf({ ask: some(a), failed: some(f, { error: "boom" }), loading: some(l) });
          if (!a && !f && !l) {
            expect(c).toBeNull();
            continue;
          }
          expect(c.rows.map((r) => r.state)).toEqual([...Array(a).fill("ask"), ...Array(f).fill("failed"), ...Array(l).fill("loading")]);
          expect(c.warn).toBe(a > 0);
          const labels = c.actions.map((x) => `${x.id}:${x.label}`);
          if (a) {
            expect(c.title).toBe(a === 1 ? "This scene uses a package you don't have." : "This scene uses 2 packages you don't have.");
            expect(labels).toEqual(["dismiss:Not now", a === 1 ? "load:Load it" : "load:Load them"]);
          } else if (f) {
            expect(c.title).toBe(f === 1 ? "A package this scene uses couldn't be loaded." : "2 packages this scene uses couldn't be loaded.");
            expect(labels).toEqual(["dismiss:Dismiss", "load:Try again"]);
          } else {
            expect(c.title).toBe(l === 1 ? "Loading a package this scene uses…" : "Loading 2 packages this scene uses…");
            expect(labels).toEqual([]);
          }
        }
      }
    }
  });

  it("each row carries its URL in full and short, its name if it has one, and its error", () => {
    expect(cardOf({ ask: [e(A, { name: "@example/thing" })], failed: [e(B, { error: "boom" })] }).rows).toEqual([
      { url: A, name: "@example/thing", short: "automerge:2zt6Lbn…R85F", state: "ask" },
      { url: B, name: null, short: "automerge:3aB6Lbn…R85G", state: "failed", error: "boom" },
    ]);
    for (const none of [null, undefined, {}, { ask: [], loading: [], failed: [] }]) expect(cardOf(none)).toBeNull();
  });
});

describe("the card's words", () => {
  it("shortUrl and the prompt's sentence", () => {
    expect(shortUrl(A)).toBe("automerge:2zt6Lbn…R85F");
    expect(shortUrl("automerge:short")).toBe("automerge:short");
    expect(shortUrl(HTTPS)).toBe(HTTPS);
    expect(shortUrl(`https://tools.example.com/${"a".repeat(60)}/index.js`)).toHaveLength(45);
    expect(promptText(1)).toBe("This scene uses a package you don't have.");
    expect(promptText(3)).toBe("This scene uses 3 packages you don't have.");
  });
});
