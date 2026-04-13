import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";

export type ScriptBlock = {
  type: "script";
  code: string;
  description?: string;
  output?: string;
  error?: string;
};

export type TextBlock = {
  type: "text";
  text: string;
};

export type ImageBlock = {
  type: "image";
  url: string;
};

export type ContentBlock = TextBlock | ImageBlock | ScriptBlock;

export type Message = {
  role: "system" | "user" | "assistant";
  content: string | ContentBlock[];
};

export type ParsedBlock =
  | { index: number; type: "text"; content: string; complete: boolean }
  | { index: number; type: "script"; code: string; description?: string; complete: boolean };

export type LLMProcessDoc = {
  "@patchwork": { type: "llm-process" };
  title: string;
  model: string;
  systemPrompt: string;
  docFolderUrl: AutomergeUrl;
  skills?: string[];
  messages: Message[];
  running?: boolean;
};

export type LLMChatDoc = {
  "@patchwork": { type: "llm-chat" };
  title: string;
  model: string;
  docFolderUrl: AutomergeUrl;
  skills?: string[];
  processUrl: AutomergeUrl;
};

export interface Workspace {
  repo: Repo;
  docFolderUrl: AutomergeUrl;
  loadSkill(skillId: string): Promise<any>;
  getSkillDocumentation(skillId: string): Promise<string>;
  find<T>(url: AutomergeUrl): Promise<DocHandle<T>>;
  create<T>(options?: { name?: string; type?: string }): Promise<DocHandle<T>>;
  listDocuments(): Promise<{ name: string; type: string; url: AutomergeUrl }[]>;
}
