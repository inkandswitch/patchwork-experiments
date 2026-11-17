/**
 * Plugin registration — metadata only.
 *
 * Patchwork evaluates this module inside a Web Worker with no importmap and
 * structured-clones every plugin entry to the main thread, so nothing here may
 * be a function except `load()`, and this file imports nothing at all: every
 * implementation is behind a dynamic `import()` inside its own `load()`, which
 * also keeps the entry loadable straight from an automerge: URL.
 *
 * The `agent:tool` entry carries its description and schema as plain JSON,
 * because the agent reads them before it loads anything; they repeat what
 * web-capture.js defines, and index.test.js holds the copies equal.
 */

export const plugins = [
  {
    // A page kept as it looked. Made empty in any folder, filled by a capture.
    type: "patchwork:datatype",
    id: "web-snapshot",
    name: "Web Snapshot",
    icon: "Globe",
    async load() {
      return (await import("./snapshot/datatype.js")).WebSnapshotDatatype
    },
  },
  {
    // A kept page, shown inert: no script runs and nothing is fetched. An
    // empty one is where a person captures a page into it.
    type: "patchwork:tool",
    id: "web-snapshot",
    name: "Web Snapshot",
    icon: "Globe",
    supportedDatatypes: ["web-snapshot"],
    async load() {
      const { SnapshotView } = await import("./snapshot/view.js")
      return (handle, element) => SnapshotView(handle, element)
    },
  },
  {
    // The capture pipeline, handed to the agent.
    type: "agent:tool",
    id: "web_capture",
    name: "Keep a web page",
    where: "worker",
    risk: "external",
    // This tool works only through the context it is handed: it fetches
    // through ctx.fetchImpl (a guarded fetch, without which it refuses to
    // run) and writes through ctx.repo.create2(), and reaches for no global,
    // no platform fetch and no host module. Saying so lets the agent give it
    // to a research step, with that step's confined context and nothing more.
    scoped: true,
    description:
      "Keep a web page as it looks: the page as rendered, frozen so that nothing in it runs, with every stylesheet, font and image that can be fetched from here, in one web-snapshot document that opens later exactly as captured, offline. Use it when the page itself is the evidence — a datasheet, a price, a statement that may change — or the person wants to keep it. To read what a page says, web_fetch is cheaper.\n\nThe result says what was kept and what was not, and why. The snapshot's text is read with source_read like any kept source. A PDF or other file is kept as the file it is.\n\nA URL whose snapshot is already kept here answers from it; pass `again` for a new one.",
    input_schema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", description: "Absolute http(s) URL of the page." },
        again: { type: "boolean", description: "Capture again even if a snapshot of the page is already kept here." },
        render: {
          type: "boolean",
          description: "Outside a browser only: false keeps the raw HTML the server sent (the page before its scripts ran) instead of the reader's rendering. Default true.",
        },
        maxBytes: { type: "number", description: "The most to keep, page and resources together. Default and maximum 19.1 MB." },
      },
    },
    async load() {
      return (await import("./web-capture.js")).webCapture
    },
  },
]
