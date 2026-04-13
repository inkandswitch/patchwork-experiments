import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { Repo } from "@automerge/automerge-repo";
import type { LLMChatDoc, LLMProcessDoc } from "../types";
import INSTRUCTIONS from "../INSTRUCTIONS.md?raw";

const CHAT_PREAMBLE = `You are a helpful assistant in a chat interface. Be concise and friendly.`;

const DEFAULT_SYSTEM_PROMPT = `${CHAT_PREAMBLE}\n\n${INSTRUCTIONS}`;

export const LLMChatDatatype: DatatypeImplementation<LLMChatDoc> = {
  init(doc: LLMChatDoc, repo: Repo) {
    doc["@patchwork"] = { type: "llm-chat" };
    doc.title = "LLM Chat";
    doc.model = "anthropic/claude-sonnet-4.6";

    const folderHandle = repo.create<any>();
    folderHandle.change((d: any) => {
      d["@patchwork"] = { type: "folder" };
      d.title = "Documents";
      d.docs = [];
    });
    doc.docFolderUrl = folderHandle.url;

    const processHandle = repo.create<LLMProcessDoc>();
    processHandle.change((d) => {
      d["@patchwork"] = { type: "llm-process" };
      d.title = "Chat Process";
      d.model = doc.model;
      d.systemPrompt = DEFAULT_SYSTEM_PROMPT;
      d.docFolderUrl = doc.docFolderUrl;
      if (doc.skills) d.skills = doc.skills;
      d.messages = [];
      d.done = false;
    });
    doc.processUrl = processHandle.url;
  },

  getTitle(doc: LLMChatDoc) {
    return doc.title || "LLM Chat";
  },
};
