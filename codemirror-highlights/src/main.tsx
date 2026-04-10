import type { Extension } from "@codemirror/state";
import type {
  LoadablePlugin,
  ToolDescription,
  ToolImplementation,
} from "@inkandswitch/patchwork-plugins";

export const plugins = [
  {
    type: "codemirror:extension",
    id: "codemirror-highlights",
    name: "Custom Highlights",
    supportedDatatypes: "*",
    async load(): Promise<Extension> {
      const { customHighlights } = await import("./extension");
      return customHighlights();
    },
  },
  {
    type: "patchwork:tool",
    id: "codemirror-highlights-debug",
    name: "CodeMirror Highlights Debug",
    supportedDatatypes: ["essay", "markdown"],
    async load(): Promise<ToolImplementation> {
      const { CodeMirrorHighlightsDebugTool } = await import("./debug-tool");
      return CodeMirrorHighlightsDebugTool;
    },
  } satisfies LoadablePlugin<ToolDescription, ToolImplementation>,
] satisfies LoadablePlugin<any>[];
