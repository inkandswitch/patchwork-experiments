import type { Datatype, Plugin, Tool } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "git-clone",
    name: "Git Clone",
    icon: "GitBranch",
    async load() {
      const { GitCloneDatatype } = await import("./datatype");
      return GitCloneDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:tool",
    id: "git-clone",
    name: "Git Clone",
    icon: "GitBranch",
    supportedDatatypes: ["git-clone"],
    async load() {
      const { GitCloneTool } = await import("./tool");
      return GitCloneTool;
    },
  } satisfies Tool,
];
