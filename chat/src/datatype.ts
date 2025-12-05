import { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import { ChatDocument } from "./types";

export const ChatDataType: DatatypeImplementation<ChatDocument> = {
  init: (doc: ChatDocument) => {
    doc.messages = [];
    doc.agentDocUrls = [];
  },
  getTitle(doc: ChatDocument) {
    return "Chat";
  },
};
