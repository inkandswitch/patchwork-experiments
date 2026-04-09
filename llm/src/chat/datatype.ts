import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { Repo } from "@automerge/automerge-repo";
import type { LLMChatDoc, LLMProcessDoc } from "../types";

const DEFAULT_SYSTEM_PROMPT = `You are a helpful assistant that can execute JavaScript code to accomplish tasks.

To execute code, wrap it in <script> tags:
<script>
// your code here
</script>

You can optionally add a description:
<script data-description="what this script does">
// your code here
</script>`;

export const LLMChatDatatype: DatatypeImplementation<LLMChatDoc> = {
  init(doc: LLMChatDoc, repo: Repo) {
    doc["@patchwork"] = { type: "llm-chat2" };
    doc.title = "LLM Chat 2";
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
      d["@patchwork"] = { type: "llm-process2" };
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
    return doc.title || "LLM Chat 2";
  },
};
