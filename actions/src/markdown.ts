import { type Plugin } from "@inkandswitch/patchwork-plugins";
import { type DocHandle } from "@automerge/automerge-repo";
import { z } from "zod";

type Markdown = {
  content: string;
};

export const markdownActions: Plugin<any> = {
  type: "patchwork:action",
  id: "replaceMarkdown",
  name: "Replace Markdown",
  icon: "FileText",
  supportedDataTypes: ["markdown"],
  module: {
    argsSchema: () => {
      return z.object({
        content: z.string().describe("The new markdown content"),
      });
    },
    default: (
      handle: DocHandle<Markdown>,
      _repo: any,
      args: { content: string }
    ) => {
      handle.change((doc) => {
        doc.content = args.content;
      });
    },
  },
};
