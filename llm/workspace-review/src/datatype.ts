import { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { WorkspaceDoc } from "./types";

export const WorkspaceDatatype: DatatypeImplementation<WorkspaceDoc> = {
  init: (doc: WorkspaceDoc) => {
    doc["@patchwork"] = { type: "workspace" };
    doc.rootFolderUrl = "" as AutomergeUrl;
    doc.mappings = {};
  },
  getTitle() {
    return "Workspace";
  },
};
