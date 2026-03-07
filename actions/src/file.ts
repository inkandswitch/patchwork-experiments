import { type Plugin } from "@inkandswitch/patchwork-plugins";
import { type DocHandle } from "@automerge/automerge-repo";
import { z } from "zod";

type FileDoc = {
  content: string;
};

// View file content
export const viewFileAction: Plugin<any> = {
  type: "patchwork:action",
  id: "file-view",
  name: "View File",
  icon: "Eye",
  supportedDatatypes: ["*"],
  module: {
    isApplicable: () => true,
    default: (handle: DocHandle<FileDoc>) => {
      return handle.doc().content;
    },
  },
};

// Replace file content
export const replaceFileContentAction: Plugin<any> = {
  type: "patchwork:action",
  id: "file-replace-content",
  name: "Replace File Content",
  icon: "FileEdit",
  supportedDatatypes: ["*"],
  module: {
    argsSchema: () => {
      return z.object({
        content: z
          .string()
          .describe("The new content to replace the entire file"),
      });
    },
    isApplicable: () => true,
    default: (
      handle: DocHandle<FileDoc>,
      _repo: any,
      args: { content: string }
    ) => {
      handle.change((doc) => {
        doc.content = args.content;
      });
    },
  },
};

export const fileActions: Plugin<any>[] = [
  viewFileAction,
  replaceFileContentAction,
];
