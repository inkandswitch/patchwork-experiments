import { DocHandle, Repo } from "@automerge/automerge-repo";
import { SYSTEM_PROMPT } from "./system";
import { getActionsContextPrompt } from "./actions-context";
import { type AgentDoc } from "../Agent";

export async function getSystemPrompts(
  agentDocHandle: DocHandle<AgentDoc>,
  repo: Repo
): Promise<string[]> {
  return await Promise.all([
    SYSTEM_PROMPT,
    getActionsContextPrompt(agentDocHandle, repo),
  ]);
}
