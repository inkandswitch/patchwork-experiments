/**
 * Plugin registration — metadata only.
 *
 * Patchwork evaluates this module inside a Web Worker with no importmap and
 * structured-clones every plugin entry to the main thread, so nothing here may
 * be a function except `load()`, and nothing in this file's static import graph
 * may reference a bare specifier. Every implementation is behind a dynamic
 * `import()` inside its own `load()`.
 */

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "agent-session",
    name: "Agent Session",
    icon: "Bot",
    async load() {
      return (await import("./datatype.js")).AgentSessionDatatype
    },
  },

  {
    // The full-window view: transcript beside a live view of the subject.
    type: "patchwork:tool",
    id: "agent-session",
    name: "Agent",
    icon: "Bot",
    supportedDatatypes: ["agent-session"],
    async load() {
      const { AgentTool } = await import("./tool.js")
      return (handle, element) => AgentTool(handle, element, { mode: "full" })
    },
  },

  {
    // The sidebar panel: attaches to whatever document you are looking at.
    type: "patchwork:component",
    id: "agent-panel",
    name: "Agent",
    icon: "Bot",
    tags: ["context-tool"],
    async load() {
      const { AgentPanel } = await import("./panel.js")
      return (element) => AgentPanel(element, { mode: "panel" })
    },
  },
]
