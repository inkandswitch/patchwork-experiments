// The scene package's layers and the kernel's boundary (STAGE.md, "Layers").
// Checks on the source and the docs, not on behaviour:
//   - every module sits in exactly one layer (LAYERS: a folder's, or a root
//     module's by name) and imports only from its own layer or one below;
//   - the native services and the editor reach a kernel module only through
//     the allowlist of pure public helpers below: everything else they get
//     is the api they were created with;
//   - each contract page stays within its size;
//   - every invariant label the pages list is named by a test: in its title
//     or in the comment directly above it.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(SRC, "..");

/** The layers, lowest first: a module imports only from its own layer or one below. */
const ORDER = ["shared", "kernel", "native", "editor", "entry"];

/**
 * Every module's layer: its folder's, else (a module at src/'s root) by name.
 *   shared  formats, math and plain data; they know no layer
 *   kernel  src/stage/ and the modules it is built from: its rules and machinery
 *   native  the native services (NATIVE.md)
 *   editor  the editor's parts (EDITOR.md) and what only they use
 *   entry   what registers the plugins, and the package's other tools
 */
const LAYERS = {
  folders: { stage: "kernel", native: "native", parts: "editor", sources: "entry" },
  shared: ["anchors", "build", "carry-rules", "connectors", "datatype", "deps", "dnd", "embed", "file-content", "glb", "groups", "handles", "hierarchy", "icons", "layers", "legend", "ops", "param-form", "per-focus", "providers", "render-read", "shallow", "staleness", "stl", "surface", "transform", "tree-drop", "units"],
  kernel: ["glb-queue", "gltf-content", "key-order", "packages", "pick-accel", "render-manager", "selection", "theme"],
  editor: ["extract", "hold-key", "peers", "touch-keys", "transfer", "undo"],
  entry: ["controls-tool", "index"],
};

/** What a native service or the editor may import from a kernel module, by module: names and why. */
const ALLOW = {
  "stage/bodies.js": { names: ["LOOK", "holding", "pointing"], why: "pure readers of the view value: the Look body, whether a hand of a kind is held, whether a pointing tool is held" },
  "stage/commands.js": { names: ["flatCommands", "commandState", "inHand", "TOO_FAR"], why: "what a command is and whether it applies (STAGE.md, \"Commands\"): every surface and the gears graph ask the kernel's own rule" },
  "stage/paths.js": { names: ["samePath", "parseKey", "elementOf"], why: "the path grammar, pure: how the view names an object across stages (and an owner: whose a held tool is)" },
  "stage/ladder.js": { names: ["restLayer"], why: "what the view's own Escape does now, pure: the Edit hand's escape is it" },
  "stage/pointer.js": { names: ["looksFromEye"], why: "whether the look goes along the eye ray, pure: the use prompt's anchor, the X-ray's look" },
  "stage/provenance.js": { names: ["writers"], why: "who wrote what a path shows, read from the doc's change messages, pure: the X-ray's last writers (STAGE.md, `change`)" },
  "stage/chain.js": { names: ["hitChain", "holdersFor", "chainOrder"], why: "the input chain's order, pure: who holds an object, in the order the chain offers it (the gears graph agrees with the chain by using it)" },
  "key-order.js": { names: ["isTyping", "codeOfKey", "keyOfCode", "nameOfCode", "declaredKeys", "keyLayers", "keyHolder", "reservedBy", "lookChain", "labelOf"], why: "the key order, pure: who reserves a key (the key map resolves after it, the touch pad shows it), how a key is named" },
  "packages.js": { names: ["listedPackages", "packageUrl", "packagesToList"], why: "the packages rule, pure: what an extracted doc lists" },
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

const modules = walk(SRC)
  .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
  .map((f) => relative(SRC, f))
  .filter((m) => !m.startsWith("test/"));
/** A module's layer (undefined: none). */
function layerOf(m) {
  const [top, ...rest] = m.split("/");
  if (rest.length) return LAYERS.folders[top];
  const name = top.replace(/\.js$/, "");
  return ORDER.find((l) => LAYERS[l]?.includes(name));
}
const rank = (m) => ORDER.indexOf(layerOf(m));
/** Every import of one module by another: `{ from, to, names }`, as paths under src/. */
const edges = modules.flatMap((from) =>
  importsOf(readFileSync(join(SRC, from), "utf8"))
    .map(({ spec, names }) => ({ spec: spec.split("?")[0], names }))
    .filter(({ spec }) => spec.startsWith(".") && spec.endsWith(".js"))
    .map(({ spec, names }) => ({ from, to: relative(SRC, resolve(dirname(join(SRC, from)), spec)), names })),
);
/** A module of a layer above the kernel (a native service, the editor, an entry). */
const aboveKernel = (m) => rank(m) > ORDER.indexOf("kernel");

describe("the layers and the kernel's boundary", () => {
  it("every module is in exactly one layer, and every root module the table names exists", () => {
    expect(modules.length).toBeGreaterThan(100);
    expect(modules.filter((m) => !layerOf(m))).toEqual([]);
    const named = ORDER.flatMap((l) => LAYERS[l] ?? []);
    expect(named.length).toBe(new Set(named).size);
    const roots = new Set(modules.filter((m) => !m.includes("/")).map((m) => m.replace(/\.js$/, "")));
    expect(named.filter((n) => !roots.has(n))).toEqual([]);
  });

  it("imports go one way: from a module's own layer or one below, never above", () => {
    expect(edges.filter(({ from, to }) => rank(to) > rank(from)).map(({ from, to }) => `${from} (${layerOf(from)}) → ${to} (${layerOf(to)})`)).toEqual([]);
  });

  it("the native services and the editor import from the kernel only the allowlisted pure helpers", () => {
    const wrong = [];
    for (const { from, to, names } of edges) {
      if (!aboveKernel(from) || layerOf(to) !== "kernel" || layerOf(from) === "entry") continue;
      const allowed = ALLOW[to]?.names ?? [];
      const bad = names == null ? ["(default, namespace or dynamic)"] : names.filter((n) => !allowed.includes(n));
      if (bad.length) wrong.push(`${from}: ${bad.join(", ")} from ${to}`);
    }
    expect(wrong).toEqual([]);
  });

  it("every allowlisted helper exists and is still imported (the list never outlives its use)", () => {
    const used = new Set(edges.filter(({ from }) => aboveKernel(from) && layerOf(from) !== "entry").flatMap(({ to, names }) => (names ?? []).map((n) => `${to}:${n}`)));
    for (const [mod, { names, why }] of Object.entries(ALLOW)) {
      expect(why.length).toBeGreaterThan(0);
      expect(layerOf(mod), mod).toBe("kernel");
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
