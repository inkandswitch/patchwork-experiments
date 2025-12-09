import { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import { ChatDoc } from "./types";
import { ContactDoc } from "../type";
import { Repo } from "@automerge/automerge-repo";
import { AgentDoc } from "../agent/Agent";

export const ChatDataType: DatatypeImplementation<ChatDoc> = {
  init: (doc: ChatDoc, repo: Repo) => {
    const contactDocHandle = repo.create<ContactDoc>({
      type: "registered",
      name: "Agent",
    });

    const agentDocHandle = repo.create<AgentDoc>({
      contactUrl: contactDocHandle.url,
      modelId: "claude-sonnet-4-0",
    });

    doc.title = "Chat";
    doc.messages = [];
    doc.agentDocUrl = agentDocHandle.url;
  },
  getTitle(doc) {
    return doc.title;
  },

  setTitle(doc: ChatDoc, title: string) {
    doc.title = title;
  },
};
