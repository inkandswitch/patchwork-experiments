// The scene package's layers and the kernel's boundary (STAGE.md, "Words":
// Layer). Checks on the source and the docs, not on behaviour:
//   - every module sits in exactly one layer, its directory's (LAYERS; at
//     src/'s root, only the entry and the kit files), and imports only from
//     its own layer or one below;
//   - every relative import resolves to a file, and every import() names one;
//   - the native services and the editor import from the kernel only its face
//     (stage/public.js), which only re-exports kernel helpers, each used above
//     it: everything else they get is the api they were created with;
//   - the kernel takes time only from stage/time.js;
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
 * Every module's layer: its directory's. At src/'s root are only the entry
 * and the kit files (copied whole into other packages, which find their
 * canonical copy there: scripts/check-kit.mjs), each named.
 *   shared  src/shared/: formats, math and plain data; they know no layer
 *   kernel  src/stage/, src/content/: its rules and machinery, and how an
 *           object's content is drawn
 *   native  the package's own plugins below the editor: the native services
 *           (NATIVE.md) and the sources
 *   editor  the editor's parts (EDITOR.md) and what only they use
 *   entry   what registers the plugins (index.js), and the package's other tool
 */
const LAYERS = {
  directories: { shared: "shared", stage: "kernel", content: "kernel", native: "native", sources: "native", parts: "editor" },
  root: { "glb.js": "shared", "layers.js": "shared", "render-read.js": "shared", "index.js": "entry", "controls-tool.js": "entry" },
};

/** The kernel's face: the one kernel module the layers above it may import. */
const FACE = "stage/public.js";

/** The contract pages and their most lines. */
const PAGES = { "STAGE.md": 200, "API.md": 200, "NATIVE.md": 400, "EDITOR.md": 300, "CONVENTIONS.md": 200 };

/** Other pages whose invariants (C…: README.md, "Content") are named by tests too. */
const LABELLED = ["README.md"];

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

/**
 * A module's code with its comments and the text of its strings blanked (a
 * template's `${…}` kept as code), so a word in a comment or a URL in a
 * string isn't read as code. A regex literal is read as code.
 */
function codeOf(text) {
  let out = "";
  const depth = []; // per open template: the brace depth its current ${ … } began at
  let braces = 0;
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    const n = text[i + 1];
    if (c === "/" && n === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && n === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c && text[i] !== "\n") i += text[i] === "\\" ? 2 : 1;
      i++;
      out += '""';
    } else if (c === "`" || (c === "}" && depth.length && braces === depth.at(-1))) {
      // into a template's text (a backtick, or the } closing a ${ … }), to its end or its next ${
      if (c === "}") depth.pop();
      i++;
      while (i < text.length && text[i] !== "`" && !(text[i] === "$" && text[i + 1] === "{")) i += text[i] === "\\" ? 2 : 1;
      if (text[i] === "$") {
        depth.push(braces);
        braces++;
        i += 2;
      } else i++;
      out += '""';
    } else {
      if (c === "{") braces++;
      if (c === "}") braces--;
      out += c;
      i++;
    }
  }
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
  return rest.length ? LAYERS.directories[top] : LAYERS.root[top];
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
  it("every module is in its directory's layer; at the root, only the named entry and kit files, and each is there", () => {
    expect(modules.length).toBeGreaterThan(100);
    expect(modules.filter((m) => !layerOf(m))).toEqual([]);
    expect(Object.keys(LAYERS.root).filter((m) => !modules.includes(m))).toEqual([]);
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

  // The one clock (API.md, `api`: now, after): what the kernel runs on, and the shared modules it imports,
  // read no page clock and set no page timer; stage/time.js is where the page's are. What this can't see: a
  // name built at run time ("set" + "Timeout"), a regex literal holding a quote or `//` (the code reader below
  // takes those for strings or comments), and what a module it doesn't import (the native services', the
  // editor's) does on the kernel's behalf.
  it("the kernel runs on the stage's one time: no page clock or timer in it, nor in a shared module it imports, but stage/time.js and the stated exceptions", () => {
    const PAGE = /\b(Date\s*\.\s*now|new\s+Date\b|Date\s*\(|performance\s*\.\s*now|setTimeout|setInterval|setImmediate|requestAnimationFrame|requestIdleCallback|AbortSignal\s*\.\s*timeout)\b|\b(globalThis|window|self)\s*\[/g;
    // CPU, not time: the flush and the viewport measure what their work costs, and pick structures are built while the page is idle
    const EXCEPT = { "stage/flush.js": ["performance.now"], "stage/viewport.js": ["performance.now"], "stage/picking.js": ["requestIdleCallback"] };
    const kernel = new Set(modules.filter((m) => layerOf(m) === "kernel"));
    for (let grew = true; grew; ) {
      grew = false;
      for (const { from, to } of edges) if (kernel.has(from) && layerOf(to) === "shared" && !kernel.has(to)) grew = !!kernel.add(to);
    }
    const wrong = [];
    for (const m of kernel) {
      if (m === "stage/time.js") continue;
      for (const hit of codeOf(readFileSync(join(SRC, m), "utf8")).match(PAGE) ?? []) if (!(EXCEPT[m] ?? []).includes(hit.replace(/\s+/g, ""))) wrong.push(`${m}: ${hit}`);
    }
    expect(wrong).toEqual([]);
    expect([...kernel].filter((m) => layerOf(m) === "shared").length).toBeGreaterThan(5); // (it does reach into the shared layer)
  });

  it("each contract page fits: STAGE.md ≤ 200 lines, API.md ≤ 200, NATIVE.md ≤ 400, EDITOR.md ≤ 300, CONVENTIONS.md ≤ 200", () => {
    for (const [page, most] of Object.entries(PAGES)) {
      const lines = readFileSync(join(ROOT, page), "utf8").replace(/\n$/, "").split("\n").length;
      expect(lines, page).toBeLessThanOrEqual(most);
    }
  });

  it("every invariant label the pages list is named by a test's title or the comment directly above it", () => {
    const labels = [...Object.keys(PAGES), ...LABELLED].flatMap((page) => [...readFileSync(join(ROOT, page), "utf8").matchAll(/^\| ([HIC]\d+) \|/gm)].map((m) => m[1]));
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
        for (const m of text.matchAll(/\b([HIC]\d+)\b/g)) named.add(m[1]);
      });
    }
    expect(labels.filter((l) => !named.has(l) && !(l in ELSEWHERE))).toEqual([]);
    // (and one tested here comes off the list)
    expect(Object.keys(ELSEWHERE).filter((l) => named.has(l) || !labels.includes(l))).toEqual([]);
  });
});
