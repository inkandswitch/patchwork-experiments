/**
 * LLM process loop.
 *
 * Runs a single process: calls LLM streaming endpoint, parses <script>
 * blocks from the response, evals them, feeds results back, and repeats.
 * All output is written to the LLMDoc via Automerge handle.change().
 *
 * Skills are discovered from the skills folder URL (baked in via __SKILLS_DIR_URL__
 * at build time, or overridden per-doc via doc.skillsFolderUrl). Each skill's
 * SKILL.md frontmatter provides its name and description for the system prompt.
 * The LLM loads skills at runtime via globalThis.loadSkill(name).
 */

import type { Repo } from '@automerge/automerge-repo';
import { updateText, type AutomergeUrl } from '@automerge/automerge-repo';
import { parseScriptBlocks } from './parser';
import type { LLMDoc, OutputBlock, ChatMessage } from './types';

// Inline folder doc type — avoids requiring @inkandswitch/patchwork-filesystem
type FolderDoc = {
  docs: { type: string; name: string; url: AutomergeUrl }[];
};

type SkillInfo = {
  name: string;
  description: string;
  importUrl: string;
};

function swPath(automergeUrl: string): string {
  return automergeUrl.replace('automerge:', 'automerge%3A');
}

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

export async function runLLMProcess(
  repo: Repo,
  processDocUrl: AutomergeUrl,
  signal?: AbortSignal,
): Promise<void> {
  const handle = await repo.find<LLMDoc>(processDocUrl);
  const doc = await handle.doc();

  if (!doc?.prompt) {
    throw new Error('No prompt to run');
  }

  const { apiUrl, model, api: apiModuleUrl } = doc.config;
  const apiKey = (import.meta as any).env?.VITE_OPENAI_API_KEY || '';

  const capturedConsole = createCapturedConsole();

  let skillSystemPrompt: string | undefined;

  if (apiModuleUrl && doc.docUrl) {
    const targetHandle = await repo.find(doc.docUrl);
    const skillMod = await import(/* @vite-ignore */ apiModuleUrl);
    const skillApi = skillMod.default(targetHandle);
    skillSystemPrompt = skillMod.systemPrompt;
    (globalThis as any).api = skillApi;
  }

  const skillsFolderUrl = (doc.skillsFolderUrl ?? __SKILLS_DIR_URL__) as AutomergeUrl;
  const skills = skillsFolderUrl ? await discoverSkills(repo, skillsFolderUrl) : [];
  const skillDescriptions = buildSkillDescriptions(skills);

  const loadSkill = async (name: string) => {
    const skill = skills.find((s) => s.name === name);
    if (!skill) {
      const available = skills.map((s) => s.name).join(', ');
      throw new Error(`Skill not found: "${name}". Available: [${available}]`);
    }
    return import(/* @vite-ignore */ skill.importUrl);
  };

  (globalThis as any).loadSkill = loadSkill;
  (globalThis as any).__llmCapturedConsole = capturedConsole;

  const MAX_ITERATIONS = 20;

  console.log(`[llm] starting run: model=${model}, apiUrl=${apiUrl}, prompt="${doc.prompt.slice(0, 80)}"`);

  let iteration = 0;
  for (; iteration < MAX_ITERATIONS; iteration++) {
    if (signal?.aborted) {
      console.log('[llm] aborted before iteration', iteration);
      break;
    }

    const currentDoc = await handle.doc();
    if (!currentDoc) break;

    const messages = buildLLMMessages(currentDoc, skillDescriptions, skillSystemPrompt);
    console.log(`[llm] iteration ${iteration}: sending ${messages.length} messages to ${model}`);

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
          console.log(`[llm] iteration ${iteration}: evaluating script (description="${block.description ?? ''}", ${block.code.length} chars)`);

          const result = await evalScript(block.code, capturedConsole);
          console.log(`[llm] iteration ${iteration}: eval result`, result.error ? `ERROR: ${result.error}` : `output: ${result.output ?? '(none)'}`);

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

    console.log(`[llm] iteration ${iteration}: stream complete, foundScript=${foundScript}`);

    if (!foundScript) {
      console.log('[llm] no script found — run complete');
      break;
    }
  }

  if (iteration >= MAX_ITERATIONS) {
    console.warn('[llm] reached max iterations limit');
  }

  handle.change((d) => {
    d.done = true;
  });

  console.log('[llm] run finished');
}

// --- Skill discovery ---

async function discoverSkills(repo: Repo, skillsFolderUrl: AutomergeUrl): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  try {
    const folderHandle = await repo.find<FolderDoc>(skillsFolderUrl);
    const folderDoc = await folderHandle.doc();
    if (!folderDoc?.docs) return skills;

    for (const link of folderDoc.docs) {
      if (link.type !== 'folder') continue;

      try {
        const skillFolderHandle = await repo.find<FolderDoc>(link.url);
        const skillFolderDoc = await skillFolderHandle.doc();
        if (!skillFolderDoc?.docs) continue;

        const skillMdEntry = skillFolderDoc.docs.find((d) => d.name === 'SKILL.md');
        if (!skillMdEntry) continue;

        const mdHandle = await repo.find(skillMdEntry.url);
        const mdDoc = await mdHandle.doc() as any;
        const content =
          typeof mdDoc?.content === 'string'
            ? mdDoc.content
            : mdDoc?.content instanceof Uint8Array
              ? new TextDecoder().decode(mdDoc.content)
              : '';

        const frontmatter = parseFrontmatter(content);
        if (!frontmatter.name) continue;

        const indexEntry = skillFolderDoc.docs.find((d) => d.name === 'index.js');

        skills.push({
          name: frontmatter.name,
          description: frontmatter.description || '',
          importUrl: indexEntry
            ? `/${swPath(link.url)}/${indexEntry.name}`
            : `/${swPath(link.url)}/index.js`,
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

function buildSkillDescriptions(skills: SkillInfo[]): string {
  if (!skills.length) return '';
  return skills.map((s) => `  - ${s.name}: ${s.description}`).join('\n');
}

// --- LLM message building ---

export const SYSTEM_PROMPT = `You are a coding agent that can execute JavaScript to accomplish tasks.

Execute code by writing it inside <script> tags with a data-description attribute:

<script data-description="Brief description of what this code does">
// your code here
</script>

Available APIs in your execution context:

  repo.find(url)      — find a document by Automerge URL (async, returns a handle)
  repo.create()       — create a new empty document

  handle.url          — the document URL
  handle.doc()        — get the current document state (async)
  handle.change(fn)   — mutate the document

  loadSkill(name)     — load a skill module by name (async, returns the skill's exports)

  console.log(...)    — captured and shown as output
  return <value>      — return value is shown as output

Rules:
- Write one <script> block per iteration; wait for its output before continuing.
- Use \`return\` to inspect values.
- Skills provide high-level APIs for specific document types — prefer them over direct doc manipulation.`;

export function buildLLMMessages(
  doc: LLMDoc,
  skillDescriptions?: string,
  systemPromptOverride?: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  let systemPrompt = systemPromptOverride ?? SYSTEM_PROMPT;

  if (skillDescriptions) {
    systemPrompt += `\n\nAvailable skills:\n${skillDescriptions}`;
  }

  messages.push({ role: 'system', content: systemPrompt });

  if (doc.previousMessages) {
    for (const msg of doc.previousMessages) {
      if (msg.role !== 'system') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
  }

  messages.push({ role: 'user', content: doc.prompt });

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
      'HTTP-Referer': globalThis.location?.origin ?? 'http://localhost',
      'X-Title': 'Patchwork',
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`[llm] API error ${response.status} from ${url}:`, text);
    throw new Error(`LLM API error (${response.status}): ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  try {
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
