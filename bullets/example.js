// Example document for fresh accounts (aggregated into the bundle's init.js):
// a small outline with some nesting to play with. Standalone: builds the doc
// shape inline (mirrors the bullets datatype init, schemaVersion 1) instead of
// going through the plugin registry.

export default async function example(repo) {
  const id = () => crypto.randomUUID();
  const node = (content, children = [], extra = {}) => ({
    content,
    starred: false,
    children,
    ...extra,
  });

  const rootId = id();
  const welcome = id();
  const tryThis = id();
  const indent = id();
  const collapse = id();
  const star = id();
  const done = id();
  const whyOutlines = id();
  const oneBigList = id();
  const shape = id();

  const handle = await repo.create2({
    "@patchwork": {
      type: "bullets",
      suggestedImportUrl: new URL("./dist/main.js", import.meta.url).href,
    },
    schemaVersion: 1,
    title: "Bullets",
    rootId,
    nodes: {
      [rootId]: node("", [welcome, tryThis, whyOutlines]),
      [welcome]: node("Welcome — this is an outline. Every line is a bullet."),
      [tryThis]: node("Things to try", [indent, collapse, star, done]),
      [indent]: node("Press Tab to indent a bullet, Shift-Tab to bring it back"),
      [collapse]: node("Click the dot next to a bullet with children to collapse it"),
      [star]: node("Star a bullet to pin it"),
      [done]: node("Check something off", [], { completed: true }),
      [whyOutlines]: node("Why outlines?", [oneBigList, shape]),
      [oneBigList]: node("Everything is one big list — details tuck under headlines"),
      [shape]: node("Reorganising the list is reorganising your thinking"),
    },
  });

  return { name: "Bullets", type: "bullets", url: handle.url };
}
