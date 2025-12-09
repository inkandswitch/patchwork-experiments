import { Repo } from "@automerge/automerge-repo";
import { type DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import { ContactDoc } from "../type";
import { type AgentDoc } from "./Agent";

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
