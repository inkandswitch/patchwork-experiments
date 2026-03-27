/**
 * Workspace LLM process loop.
 *
 * Operates on an LLMProcessDoc which holds:
 *   - llmConfigFolderUrl: agent.md (system prompt) + skills/ subfolder
 *   - workspaceUrl: workspace whose documents are listed for the agent
 *   - messages: single ChatMessage[] array (the full conversation)
 *   - done: boolean
 *
 * No built-in prompts. The system message is constructed from agent.md content,
 * discovered skill descriptions, and a document list from the workspace.
 */

import type { DocHandle, Repo } from '@automerge/automerge-repo';
import { updateText, type AutomergeUrl } from '@automerge/automerge-repo';
import { parseScriptBlocks } from './parser';
import type { LLMProcessDoc, ChatMessage, ChatMessagePart } from './types';
import type { WorkspaceDoc } from '../types';
import { createWorkspace } from './workspace';

type FolderDoc = {
  docs: { type: string; name: string; url: AutomergeUrl }[];
};

type SkillInfo = {
  name: string;
  description: string;
  content: string;
  importUrl?: string;
};

type ApiMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | { type: 'text'; text: string }[];
};

// ─── Public API ───────────────────────────────────────────────────────────────

export async function runWorkspaceLLM(
  repo: Repo,
  processDocUrl: AutomergeUrl,
  signal?: AbortSignal,
): Promise<void> {
  const handle = await repo.find<LLMProcessDoc>(processDocUrl);
  const doc = await handle.doc();

  if (!doc) throw new Error('Process document not found');
  if (!doc.workspaceUrl) throw new Error('No workspace linked to this process doc');
  if (!doc.llmConfigFolderUrl) throw new Error('No LLM config folder linked to this process doc');

  const { apiUrl, model } = doc.config;
  const apiKey = (import.meta as any).env?.VITE_OPENAI_API_KEY || '';

  const wsHandle = await repo.find<WorkspaceDoc>(doc.workspaceUrl);
  const wsDoc = await wsHandle.doc();
  if (!wsDoc) throw new Error('Workspace document not found');

  const capturedConsole = createCapturedConsole();

  const systemPrompt = await loadAgentPrompt(repo, doc.llmConfigFolderUrl);
  const skills = await discoverSkills(repo, doc.llmConfigFolderUrl);
  const skillDescriptions = buildSkillDescriptions(skills);
  const documentList = buildDocumentList(wsDoc);

  const systemText = buildSystemPrompt(systemPrompt, skillDescriptions, documentList);

  const loadSkillDocs = async (name: string): Promise<string> => {
    const skill = skills.find((s) => s.name === name);
    if (!skill) {
      const available = skills.map((s) => s.name).join(', ');
      throw new Error(`Skill not found: "${name}". Available: [${available}]`);
    }
    return skill.content;
  };

  const importSkillApi = async (name: string): Promise<Record<string, unknown>> => {
    const skill = skills.find((s) => s.name === name);
    if (!skill) {
      const available = skills.map((s) => s.name).join(', ');
      throw new Error(`Skill not found: "${name}". Available: [${available}]`);
    }
    if (!skill.importUrl) {
      throw new Error(
        `Skill "${name}" has no importable API module. Use loadSkillDocs("${name}") to read its documentation.`,
      );
    }
    return await import(/* @vite-ignore */ skill.importUrl);
  };

  const getSkillURL = (name: string): string => {
    const skill = skills.find((s) => s.name === name);
    if (!skill) {
      const available = skills.map((s) => s.name).join(', ');
      throw new Error(`Skill not found: "${name}". Available: [${available}]`);
    }
    if (!skill.importUrl) {
      throw new Error(`Skill "${name}" has no importable API module.`);
    }
    return skill.importUrl;
  };

  const workspace = createWorkspace(repo, wsHandle, doc.llmConfigFolderUrl);

  (globalThis as any).loadSkillDocs = loadSkillDocs;
  (globalThis as any).importSkillApi = importSkillApi;
  (globalThis as any).getSkillURL = getSkillURL;
  (globalThis as any).__llmCapturedConsole = capturedConsole;
  (globalThis as any).repo = repo;
  (globalThis as any).workspace = workspace;

  console.log(`[workspace-llm] starting run: model=${model}, apiUrl=${apiUrl}`);

  await runLoop(handle, systemText, apiUrl, apiKey, model, capturedConsole, signal);
}

// ─── Agent prompt loading ─────────────────────────────────────────────────────

async function loadAgentPrompt(repo: Repo, configFolderUrl: AutomergeUrl): Promise<string> {
  try {
    const folderHandle = await repo.find<FolderDoc>(configFolderUrl);
    const folderDoc = await folderHandle.doc();
    if (!folderDoc?.docs) return '';

    const agentEntry = folderDoc.docs.find((d) => d.name === 'agent.md');
    if (!agentEntry) return '';

    const mdHandle = await repo.find(agentEntry.url);
    const mdDoc = (await mdHandle.doc()) as any;
    if (typeof mdDoc?.content === 'string') return mdDoc.content;
    if (mdDoc?.content instanceof Uint8Array) return new TextDecoder().decode(mdDoc.content);
    return '';
  } catch {
    return '';
  }
}

// ─── System prompt construction ───────────────────────────────────────────────

function buildSystemPrompt(
  agentPrompt: string,
  skillDescriptions: string,
  documentList: string,
): string {
  let prompt = agentPrompt;

  if (skillDescriptions) {
    prompt +=
      `\n\nAvailable skills:\n${skillDescriptions}\n\n` +
      "Use `await loadSkillDocs('name')` to read a skill's documentation. " +
      "Use `await importSkillApi('name')` to import its runtime API. " +
      "Use `getSkillURL('name')` to get a skill's import URL for embedding in prompts.";
  }

  if (documentList) {
    prompt +=
      '\n\nDocuments in the workspace (this list is exhaustive — no other documents exist unless you create them):\n' +
      documentList +
      '\nUse repo.find(url) to open a document. If no suitable document exists, create one using the appropriate skill.';
  } else {
    prompt +=
      '\n\nThere are no documents in the workspace yet. Create any documents you need using the appropriate skill.';
  }

  return prompt;
}

// ─── Document list ────────────────────────────────────────────────────────────

function buildDocumentList(wsDoc: WorkspaceDoc): string {
  const entries = Object.entries(wsDoc.documents ?? {});
  if (!entries.length) return '';

  const lines = entries.map(([url]) => `  - ${url}`);
  return lines.join('\n');
}

// ─── Serialize messages for the LLM API ───────────────────────────────────────

function serializeForApi(systemText: string, messages: ChatMessage[]): ApiMessage[] {
  const apiMessages: ApiMessage[] = [{ role: 'system', content: systemText }];

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      serializeAssistantMessage(apiMessages, msg);
    } else {
      apiMessages.push({ role: msg.role, content: serializeParts(msg.content) });
    }
  }

  return apiMessages;
}

function serializeAssistantMessage(apiMessages: ApiMessage[], msg: ChatMessage): void {
  let textAccum = '';

  for (const part of msg.content) {
    if (part.type === 'text') {
      textAccum += part.text;
    } else if (part.type === 'script') {
      if (part.description) {
        textAccum += `<script data-description="${part.description}">\n${part.code}\n</script>`;
      } else {
        textAccum += `<script>\n${part.code}\n</script>`;
      }

      if (part.output !== undefined || part.error !== undefined) {
        if (textAccum) {
          apiMessages.push({ role: 'assistant', content: textAccum });
          textAccum = '';
        }
        let resultText: string;
        if (part.error) resultText = `[Error: ${part.error}]`;
        else if (part.output) resultText = `[Output: ${part.output}]`;
        else resultText = '[Done]';
        apiMessages.push({ role: 'user', content: resultText });
      }
    }
  }

  if (textAccum) {
    apiMessages.push({ role: 'assistant', content: textAccum });
  }
}

function serializeParts(parts: ChatMessagePart[]): string {
  return parts
    .map((p) => {
      if (p.type === 'text') return p.text;
      if (p.type === 'script') {
        let s = p.description
          ? `<script data-description="${p.description}">\n${p.code}\n</script>`
          : `<script>\n${p.code}\n</script>`;
        if (p.error) s += `\n[Error: ${p.error}]`;
        else if (p.output) s += `\n[Output: ${p.output}]`;
        return s;
      }
      return '';
    })
    .join('');
}

// ─── Iteration loop ───────────────────────────────────────────────────────────

async function runLoop(
  handle: DocHandle<LLMProcessDoc>,
  systemText: string,
  apiUrl: string,
  apiKey: string,
  model: string,
  capturedConsole: ReturnType<typeof createCapturedConsole>,
  signal?: AbortSignal,
): Promise<void> {
  const MAX_ITERATIONS = 20;

  let iteration = 0;
  for (; iteration < MAX_ITERATIONS; iteration++) {
    if (signal?.aborted) {
      console.log('[workspace-llm] aborted before iteration', iteration);
      break;
    }

    const currentDoc = await handle.doc();
    if (!currentDoc) break;

    const apiMessages = serializeForApi(systemText, currentDoc.messages);
    if (iteration === 0) {
      console.log(`[workspace-llm] system prompt:\n${apiMessages[0]?.content}`);
    }
    console.log(
      `[workspace-llm] iteration ${iteration}: sending ${apiMessages.length} messages to ${model}`,
    );

    // Append a new empty assistant message
    handle.change((d) => {
      d.messages.push({ role: 'assistant', content: [] });
    });
    const assistantIdx = (await handle.doc())!.messages.length - 1;

    const stream = streamChatCompletion(apiUrl, apiKey, model, apiMessages, signal);
    let foundScript = false;

    for await (const block of parseScriptBlocks(stream)) {
      if (signal?.aborted) break;

      if (block.type === 'text' && block.content.trim().length > 0) {
        handle.change((d) => {
          const msg = d.messages[assistantIdx];
          const lastPart = msg.content[msg.content.length - 1];
          if (lastPart && lastPart.type === 'text') {
            const partIdx = msg.content.length - 1;
            updateText(
              d,
              ['messages', assistantIdx, 'content', partIdx, 'text'],
              lastPart.text + block.content,
            );
          } else {
            msg.content.push({ type: 'text', text: block.content });
          }
        });
      }

      if (block.type === 'script') {
        handle.change((d) => {
          const msg = d.messages[assistantIdx];
          const lastPart = msg.content[msg.content.length - 1];
          if (
            lastPart &&
            lastPart.type === 'script' &&
            lastPart.output === undefined &&
            lastPart.error === undefined
          ) {
            const partIdx = msg.content.length - 1;
            updateText(
              d,
              ['messages', assistantIdx, 'content', partIdx, 'code'],
              block.code,
            );
          } else {
            const scriptPart: ChatMessagePart = block.description
              ? { type: 'script', code: block.code, description: block.description }
              : { type: 'script', code: block.code };
            msg.content.push(scriptPart);
          }
        });

        if (block.complete) {
          foundScript = true;
          console.log(
            `[workspace-llm] iteration ${iteration}: evaluating script (description="${block.description ?? ''}", ${block.code.length} chars)`,
          );

          const result = await evalScript(block.code, capturedConsole);
          console.log(
            `[workspace-llm] iteration ${iteration}: eval result`,
            result.error ? `ERROR: ${result.error}` : `output: ${result.output ?? '(none)'}`,
          );

          handle.change((d) => {
            const msg = d.messages[assistantIdx];
            const partIdx = msg.content.length - 1;
            const scriptPart = msg.content[partIdx];
            if (scriptPart.type !== 'script') return;

            if (result.output !== undefined) {
              scriptPart.output = '';
              updateText(
                d,
                ['messages', assistantIdx, 'content', partIdx, 'output'],
                result.output,
              );
            }
            if (result.error !== undefined) {
              scriptPart.error = '';
              updateText(
                d,
                ['messages', assistantIdx, 'content', partIdx, 'error'],
                result.error,
              );
            }
            if (result.output === undefined && result.error === undefined) {
              scriptPart.output = '';
            }
          });

          break;
        }
      }
    }

    console.log(
      `[workspace-llm] iteration ${iteration}: stream complete, foundScript=${foundScript}`,
    );

    if (!foundScript) {
      console.log('[workspace-llm] no script found — run complete');
      break;
    }
  }

  if (iteration >= MAX_ITERATIONS) {
    console.warn('[workspace-llm] reached max iterations limit');
  }

  handle.change((d) => {
    d.done = true;
  });

  console.log('[workspace-llm] run finished');
}

// ─── Skill discovery ──────────────────────────────────────────────────────────

async function discoverSkills(repo: Repo, configFolderUrl: AutomergeUrl): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  try {
    const folderHandle = await repo.find<FolderDoc>(configFolderUrl);
    const folderDoc = await folderHandle.doc();
    if (!folderDoc?.docs) return skills;

    const skillsFolderEntry = folderDoc.docs.find(
      (d) => d.name === 'skills' && d.type === 'folder',
    );
    if (!skillsFolderEntry) return skills;

    const skillsFolderHandle = await repo.find<FolderDoc>(skillsFolderEntry.url);
    const skillsFolderDoc = await skillsFolderHandle.doc();
    if (!skillsFolderDoc?.docs) return skills;

    for (const link of skillsFolderDoc.docs) {
      if (link.type !== 'folder') continue;
      await discoverSkillInFolder(repo, link.url, skills);
    }
  } catch {
    // Config folder inaccessible
  }

  return skills;
}

async function discoverSkillInFolder(
  repo: Repo,
  folderUrl: AutomergeUrl,
  skills: SkillInfo[],
): Promise<void> {
  try {
    const folderHandle = await repo.find<FolderDoc>(folderUrl);
    const folderDoc = await folderHandle.doc();
    if (!folderDoc?.docs) return;

    const skillMdEntry = folderDoc.docs.find((d) => d.name === 'SKILL.md');
    if (!skillMdEntry) return;

    const mdHandle = await repo.find(skillMdEntry.url);
    const mdDoc = (await mdHandle.doc()) as any;
    const content =
      typeof mdDoc?.content === 'string'
        ? mdDoc.content
        : mdDoc?.content instanceof Uint8Array
          ? new TextDecoder().decode(mdDoc.content)
          : '';

    const frontmatter = parseFrontmatter(content);
    if (!frontmatter.name) return;

    const indexEntry = folderDoc.docs.find((d) => d.name === 'index.js');
    skills.push({
      name: frontmatter.name,
      description: frontmatter.description || '',
      content,
      importUrl: indexEntry ? `/${swPath(folderUrl)}/${indexEntry.name}` : undefined,
    });
  } catch {
    // Skip inaccessible skill folder
  }
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

function buildSkillDescriptions(skills: SkillInfo[]): string {
  if (!skills.length) return '';
  return skills.map((s) => `- ${s.name}: ${s.description}`).join('\n');
}

function swPath(automergeUrl: string): string {
  return automergeUrl.replace('automerge:', 'automerge%3A');
}

// ─── Utilities ────────────────────────────────────────────────────────────────

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

// ─── LLM streaming ───────────────────────────────────────────────────────────

async function* streamChatCompletion(
  apiUrl: string,
  apiKey: string,
  model: string,
  messages: ApiMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const url = `${apiUrl.replace(/\/$/, '')}/chat/completions`;

  const t0 = performance.now();
  console.log(`[workspace-llm:stream] fetch → ${url}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      'HTTP-Referer': globalThis.location?.origin ?? 'http://localhost',
      'X-Title': 'Patchwork',
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });

  console.log(
    `[workspace-llm:stream] response headers received +${(performance.now() - t0).toFixed(0)}ms status=${response.status}`,
  );

  if (!response.ok) {
    const text = await response.text();
    console.error(`[workspace-llm] API error ${response.status} from ${url}:`, text);
    throw new Error(`LLM API error (${response.status}): ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let chunkIndex = 0;
  let tokenCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let tokensInChunk = 0;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          console.log(
            `[workspace-llm:stream] [DONE] after ${tokenCount} tokens, total time +${(performance.now() - t0).toFixed(0)}ms`,
          );
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            tokensInChunk++;
            tokenCount++;
            yield content;
          }
        } catch {
          // Skip malformed JSON
        }
      }

      if (tokensInChunk > 0) {
        console.log(
          `[workspace-llm:stream] chunk #${chunkIndex} +${(performance.now() - t0).toFixed(0)}ms → ${tokensInChunk} token(s), total=${tokenCount}`,
        );
      }
      chunkIndex++;
    }
  } finally {
    reader.cancel().catch(() => {});
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
