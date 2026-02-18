import { Plugin } from "@inkandswitch/patchwork-plugins";

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

console.log("workspace-review v9");
