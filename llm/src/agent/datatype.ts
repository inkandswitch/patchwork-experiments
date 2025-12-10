import { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import { type DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import { ContactDoc } from "../type";

// Agent document schema
export type AgentDoc = {
  contactUrl: AutomergeUrl;
  modelId: string;
  chatDocUrl?: AutomergeUrl;
  contextFolderUrl: AutomergeUrl;
};

export const AgentDataType: DatatypeImplementation<AgentDoc> = {
  init(doc: AgentDoc, repo: Repo) {
    const contactDocHandle = repo.create<ContactDoc>({
      type: "registered",
      name: "Agent",
    });
    doc.contactUrl = contactDocHandle.url;
    doc.modelId = "claude-sonnet-4-0";
  },
  getTitle() {
    return "Agent";
  },
};
