import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";

/**
 * Minimal shape of the `@patchwork/llm` workspace injected into LLM scripts.
 * Defined locally so the card-table module does not take a build-time
 * dependency on the llm package — only this structural contract matters.
 */
export interface Workspace {
  repo: Repo;
  docFolderUrl: AutomergeUrl;
  find<T>(url: AutomergeUrl): Promise<DocHandle<T>>;
  create<T>(options?: { name?: string; type?: string }): Promise<DocHandle<T>>;
  listDocuments(): Promise<{ name: string; type: string; url: AutomergeUrl }[]>;
  loadSkill?(skillId: string): Promise<unknown>;
  getSkillDocumentation?(skillId: string): Promise<string>;
}

export type DocFolderEntry = { name: string; type: string; url: AutomergeUrl };
