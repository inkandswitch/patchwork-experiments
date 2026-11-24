// The scene package's layers and the kernel's boundary (STAGE.md, "Words":
// Layer). Checks on the source and the docs, not on behaviour:
//   - every module sits in exactly one layer (LAYERS: a folder's, or a root
//     module's by name: the one layer that uses it, or shared when several
//     do) and imports only from its own layer or one below;
//   - every relative import resolves to a file, and every import() names one;
//   - the native services and the editor import from the kernel only its face
//     (stage/public.js), which only re-exports kernel helpers, each used above
//     it: everything else they get is the api they were created with;
//   - each contract page stays within its size;
//   - every invariant label the pages list is named by a test: in its title
//     or in the comment directly above it.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(SRC, "..");

/** The layers, lowest first: a module imports only from its own layer or one below. */
const ORDER = ["shared", "kernel", "native", "editor", "entry"];

/**
 * Every module's layer: its folder's, else (a module at src/'s root) by name.
 * A root module is in the one layer that uses it, or shared when several
 * layers (or a shared module) use it: checked below.
 *   shared  formats, math and plain data; they know no layer
 *   kernel  src/stage/ and the modules it is built from: its rules and machinery
 *   native  the package's own plugins below the editor: the native services
 *           (NATIVE.md) and the sources (src/sources/)
 *   editor  the editor's parts (EDITOR.md) and what only they use
 *   entry   what registers the plugins (index.js), and the package's other tool
 */
const LAYERS = {
  folders: { stage: "kernel", native: "native", sources: "native", parts: "editor" },
  shared: ["build", "connectors", "datatype", "deps", "dnd", "embed", "file-content", "glb", "groups", "hierarchy", "icons", "layers", "ops", "param-form", "per-focus", "providers", "render-read", "shallow", "staleness", "transform", "tree-drop", "units"],
  kernel: ["glb-queue", "gltf-content", "key-order", "packages", "pick-accel", "render-manager", "selection", "theme"],
  native: ["stl"],
  editor: ["anchors", "carry-rules", "extract", "handles", "hold-key", "legend", "peers", "surface", "touch-keys", "transfer", "undo"],
  entry: ["controls-tool", "index"],
};

/** The kernel's face: the one kernel module the layers above it may import. */
const FACE = "stage/public.js";

/** The contract pages and their most lines. */
const PAGES = { "STAGE.md": 200, "API.md": 200, "NATIVE.md": 400, "EDITOR.md": 300, "CONVENTIONS.md": 200 };

/** Invariants whose tests live in another package (they need its processes), with where. */
const ELSEWHERE = {
  H8: "a pause at every frame of a real act: tabletop/src/dice/h8.test.js, joints/src/slide.test.js",
};

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

/**
 * Every import of a module's source: `{ spec, names }` (names null: a
 * default, namespace or dynamic import; spec null: an import() of something
 * other than a string literal, its argument as `expr`).
 */
function importsOf(text) {
  const out = [];
  for (const m of text.matchAll(/^\s*(?:import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']/gm)) {
    const braces = /^\{([^}]*)\}$/s.exec(m[1].trim());
    const names = braces ? braces[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean) : null;
    out.push({ spec: m[2], names });
  }
  for (const m of text.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) out.push({ spec: m[1], names: null });
  for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push({ spec: m[1], names: null });
  for (const m of text.matchAll(/\bimport\(\s*(?!["'][^"'`]*["']\s*\))([^)]*)\)/g)) out.push({ spec: null, names: null, expr: m[1].trim() });
  return out;
}

/** A relative spec of module `from` as a path under src/ (".js" added when it names no file), or null when it names none. */
function resolveSpec(from, spec) {
  const p = resolve(dirname(join(SRC, from)), spec.split("?")[0]);
  for (const f of [p, `${p}.js`]) if (existsSync(f) && statSync(f).isFile()) return relative(SRC, f);
  return null;
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
/** Every relative import of every module: `{ from, spec, to, names, expr? }`, `to` a path under src/, or null: no file (or `expr`, no literal). */
const imports = modules.flatMap((from) =>
  importsOf(readFileSync(join(SRC, from), "utf8"))
    .filter(({ spec }) => spec == null || spec.startsWith("."))
    .map((i) => ({ ...i, from, to: i.spec == null ? null : resolveSpec(from, i.spec) })),
);
/** The imports of one module by another. */
const edges = imports.filter(({ to }) => to?.endsWith(".js"));
/** A native service or a module of the editor (the entry wires everything). */
const aboveKernel = (m) => rank(m) > ORDER.indexOf("kernel") && layerOf(m) !== "entry";

describe("the layers and the kernel's boundary", () => {
  it("every module is in exactly one layer, and every root module the table names exists", () => {
    expect(modules.length).toBeGreaterThan(100);
    expect(modules.filter((m) => !layerOf(m))).toEqual([]);
    const named = ORDER.flatMap((l) => LAYERS[l] ?? []);
    expect(named.length).toBe(new Set(named).size);
    const roots = new Set(modules.filter((m) => !m.includes("/")).map((m) => m.replace(/\.js$/, "")));
    expect(named.filter((n) => !roots.has(n))).toEqual([]);
  });

  it("a root module is in the one layer that uses it, or shared when several layers (or a shared module) use it", () => {
    const wrong = [];
    for (const m of modules.filter((x) => !x.includes("/") && layerOf(x) !== "entry")) {
      const users = new Set(edges.filter(({ to }) => to === m).map(({ from }) => layerOf(from)));
      const ok = layerOf(m) === "shared" ? users.size > 1 || users.has("shared") : [...users].every((l) => l === layerOf(m));
      if (!ok) wrong.push(`${m} (${layerOf(m)}) is used by ${[...users].join(", ") || "nothing"}`);
    }
    expect(wrong).toEqual([]);
  });

  it("every relative import resolves to a file, and every import() names its module by a string literal", () => {
    expect(imports.filter(({ to }) => to == null).map(({ from, spec, expr }) => `${from}: ${spec ?? `import(${expr})`}`)).toEqual([]);
  });

  it("imports go one way: from a module's own layer or one below, never above", () => {
    expect(edges.filter(({ from, to }) => rank(to) > rank(from)).map(({ from, to }) => `${from} (${layerOf(from)}) → ${to} (${layerOf(to)})`)).toEqual([]);
  });

  it("the native services and the editor import from the kernel only its face, and by name", () => {
    const wrong = edges.filter(({ from, to, names }) => aboveKernel(from) && layerOf(to) === "kernel" && (to !== FACE || names == null));
    expect(wrong.map(({ from, to }) => `${from} → ${to}`)).toEqual([]);
  });

  it("the face only re-exports, by name, from kernel modules, and every name it offers is imported above the kernel (it never outlives its use)", () => {
    const text = readFileSync(join(SRC, FACE), "utf8");
    // nothing but comments and `export { … } from` lines
    expect(text.replace(/^\/\/.*$/gm, "").replace(/^export \{[^}]*\} from "[^"]+";$/gm, "").trim()).toBe("");
    const offered = importsOf(text).flatMap(({ spec, names }) => {
      expect(names, spec).not.toBeNull();
      expect(layerOf(resolveSpec(FACE, spec)), spec).toBe("kernel");
      return names;
    });
    expect(offered.length).toBe(new Set(offered).size);
    const used = new Set(edges.filter(({ from, to }) => aboveKernel(from) && to === FACE).flatMap(({ names }) => names ?? []));
    expect(offered.filter((n) => !used.has(n))).toEqual([]);
  });

  it("each contract page fits: STAGE.md ≤ 200 lines, API.md ≤ 200, NATIVE.md ≤ 400, EDITOR.md ≤ 300, CONVENTIONS.md ≤ 200", () => {
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
