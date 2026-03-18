declare module '@patchwork/llm' {
  import type { Repo } from '@automerge/automerge-repo';
  import type { AutomergeUrl } from '@automerge/automerge-repo';

  export type ContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } };

  export type ChatMessage = {
    role: 'system' | 'user' | 'assistant';
    content: string | ContentPart[];
  };

  export type OutputBlock =
    | { type: 'text'; content: string }
    | { type: 'script'; code: string; description?: string; output?: string; error?: string };

  export type LLMDoc = {
    '@patchwork': { type: 'llm' };
    config: { apiUrl: string; model: string };
    workspaceUrl?: AutomergeUrl;
    systemPrompt?: string;
    prompt: string;
    output: OutputBlock[];
    previousMessages?: ChatMessage[];
    done?: boolean;
  };

  export type LLMWorkspaceDoc = {
    '@patchwork': { type: 'llm-workspace' };
    title: string;
    urls: AutomergeUrl[];
  };

  export function runLLMProcess(
    repo: Repo,
    processDocUrl: AutomergeUrl,
    signal?: AbortSignal,
  ): Promise<void>;

  export function buildLLMMessages(
    doc: LLMDoc,
    skillDescriptions?: string,
    systemPromptOverride?: string,
    workspaceContext?: string,
  ): ChatMessage[];

  export const SYSTEM_PROMPT: string;
}
