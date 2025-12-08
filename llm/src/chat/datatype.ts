import { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import { ChatDoc } from "./types";

export const ChatDataType: DatatypeImplementation<ChatDoc> = {
  init: (doc: ChatDoc) => {
    doc.messages = [];
    doc.agentDocUrls = [];
  },
  getTitle(doc: ChatDoc) {
    return "Chat";
  },
};
