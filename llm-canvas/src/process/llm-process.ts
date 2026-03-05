/**
 * LLM Process loop.
 *
 * Runs a single process: calls LLM streaming endpoint, parses <script>
 * blocks from the response, evals them, feeds results back, and repeats.
 * All output is written to the ProcessDoc via Automerge handle.change().
 */

import type { Repo } from '@automerge/automerge-repo';
import { updateText, type AutomergeUrl } from '@automerge/automerge-repo';
import type { FolderDoc, DocLink } from '@inkandswitch/patchwork-filesystem';
import { getWorkspaceRepo } from '../workspace/workspace-repo';
import type { WorkspaceDoc, WorkspaceEntry, WorkspaceChanges } from '../workspace/types';
import { parseScriptBlocks } from './parser';
import type { ProcessDoc, OutputBlock, ChatMessage, ActivityEvent } from './types';

function stringifyArg(arg: any): string {
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg, null, 2);
  } catch {
    return '[object]';
  }
}

function createCapturedConsole() {
  const output: string[] = [];
  return {
    log: (...args: any[]) => {
      output.push(args.map(stringifyArg).join(' '));
    },
    error: (...args: any[]) => {
      output.push('[error] ' + args.map(stringifyArg).join(' '));
    },
    warn: (...args: any[]) => {
      output.push('[warn] ' + args.map(stringifyArg).join(' '));
    },
    info: (...args: any[]) => {
      output.push(args.map(stringifyArg).join(' '));
    },
    flush(): string {
      const text = output.join('\n');
      output.length = 0;
      return text;
    },
  };
}

export type RunResult = {
  changes: WorkspaceChanges;
};

export type LLMProcessOptions = {
  /** Include the workspace document list in the system prompt. Defaults to false. */
  includeWorkspaceContext?: boolean;
  /** Extra context appended to the system prompt after skills/workspace sections. */
  systemContextSuffix?: string;
  /** Called whenever a document operation is observed (find/change/create), including speculative detections from streaming script code. */
  onActivity?: (event: ActivityEvent) => void;
};

export async function runLLMProcess(
  repo: Repo,
  docUrl: AutomergeUrl,
  signal?: AbortSignal,
  options?: LLMProcessOptions,
): Promise<RunResult> {
  const handle = await repo.find<ProcessDoc>(docUrl);
  const doc = handle.doc();

  if (!doc?.prompt) {
    throw new Error('No prompt to run');
  }

  const { apiUrl, model, skillsFolderUrl } = doc.config;
  const apiKey = (import.meta as any).env?.VITE_LLM_API_KEY || '';

  const wsHandle = await repo.find<WorkspaceDoc>(doc.workspaceUrl);
  const wsDoc = wsHandle.doc();
  if (!wsDoc) throw new Error('Workspace document not found');

  const { workspaceRepo, changes } = getWorkspaceRepo(repo, wsHandle, { onActivity: options?.onActivity });
  const capturedConsole = createCapturedConsole();

  const skills = skillsFolderUrl
    ? await discoverSkills(repo, skillsFolderUrl)
    : [];

  const loadSkill = async (name: string) => {
    const skill = skills.find((s) => s.name === name);
    if (!skill) {
      const available = skills.map((s) => s.name).join(', ');
      throw new Error(`Skill not found: "${name}". Available: [${available}]`);
    }
    return import(skill.importUrl);
  };

  (globalThis as any).repo = workspaceRepo;
  (globalThis as any).loadSkill = loadSkill;
  (globalThis as any).__llmCapturedConsole = capturedConsole;

  const entryDescriptions = (options?.includeWorkspaceContext ?? false)
    ? buildEntryDescriptions(wsDoc.entries ?? [])
    : '';
  const skillDescriptions = buildSkillDescriptions(skills);

  const MAX_ITERATIONS = 20;

  console.log(`[llm-process] starting run: model=${model}, apiUrl=${apiUrl}, prompt="${doc.prompt.slice(0, 80)}"`);

  let iteration = 0;
  for (; iteration < MAX_ITERATIONS; iteration++) {
    if (signal?.aborted) {
      console.log('[llm-process] aborted before iteration', iteration);
      break;
    }

    const currentDoc = handle.doc();
    if (!currentDoc) break;

    const messages = buildLLMMessages(currentDoc, entryDescriptions, skillDescriptions, options?.systemContextSuffix);
    console.log(`[llm-process] iteration ${iteration}: sending ${messages.length} messages to ${model}`);

    const stream = streamChatCompletion(apiUrl, apiKey, model, messages, signal);

    let foundScript = false;

    for await (const block of parseScriptBlocks(stream)) {
      if (signal?.aborted) break;

      if (block.type === 'text' && block.content.trim().length > 0) {
        handle.change((d) => {
          const last = d.output[d.output.length - 1];
          if (last && last.type === 'text') {
            const outputIdx = d.output.length - 1;
            updateText(
              d,
              ['output', outputIdx, 'content'],
              last.content + block.content,
            );
          } else {
            d.output.push({ type: 'text', content: block.content });
          }
        });
      }

      if (block.type === 'script') {
        handle.change((d) => {
          const last = d.output[d.output.length - 1];
          if (last && last.type === 'script' && last.output === undefined) {
            const outputIdx = d.output.length - 1;
            updateText(d, ['output', outputIdx, 'code'], block.code);
          } else {
            if (block.description) {
              d.output.push({ type: 'script', code: block.code, description: block.description });
            } else {
              d.output.push({ type: 'script', code: block.code });
            }
          }
        });

        if (block.complete) {
          foundScript = true;
          console.log(`[llm-process] iteration ${iteration}: evaluating script (description="${block.description ?? ''}", ${block.code.length} chars)`);

          const result = await evalScript(block.code, capturedConsole);
          console.log(`[llm-process] iteration ${iteration}: eval result`, result.error ? `ERROR: ${result.error}` : `output: ${result.output ?? '(none)'}`);

          handle.change((d) => {
            const outputIdx = d.output.length - 1;
            const scriptBlock = d.output[outputIdx];
            if (scriptBlock.type !== 'script') return;
            scriptBlock.output = '';
            if (result.output) {
              updateText(d, ['output', outputIdx, 'output'], result.output);
            }
            if (result.error) {
              scriptBlock.error = '';
              updateText(d, ['output', outputIdx, 'error'], result.error);
            }
          });

          break;
        }
      }
    }

    console.log(`[llm-process] iteration ${iteration}: stream complete, foundScript=${foundScript}`);

    if (!foundScript) {
      console.log('[llm-process] no script found — run complete');
      break;
    }
  }

  if (iteration >= MAX_ITERATIONS) {
    console.warn('[llm-process] reached max iterations limit');
  }

  console.log('[llm-process] run finished');
  return { changes };
}

// --- Skill discovery ---

type SkillInfo = {
  name: string;
  description: string;
  importUrl: string;
};

async function discoverSkills(
  repo: Repo,
  skillsFolderUrl: AutomergeUrl,
): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  try {
    const folderHandle = await repo.find<FolderDoc>(skillsFolderUrl);
    const folderDoc = folderHandle.doc();
    if (!folderDoc?.docs) return skills;

    for (const link of folderDoc.docs) {
      if (link.type !== 'folder') continue;

      try {
        const skillFolderHandle = await repo.find<FolderDoc>(link.url);
        const skillFolderDoc = skillFolderHandle.doc();
        if (!skillFolderDoc?.docs) continue;

        const skillMd = skillFolderDoc.docs.find(
          (d: DocLink) => d.name === 'SKILL.md',
        );
        if (!skillMd) continue;

        const mdHandle = await repo.find(skillMd.url);
        const mdDoc = mdHandle.doc() as any;
        const content = typeof mdDoc?.content === 'string'
          ? mdDoc.content
          : mdDoc?.content instanceof Uint8Array
            ? new TextDecoder().decode(mdDoc.content)
            : '';

        const frontmatter = parseFrontmatter(content);
        if (!frontmatter.name) continue;

        const indexFile = skillFolderDoc.docs.find(
          (d: DocLink) => d.name === 'index.js',
        );

        skills.push({
          name: frontmatter.name,
          description: frontmatter.description || '',
          importUrl: indexFile
            ? `/${skillsFolderUrl}/${link.name}/${indexFile.name}`
            : `/${skillsFolderUrl}/${link.name}`,
        });
      } catch {
        // Skip inaccessible skill folders
      }
    }
  } catch {
    // Skills folder inaccessible
  }

  return skills;
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const result: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    result[key] = value;
  }
  return result;
}

// --- Entry descriptions for prompt ---

function buildEntryDescriptions(entries: WorkspaceEntry[]): string {
  if (!entries.length) return '';

  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.type === 'document') {
      lines.push(`  [document] "${entry.name}" — ${entry.url} (${entry.accessLevel})`);
    } else {
      lines.push(`  [tool] "${entry.name}" — folder: ${entry.url}, entry: ${entry.path} (${entry.accessLevel})`);
    }
  }
  return lines.join('\n');
}

function buildSkillDescriptions(skills: SkillInfo[]): string {
  if (!skills.length) return '';
  return skills.map((s) => `  - ${s.name}: ${s.description}`).join('\n');
}

// --- LLM message building ---

export function buildLLMMessages(
  doc: ProcessDoc,
  entryDescriptions: string,
  skillDescriptions: string,
  systemContextSuffix?: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  let systemPrompt = SYSTEM_PROMPT;
  if (skillDescriptions) {
    systemPrompt += `\n\nAvailable skills:\n${skillDescriptions}`;
  }
  if (entryDescriptions) {
    systemPrompt += `\n\nAvailable documents and tools:\n${entryDescriptions}`;
  }
  if (systemContextSuffix) {
    systemPrompt += `\n\n${systemContextSuffix}`;
  }

  messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: doc.prompt });

  if (doc.history) {
    messages.push({
      role: 'user',
      content: `Here is the history of previous runs:\n\n${doc.history}`,
    });
  }

  if (doc.output.length > 0) {
    appendOutputMessages(messages, doc.output);
  }

  return messages;
}

function appendOutputMessages(messages: ChatMessage[], blocks: OutputBlock[]): void {
  let assistantParts: string[] = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      assistantParts.push(block.content);
    } else if (block.type === 'script') {
      if (block.description) {
        assistantParts.push(
          `<script data-description="${block.description}">\n${block.code}\n</script>`,
        );
      } else {
        assistantParts.push(`<script>\n${block.code}\n</script>`);
      }

      if (block.output !== undefined) {
        if (assistantParts.length > 0) {
          messages.push({ role: 'assistant', content: assistantParts.join('\n') });
          assistantParts = [];
        }
        let resultText: string;
        if (block.error) resultText = `[Error: ${block.error}]`;
        else if (block.output) resultText = `[Output: ${block.output}]`;
        else resultText = '[Done]';
        messages.push({ role: 'user', content: resultText });
      }
    }
  }

  if (assistantParts.length > 0) {
    messages.push({ role: 'assistant', content: assistantParts.join('\n') });
  }
}

export const SYSTEM_PROMPT = `You are a coding agent with access to a document repository and the ability to execute JavaScript.

You can execute code by writing it inside <script> tags. Add a data-description attribute to briefly describe what the code does:

<script data-description="List available documents">
const handle = await repo.find("automerge:...")
console.log(handle.doc())
</script>

Available APIs in your execution context:

  repo.find(url)    — find a document by URL (async, returns a handle)
  repo.create()     — create a new empty document

  handle.url        — the document URL
  handle.doc()      — get the current document state
  handle.change(fn) — mutate the document
  handle.heads()    — get the current heads

  loadSkill(name)   — load a skill module by name
  console.log(...)  — output text (captured and shown to you)
  return value      — return a value from the script (shown to you as output)

After each <script> block you will see the console output, return value, or any errors.
Use this to inspect results and decide your next steps.

Write text outside of script tags to explain your reasoning.
Keep your code concise and focused on the task.`;

// --- LLM streaming ---

async function* streamChatCompletion(
  apiUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const url = `${apiUrl.replace(/\/$/, '')}/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`[llm-process] API error ${response.status} from ${url}:`, text);
    throw new Error(`LLM API error (${response.status}): ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;

      const data = trimmed.slice(6);
      if (data === '[DONE]') return;

      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch {
        // Skip malformed JSON
      }
    }
  }
}

async function evalScript(
  code: string,
  capturedConsole: ReturnType<typeof createCapturedConsole>,
): Promise<{ output?: string; error?: string }> {
  capturedConsole.flush();
  (globalThis as any).__llmCapturedConsole = capturedConsole;

  try {
    const wrappedCode = `(async () => { const console = globalThis.__llmCapturedConsole;\n${code}\n})()`;
    const returnValue = await eval(wrappedCode);

    const consoleOutput = capturedConsole.flush();
    const parts: string[] = [];
    if (consoleOutput) parts.push(consoleOutput);
    if (returnValue !== undefined) parts.push(stringifyArg(returnValue));

    const result: { output?: string; error?: string } = {};
    if (parts.length > 0) result.output = parts.join('\n');
    return result;
  } catch (err: any) {
    const consoleOutput = capturedConsole.flush();
    const result: { output?: string; error?: string } = {
      error: err.message || String(err),
    };
    if (consoleOutput) result.output = consoleOutput;
    return result;
  }
}
