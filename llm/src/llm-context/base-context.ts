import { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import { FolderDoc } from "@inkandswitch/patchwork-filesystem";
import outdent from "outdent";
import { createDocOfDatatype } from "../lib";
import { AgentDoc } from "../agent/agent";
import type { LLMContextPlugin } from "./types";

const AGENT_MD_NAME = "agent.md";

type MarkdownDoc = {
  content: string;
  title?: string;
  "@patchwork"?: { type: string };
};

const DEFAULT_SYSTEM_PROMPT = outdent`
You are an AI assistant helping to edit multiple documents by invoking actions on them.

You have access to multiple documents simultaneously. Each document has its own set of available actions based on its type.

When the user asks for changes, follow these steps:
- Identify which document(s) the request applies to
- Review the available actions for those documents and their arguments
- Determine which action(s) would accomplish the user's goal
- You can use <thinking> tags to reason about your approach (these will be shown to the user)
- Use <action> tags to execute actions
- If you are missing information tell the user instead of guessing.
- If an action requires a specific value you don't know (e.g., an ID, a reference), use a query action to find it first. NEVER guess IDs or other specific values.

**IMPORTANT: Actions with return values**

Some actions return a value (e.g., reading data, querying information). When you invoke an action that returns a value:
- This MUST be the last action in your response
- Do NOT invoke any other actions after it
- Stop and wait to be prompted again
- In the next prompt, you will receive the result of that action and can continue from there

This is critical because you cannot see the return value immediately - it will only be available in the subsequent prompt after the action is executed.

Response format:

\`\`\`
<thinking description="short summary">
Your reasoning about what actions to take and why
</thinking>
\`\`\`


\`\`\`
<action description="short description">
{
  "id": "action-id",
  "target": "automerge:url",
  "args": {
    "argName": "value"
  }
}
</action>
\`\`\`

`;

async function getSystemPrompt(
  agentDocUrl: AutomergeUrl,
  repo: Repo
): Promise<string> {
  const agentDocHandle = await repo.find<AgentDoc>(agentDocUrl);
  const agentDoc = agentDocHandle.doc();
  const { contextFolderUrl } = agentDoc;

  const folderHandle = await repo.find<FolderDoc>(contextFolderUrl);
  const folderDoc = folderHandle.doc();

  if (!folderDoc) {
    return DEFAULT_SYSTEM_PROMPT;
  }

  // Find the agent.md document
  const agentMdRef = folderDoc.docs.find(
    (doc) => doc.type === "markdown" && doc.name === AGENT_MD_NAME
  );

  if (!agentMdRef) {
    return DEFAULT_SYSTEM_PROMPT;
  }

  const mdDocHandle = await repo.find<MarkdownDoc>(agentMdRef.url);
  const mdDoc = mdDocHandle.doc();

  return mdDoc?.content || DEFAULT_SYSTEM_PROMPT;
}

async function initSystemContext(
  agentDocUrl: AutomergeUrl,
  repo: Repo
): Promise<void> {
  const agentDocHandle = await repo.find<AgentDoc>(agentDocUrl);
  const agentDoc = agentDocHandle.doc();
  const { contextFolderUrl } = agentDoc;

  const folderHandle = await repo.find<FolderDoc>(contextFolderUrl);
  const folderDoc = folderHandle.doc();

  if (!folderDoc) {
    return;
  }

  // Check if agent.md already exists
  const existingAgentMd = folderDoc.docs.find(
    (doc) => doc.type === "markdown" && doc.name === AGENT_MD_NAME
  );

  if (existingAgentMd) {
    return; // Already exists
  }

  // Create the agent.md document
  const mdHandle = await createDocOfDatatype<MarkdownDoc>("markdown", repo);
  mdHandle.change((doc) => {
    doc.content = DEFAULT_SYSTEM_PROMPT;
    doc.title = AGENT_MD_NAME;
  });

  // Add to folder
  folderHandle.change((doc) => {
    doc.docs.push({
      url: mdHandle.url,
      name: AGENT_MD_NAME,
      type: "markdown",
    });
  });
}

export const systemContextPlugin: LLMContextPlugin = {
  id: "llm-context:system",
  name: "System Prompt",
  type: "patchwork:llm-context",
  module: {
    prompt: getSystemPrompt,
    init: initSystemContext,
  },
};
