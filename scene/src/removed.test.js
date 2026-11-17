// What the sidebar's change took out stays out (STAGE.md, "The interface", Decisions 16
// to 18): no source file under src/ (its tests aside, which name these only
// to say they're gone) names a removed extension, command, tab, button or
// function. A static check, so a stray reference is caught even where no
// behavioural test reaches it (a probe hook, a CSS rule, a dead branch).
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = dirname(fileURLToPath(import.meta.url));

/** Every source file under src/ that isn't a test: [path relative to src/, text]. */
function sources(dir = SRC, rel = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const name = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...sources(path, name));
    else if (/\.(js|ts|css|html)$/.test(entry.name) && !/\.test\.js$/.test(entry.name)) out.push([name, readFileSync(path, "utf8")]);
  }
  return out;
}

// [what was removed, a pattern for any reference to it]
const REMOVED = [
  ["the scene.outline extension (its registration in index.js)", /["'`]scene\.outline["'`]/],
  ["the toolbar's Objects toggle (command id \"objects\")", /\bid:\s*["']objects["']/],
  ["the Objects drawer tab", /\btitle:\s*["']Objects["']/],
  ["the render controls' Open source button", /\bopen-source\b/],
  ["the inspector's Open file button (a GLB's)", /\bopen-file\b/],
  ["the linked scene's Open button", /\bopen-linked\b/],
  ["About's own Open button (About is a section now)", /\bopen-about\b/],
  ["the inspector's hand-made About, controls and Open file", /\b(fillAbout|mountControls|openFile)\b/],
  ["their classes (About's title, Build's head, the controls' embed), in markup or CSS", /\b(about-title|build-head|controls-embed)\b/],
];

describe("nothing removed by the one pane and its sections is referred to in src/ (9 rows)", () => {
  const files = sources();
  it("reads the package's own sources", () => {
    expect(files.map(([name]) => name)).toEqual(expect.arrayContaining(["index.js", "parts/inspector.js", "parts/outline.js", "controls-tool.js"]));
  });
  it.each(REMOVED)("%s", (_what, pattern) => {
    expect(files.filter(([, text]) => pattern.test(text)).map(([name]) => name)).toEqual([]);
  });
});
