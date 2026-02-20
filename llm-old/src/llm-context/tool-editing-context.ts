import { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import outdent from "outdent";
import type { LLMContextPlugin } from "./types";

const TOOL_EDITING_PROMPT = outdent`

## Writing / Editing Patchwork Tools

Tools are written in **plain JavaScript** (no build step required). A tool file exports a \`plugins\` array containing plugin definitions.

### Plugin Types

**\`patchwork:datatype\`** - Defines a new document type with its schema and methods:

\`\`\`javascript
export const MyDatatype = {
  init(doc) {
    // Initialize document fields
    doc.title = "Untitled";
    doc.items = [];
  },
  getTitle(doc) {
    return doc.title;
  },
  setTitle(doc, title) {
    doc.title = title;
  },
  markCopy(doc) {
    doc.title = "Copy of " + this.getTitle(doc);
  },
};
\`\`\`

**\`patchwork:tool\`** - Provides a UI viewer/editor for a datatype:

\`\`\`javascript
export function Tool(handle, element) {
  // handle.doc() - get current document state
  // handle.change(fn) - modify document (fn receives mutable doc)
  // handle.on("change", callback) - subscribe to changes
  // handle.off("change", callback) - unsubscribe

  function render() {
    const doc = handle.doc();
    if (!doc) return;
    element.innerHTML = ""; // Clear and re-render
    // Build your UI using DOM APIs
  }

  render();
  handle.on("change", render);

  // Return cleanup function
  return () => {
    handle.off("change", render);
  };
}
\`\`\`

### Plugin Export Structure

\`\`\`javascript
export const plugins = [
  {
    type: "patchwork:datatype",
    id: "my-tool",           // Unique identifier
    name: "My Tool",         // Display name
    icon: "FileText",        // Lucide icon name
    async load() {
      return MyDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "my-tool",
    name: "My Tool",
    icon: "FileText",
    supportedDatatypes: ["my-tool"],  // Which datatypes this tool can display
    async load() {
      return Tool;
    },
  },
];
\`\`\`

### Key Points

- Use vanilla DOM APIs (createElement, appendChild, event listeners)
- Styles can be injected via a \`<style>\` element
- The Tool function receives an automerge doc handle and a DOM element to render into
- Always return a cleanup function that removes listeners and DOM elements
- Document changes are made inside \`handle.change()\` with a mutable draft
- Don't show code to the user, if you need to write down some code to think it throught put it in a <thinking> tag.
`;

async function getToolEditingPrompt(
  agentDocUrl: AutomergeUrl,
  repo: Repo
): Promise<string> {
  return TOOL_EDITING_PROMPT;
}

export const toolEditingContextPlugin: LLMContextPlugin = {
  id: "llm-context:tool-editing",
  name: "Tool Editing Context",
  type: "patchwork:llm-context",
  module: {
    prompt: getToolEditingPrompt,
  },
};
