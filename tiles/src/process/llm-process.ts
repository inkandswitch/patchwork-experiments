/**
 * LLM Process loop.
 *
 * Runs in the main thread. Calls LLM streaming endpoint, parses <script>
 * blocks from the response, evals them, feeds results back, and repeats.
 * All output is written to the LLMProcessDoc via Automerge handle.change().
 */

import type { Repo } from '@automerge/automerge-repo';
import { updateText, type AutomergeUrl } from '@automerge/automerge-repo';
import { AutomergeFS } from './fs';
import { parseScriptBlocks } from './parser';
import type { LLMProcessDoc, OutputBlock, WorkspaceDoc, WorkspaceEntry } from './types';

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
  docUrl: AutomergeUrl,
  signal?: AbortSignal,
): Promise<void> {
  const handle = await repo.find<LLMProcessDoc>(docUrl);
  const doc = handle.doc();

  if (!doc?.runs?.length) {
    throw new Error('No task to run');
  }

  const { apiUrl, model } = doc.config;
  const apiKey = (import.meta as any).env?.VITE_LLM_API_KEY || '';

  const workspaceHandle = await repo.find<WorkspaceDoc>(doc.workspaceUrl);
  const fs = new AutomergeFS(repo, workspaceHandle);
  const capturedConsole = createCapturedConsole();

  (globalThis as any).fs = fs;
  (globalThis as any).__llmCapturedConsole = capturedConsole;

  // Build workspace context for the system prompt
  const entries = fs.listEntries();
  const entryDescriptions = await buildEntryDescriptions(fs, entries);

  const MAX_ITERATIONS = 20;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (signal?.aborted) break;

    const currentDoc = handle.doc();
    if (!currentDoc) break;

    const messages = buildLLMMessages(currentDoc, entryDescriptions);
    const stream = streamChatCompletion(apiUrl, apiKey, model, messages, signal);

    let foundScript = false;

    for await (const block of parseScriptBlocks(stream)) {
      if (signal?.aborted) break;

      if (block.type === 'text' && block.content.trim().length > 0) {
        handle.change((d) => {
          const runIdx = d.runs.length - 1;
          const run = d.runs[runIdx];
          const last = run.output[run.output.length - 1];
          if (last && last.type === 'text') {
            const outputIdx = run.output.length - 1;
            updateText(
              d,
              ['runs', runIdx, 'output', outputIdx, 'content'],
              last.content + block.content,
            );
          } else {
            run.output.push({ type: 'text', content: block.content });
          }
        });
      }

      if (block.type === 'script') {
        handle.change((d) => {
          const runIdx = d.runs.length - 1;
          const run = d.runs[runIdx];
          const last = run.output[run.output.length - 1];
          if (last && last.type === 'script' && last.output === undefined) {
            const outputIdx = run.output.length - 1;
            updateText(d, ['runs', runIdx, 'output', outputIdx, 'code'], block.code);
          } else {
            if (block.description) {
              run.output.push({ type: 'script', code: block.code, description: block.description });
            } else {
              run.output.push({ type: 'script', code: block.code });
            }
          }
        });

        if (block.complete) {
          foundScript = true;

          const result = await evalScript(block.code, capturedConsole);

          handle.change((d) => {
            const runIdx = d.runs.length - 1;
            const run = d.runs[runIdx];
            const outputIdx = run.output.length - 1;
            const scriptBlock = run.output[outputIdx];
            if (scriptBlock.type !== 'script') return;
            scriptBlock.output = '';
            if (result.output) {
              updateText(d, ['runs', runIdx, 'output', outputIdx, 'output'], result.output);
            }
            if (result.error) {
              scriptBlock.error = '';
              updateText(d, ['runs', runIdx, 'output', outputIdx, 'error'], result.error);
            }
          });

          break;
        }
      }
    }

    if (!foundScript) break;
  }
}

// --- Workspace description for system prompt ---

async function buildEntryDescriptions(
  fs: AutomergeFS,
  entries: WorkspaceEntry[],
): Promise<string> {
  const lines: string[] = [];

  for (const entry of entries) {
    if (entry.type === 'document') {
      lines.push(`  [document] "${entry.name}" — ${entry.url}`);
    } else {
      lines.push(`  [tool] "${entry.name}" — folder: ${entry.url}, entry: ${entry.path}`);
      try {
        const contents = await fs.listFolder(entry.name);
        for (const item of contents) {
          lines.push(`    ${item.name} (${item.type})`);
        }
      } catch {
        // Folder may not be accessible yet
      }
    }
  }

  return lines.join('\n');
}

// --- LLM message building ---

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export function buildLLMMessages(
  doc: LLMProcessDoc,
  entryDescriptions: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  let systemPrompt = SYSTEM_PROMPT;
  if (entryDescriptions) {
    systemPrompt += `\n\nWorkspace entries:\n${entryDescriptions}`;
  }

  messages.push({ role: 'system', content: systemPrompt });

  for (let i = 0; i < doc.runs.length - 1; i++) {
    const run = doc.runs[i];
    messages.push({ role: 'user', content: run.task });
    appendOutputMessages(messages, run.output);
  }

  const currentRun = doc.runs[doc.runs.length - 1];
  messages.push({ role: 'user', content: currentRun.task });

  if (currentRun.output.length > 0) {
    appendOutputMessages(messages, currentRun.output);
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

export const SYSTEM_PROMPT = `You are a coding agent with access to a workspace and the ability to execute JavaScript.

You can execute code by writing it inside <script> tags. Add a data-description attribute to briefly describe what the code does:

<script data-description="List workspace entries">
const entries = fs.listEntries()
console.log(entries)
</script>

The workspace contains documents and tools. Documents are Automerge documents (files or folders). Tools are references to JS files inside Automerge folder documents.

Available APIs in your execution context:

Top-level access:
- fs.listEntries() — list all workspace entries (returns [{name, url, type, path?}])
- fs.readDoc(name) — read a document's content as a string
- fs.writeDoc(name, content) — write/overwrite a document's content (COW: clones on first write)
- fs.patchDoc(name, oldStr, newStr) — replace first occurrence of oldStr with newStr in a document

Deep access (for folder documents and tool folders):
- fs.readFile(name, path) — read a file at path within the named entry's folder
- fs.writeFile(name, path, content) — write/create a file at path within the named entry's folder (deep COW: clones intermediate folders)
- fs.patchFile(name, path, oldStr, newStr) — patch a file within a folder
- fs.listFolder(name, path?) — list contents of a folder entry or subfolder (returns [{name, type, url}])
- fs.createFolder(name, path) — create a subfolder within a folder entry

Tool shortcuts:
- fs.readToolSource(name) — read the JS source of a tool entry (shortcut for readFile with the tool's path)

Snapshots:
- fs.snapshot(name) — get a point-in-time URL for a document (URL with heads baked in)
- fs.snapshotFolder(name) — create a deep snapshot of a folder (clones all contents recursively)

Other:
- fs.createOrGetDocHandle(name, path?) — get an Automerge DocHandle for direct manipulation
- fs.getDocUrl(name) — get the original automerge URL for an entry
- fs.importModule(name, path) — dynamically import a JS module from a folder entry
- import("https://esm.sh/...") — import a module from a URL
- console.log(...) — output text (captured and shown to you)
- return value — return a value from the script (shown to you as output)

After each <script> block you will see the console output, return value, or any errors.
Use this to inspect results and decide your next steps.

Write text outside of script tags to explain your reasoning.
Keep your code concise and focused on the task.

Tips:
- For editing existing files, prefer fs.patchDoc() or fs.patchFile() for targeted changes. This is more reliable and avoids issues with large content replacements.
- Use \`return value\` to inspect values; it's the most reliable way to see output.
- All writes are copy-on-write: originals are never modified. The workspace tracks clones in its mappings.`;

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
