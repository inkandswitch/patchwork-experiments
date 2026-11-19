// The kernel's boundary (STAGE.md; PLANS.md section 1, decided: native plugins
// stay in scene/, under a lint rule). Three checks on the source and the docs,
// not on behaviour:
//   - every module in src/native/ and src/parts/ reaches the kernel
//     (src/stage/) only through the explicit allowlist of pure public helpers
//     below: everything else it gets is the api it was created with;
//   - each contract page stays within its size;
//   - every invariant label the pages list is named by a test: in its title
//     or in the comment directly above it.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(SRC, "..");

/** What a native plugin or an editor part may import from src/stage/, by module: names and why. */
const ALLOW = {
  "stage/bodies.js": { names: ["LOOK", "EDIT_HAND", "editing", "inBody"], why: "pure readers of the view value: the Look body, the Edit hand's name, whether editing, whether a command applies" },
  "stage/paths.js": { names: ["samePath", "keyOf", "elementOf"], why: "the path grammar, pure: how the view names an object across stages" },
  "stage/ladder.js": { names: ["restLayer"], why: "what the view's own Escape does now, pure: the Edit hand's escape is it" },
  "stage/pointer.js": { names: ["looksFromEye"], why: "whether the look goes along the eye ray, pure: the use prompt's anchor" },
  "stage/provenance.js": { names: ["writers"], why: "who wrote what a path shows, read from the doc's change messages, pure: the X-ray's last writers (STAGE.md, `change`)" },
  "stage/chain.js": { names: ["hitChain", "holdersFor", "chainOrder"], why: "the input chain's order, pure: who holds an object, in the order the chain offers it (the gears graph agrees with the chain by using it)" },
};

/** The contract pages and their most lines. */
const PAGES = { "STAGE.md": 200, "NATIVE.md": 400, "EDITOR.md": 300, "CONVENTIONS.md": 200 };

/** Invariants whose tests live in another package (they need its processes), with where. */
const ELSEWHERE = {
  H8: "a pause at every frame of a real act: tabletop/src/dice/h8.test.js, joints/src/slide.test.js",
};

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

/** Every import of a module's source: `{ spec, names }` (names null: a default, namespace or dynamic import). */
function importsOf(text) {
  const out = [];
  for (const m of text.matchAll(/^\s*(?:import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']/gm)) {
    const braces = /^\{([^}]*)\}$/s.exec(m[1].trim());
    const names = braces ? braces[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean) : null;
    out.push({ spec: m[2], names });
  }
  for (const m of text.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) out.push({ spec: m[1], names: null });
  for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push({ spec: m[1], names: null });
  return out;
}

describe("the kernel's boundary", () => {
  it("native plugins and the editor's parts import from src/stage/ only the allowlisted pure helpers", () => {
    const modules = ["native", "parts"].flatMap((d) => walk(join(SRC, d))).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"));
    expect(modules.length).toBeGreaterThan(40);
    const wrong = [];
    for (const f of modules) {
      for (const { spec, names } of importsOf(readFileSync(f, "utf8"))) {
        if (!spec.startsWith(".")) continue;
        const to = relative(SRC, resolve(dirname(f), spec.split("?")[0]));
        if (!to.startsWith("stage/")) continue;
        const allowed = ALLOW[to]?.names ?? [];
        const bad = names == null ? ["(default, namespace or dynamic)"] : names.filter((n) => !allowed.includes(n));
        if (bad.length) wrong.push(`${relative(SRC, f)}: ${bad.join(", ")} from ${to}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("every allowlisted helper exists and is still imported (the list never outlives its use)", () => {
    const used = new Set(
      ["native", "parts"]
        .flatMap((d) => walk(join(SRC, d)))
        .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
        .flatMap((f) => importsOf(readFileSync(f, "utf8")).flatMap(({ spec, names }) => (names ?? []).map((n) => `${relative(SRC, resolve(dirname(f), spec))}:${n}`))),
    );
    for (const [mod, { names, why }] of Object.entries(ALLOW)) {
      expect(why.length).toBeGreaterThan(0);
      const text = readFileSync(join(SRC, mod), "utf8");
      for (const n of names) {
        expect(text, `${mod} exports ${n}`).toMatch(new RegExp(`export (const|function) ${n}\\b`));
        expect(used.has(`${mod}:${n}`), `${mod}:${n} is imported`).toBe(true);
      }
    }
  });

  it("each contract page fits: STAGE.md ≤ 200 lines, NATIVE.md ≤ 400, EDITOR.md ≤ 300, CONVENTIONS.md ≤ 200", () => {
    for (const [page, most] of Object.entries(PAGES)) {
      const lines = readFileSync(join(ROOT, page), "utf8").replace(/\n$/, "").split("\n").length;
      expect(lines, page).toBeLessThanOrEqual(most);
    }
  });

  it("every invariant label the pages list is named by a test's title or the comment directly above it", () => {
    const labels = Object.keys(PAGES).flatMap((page) => [...readFileSync(join(ROOT, page), "utf8").matchAll(/^\| ([HI]\d+) \|/gm)].map((m) => m[1]));
    expect(new Set(labels).size).toBe(labels.length); // each listed once, on one page
    const named = new Set();
    const TITLE = /^\s*(describe|it|test)(\.\w+)*\s*\(/;
    const COMMENT = /^\s*(\/\/|\/\*|\*)/;
    for (const f of walk(SRC).filter((x) => x.endsWith(".test.js"))) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!TITLE.test(line)) return;
        let text = line;
        for (let j = i - 1; j >= 0 && COMMENT.test(lines[j]); j--) text += `\n${lines[j]}`;
        for (const m of text.matchAll(/\b([HI]\d+)\b/g)) named.add(m[1]);
      });
    }
    expect(labels.filter((l) => !named.has(l) && !(l in ELSEWHERE))).toEqual([]);
    // (and one tested here comes off the list)
    expect(Object.keys(ELSEWHERE).filter((l) => named.has(l) || !labels.includes(l))).toEqual([]);
  });
});
