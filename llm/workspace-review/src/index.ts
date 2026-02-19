import { Plugin } from "@inkandswitch/patchwork-plugins";
import type { Repo } from "@automerge/automerge-repo";
import { registerScopedElements } from "./scoped-elements/scoped-elements";

registerScopedElements({ repo: (window as any).repo as Repo });

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "workspace-review",
    name: "Workspace Review",
    icon: "GitPullRequest",
    supportedDatatypes: ["workspace"],
    async load() {
      const { renderWorkspaceReview } = await import("./WorkspaceReviewUI");
      return renderWorkspaceReview;
    },
  },
  {
    type: "patchwork:tool",
    id: "workspace-browser",
    name: "Workspace Browser",
    icon: "FolderOpen",
    supportedDatatypes: ["workspace"],
    async load() {
      const { renderWorkspaceBrowser } = await import("./WorkspaceBrowserUI");
      return renderWorkspaceBrowser;
    },
  },
  {
    type: "patchwork:datatype",
    id: "workspace",
    name: "Workspace",
    icon: "GitPullRequest",
    async load() {
      const { WorkspaceDatatype } = await import("./datatype");
      return WorkspaceDatatype;
    },
  },
];

console.log("workspace-review v12");
