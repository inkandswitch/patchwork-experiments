import type {
  Plugin,
  ToolImplementation,
} from "@inkandswitch/patchwork-plugins";
import type { FolderDoc } from "@inkandswitch/patchwork-filesystem";
import { render } from "solid-js/web";
import type { AccountLikeDoc } from "./types";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "folder-tree-view",
    tags: ["sidebar-account"],
    name: "Folder Tree View",
    icon: "FolderTree",
    supportedDatatypes: ["folder", "account", "patchwork:account"],
    async load(): Promise<ToolImplementation<AccountLikeDoc | FolderDoc>> {
      const { FolderTreeView } = await import("./FolderTreeView");
      return (handle, element) => {
        return render(
          () => (
            <FolderTreeView
              handle={handle}
              repo={element.repo}
              element={element}
            />
          ),
          element,
        );
      };
    },
  },
];
