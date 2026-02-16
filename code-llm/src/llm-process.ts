/**
 * LLM Process loop.
 *
 * Runs in the main thread. Calls LLM streaming endpoint, parses <script>
 * blocks from the response, evals them, feeds results back, and repeats.
 * All output is written to the LLMProcessDoc via Automerge handle.change().
 */

import type { Repo } from '@automerge/automerge-repo';
import { isValidAutomergeUrl, type AutomergeUrl } from '@automerge/automerge-repo';
import type { FolderDoc } from '@inkandswitch/patchwork-filesystem';
import { AutomergeFS } from './fs';
import { parseScriptBlocks } from './parser';
import type { LLMProcessDoc, OutputBlock } from './types';

const LOG_PREFIX = '[llm-process]';
function log(...args: any[]) {
  console.log(LOG_PREFIX, ...args);
}
function logError(...args: any[]) {
  console.error(LOG_PREFIX, ...args);
}

// --- Captured console for eval context ---

function createCapturedConsole() {
  const output: string[] = [];
  return {
    log: (...args: any[]) => {
      output.push(args.map(String).join(' '));
    },
    error: (...args: any[]) => {
      output.push('[error] ' + args.map(String).join(' '));
    },
    warn: (...args: any[]) => {
      output.push('[warn] ' + args.map(String).join(' '));
    },
    info: (...args: any[]) => {
      output.push(args.map(String).join(' '));
    },
    flush(): string {
      const text = output.join('\n');
      output.length = 0;
      return text;
    },
  };
}

// --- Main entry point ---

export async function runLLMProcess(repo: Repo, docUrl: AutomergeUrl): Promise<void> {
  const handle = await repo.find<LLMProcessDoc>(docUrl);
  await handle.whenReady();
  const doc = handle.doc();

  if (!doc || !doc.runs || doc.runs.length === 0) {
    throw new Error('No task to run');
  }

  const { apiUrl, model } = doc.config;
  const apiKey = (import.meta as any).env?.VITE_LLM_API_KEY || '';

  // Auto-create root folder if missing
  let rootFolderUrl = doc.rootFolderUrl;
  if (!rootFolderUrl) {
    const folderHandle = repo.create<FolderDoc>();
    folderHandle.change((d) => {
      d.title = 'Root';
      d.docs = [];
    });
    rootFolderUrl = folderHandle.url;
    handle.change((d: any) => {
      d.rootFolderUrl = rootFolderUrl;
    });
  }

  // Set up the FS for the eval context
  const fs = new AutomergeFS(repo, rootFolderUrl);
  const capturedConsole = createCapturedConsole();

  // Auto-link patchwork URLs found in the task text
  const currentRun = doc.runs[doc.runs.length - 1];
  const linkedDocs = await autoLinkPatchworkUrls(currentRun.task, fs);

  // If docs were linked, append context to the task so the LLM knows what's available.
  // This keeps it as part of the user message to avoid assistant-prefill errors.
  if (linkedDocs.length > 0) {
    const lines = linkedDocs.map(
      (d) => `  /${d.name} (${d.type}) — automerge:${d.docId}`
    );
    const contextMsg =
      `\n\n[The following documents were linked into your filesystem:\n${lines.join('\n')}\nYou can browse them with fs.listDir("/${linkedDocs[0].name}")]`;
    handle.change((d: any) => {
      const run = d.runs[d.runs.length - 1];
      run.task += contextMsg;
    });
  }

  // Inject fs as a global. capturedConsole is stored under a private name
  // and shadowed inside eval.
  (globalThis as any).fs = fs;
  (globalThis as any).__llmCapturedConsole = capturedConsole;

  const MAX_ITERATIONS = 20;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const currentDoc = handle.doc();
    if (!currentDoc) break;

    const messages = buildLLMMessages(currentDoc);
    const stream = streamChatCompletion(apiUrl, apiKey, model, messages);

    let foundScript = false;

    for await (const block of parseScriptBlocks(stream)) {
      if (block.type === 'text' && block.content.trim().length > 0) {
        handle.change((d: any) => {
          const run = d.runs[d.runs.length - 1];
          run.output.push({ type: 'text', content: block.content });
        });
      }

      if (block.type === 'script') {
        foundScript = true;

        handle.change((d: any) => {
          const run = d.runs[d.runs.length - 1];
          run.output.push({ type: 'script', code: block.code });
        });

        const result = await evalScript(block.code, capturedConsole);

        handle.change((d: any) => {
          const run = d.runs[d.runs.length - 1];
          run.output.push(result);
        });

        break;
      }
    }

    if (!foundScript) {
      break;
    }
  }
}

// --- LLM message building ---

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

function buildLLMMessages(doc: LLMProcessDoc): ChatMessage[] {
  const messages: ChatMessage[] = [];

  messages.push({
    role: 'system',
    content: SYSTEM_PROMPT,
  });

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

/**
 * Convert output blocks into alternating assistant/user messages.
 * Text and script blocks are assistant content (what the LLM wrote).
 * Result blocks are user content (environment feedback from script execution).
 * This ensures the conversation never ends with an assistant message.
 */
function appendOutputMessages(messages: ChatMessage[], blocks: OutputBlock[]): void {
  let assistantParts: string[] = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      assistantParts.push(block.content);
    } else if (block.type === 'script') {
      assistantParts.push(`<script>\n${block.code}\n</script>`);
    } else if (block.type === 'result') {
      // Flush accumulated assistant content
      if (assistantParts.length > 0) {
        messages.push({ role: 'assistant', content: assistantParts.join('\n') });
        assistantParts = [];
      }
      // Result is environment feedback — sent as a user message
      let resultText: string;
      if (block.error) resultText = `[Error: ${block.error}]`;
      else if (block.output) resultText = `[Output: ${block.output}]`;
      else resultText = '[Done]';
      messages.push({ role: 'user', content: resultText });
    }
  }

  // Flush any trailing assistant content (text after last result, or text-only output)
  if (assistantParts.length > 0) {
    messages.push({ role: 'assistant', content: assistantParts.join('\n') });
  }
}

const SYSTEM_PROMPT = `You are a coding agent with access to a filesystem and the ability to execute JavaScript.

You can execute code by writing it inside <script> tags:

<script>
const files = await fs.listDir("/")
console.log(files)
</script>

Available APIs in your execution context:
- fs.readFile(path) — read a file as a string
- fs.writeFile(path, content) — write/create a file
- fs.listDir(path) — list directory contents (returns [{name, type}])
- fs.mkdir(path) — create a directory
- fs.rm(path) — remove a file or directory
- fs.linkDoc(path, automergeUrl, type?) — link an existing automerge document into a folder (type defaults to "file", use "folder" for folders)
- import("/automerge:docId/path/to/file") — import a module from the automerge filesystem
- import("https://esm.sh/...") — import a module from a URL
- console.log(...) — output text (captured and shown to you)
- return value — return a value from the script (shown to you as output)

Patchwork URLs: If you see a URL like https://example.com/#doc=ABCDEF&type=folder&title=Something, extract the doc ID from the #doc= parameter. The automerge URL is automerge:ABCDEF. Use this with fs.linkDoc() or import().

After each <script> block you will see the console output, return value, or any errors.
Use this to inspect results and decide your next steps.

Write text outside of script tags to explain your reasoning.
Keep your code concise and focused on the task.`;

// --- LLM streaming ---

async function* streamChatCompletion(
  apiUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[]
): AsyncGenerator<string> {
  const url = `${apiUrl.replace(/\/$/, '')}/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
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
        if (content) {
          yield content;
        }
      } catch {
        // Skip malformed JSON
      }
    }
  }
}

// --- Script evaluation ---

async function evalScript(
  code: string,
  capturedConsole: ReturnType<typeof createCapturedConsole>
): Promise<OutputBlock> {
  capturedConsole.flush();

  try {
    // Shadow `console` locally so the real window.console is not replaced.
    // `fs` is available as a global on globalThis.
    // Wrapped in an async function so the LLM can use `return` to produce a value.
    const wrappedCode = `(async () => { const console = globalThis.__llmCapturedConsole;\n${code}\n})()`;
    // eslint-disable-next-line no-eval
    const returnValue = await eval(wrappedCode);

    const consoleOutput = capturedConsole.flush();
    const parts: string[] = [];
    if (consoleOutput) parts.push(consoleOutput);
    if (returnValue !== undefined) parts.push(String(returnValue));

    const result: OutputBlock = { type: 'result' };
    if (parts.length > 0) (result as any).output = parts.join('\n');
    return result;
  } catch (err: any) {
    const consoleOutput = capturedConsole.flush();
    const result: OutputBlock = { type: 'result' };
    if (consoleOutput) (result as any).output = consoleOutput;
    (result as any).error = err.message || String(err);
    return result;
  }
}

// --- Patchwork URL extraction and auto-linking ---

type ExtractedDoc = {
  docId: string;
  title?: string;
  type?: string;
};

function extractPatchworkUrls(text: string): ExtractedDoc[] {
  const results: ExtractedDoc[] = [];
  const seen = new Set<string>();

  // Match URLs with #doc= fragment parameter
  const regex = /#doc=([A-Za-z0-9]+)([^\\s]*)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const docId = match[1];
    const rest = match[2] || '';

    // Validate that this forms a valid automerge URL
    const candidateUrl = `automerge:${docId}`;
    if (!isValidAutomergeUrl(candidateUrl)) continue;
    if (seen.has(docId)) continue;
    seen.add(docId);

    // Try to extract title and type from remaining fragment params
    const titleMatch = rest.match(/[&?]title=([^&]*)/);
    const typeMatch = rest.match(/[&?]type=([^&]*)/);

    results.push({
      docId,
      title: titleMatch ? decodeURIComponent(titleMatch[1]) : undefined,
      type: typeMatch ? decodeURIComponent(typeMatch[1]) : undefined,
    });
  }

  return results;
}

type LinkedDoc = { name: string; docId: string; type: string };

async function autoLinkPatchworkUrls(
  taskText: string,
  fs: AutomergeFS
): Promise<LinkedDoc[]> {
  const extracted = extractPatchworkUrls(taskText);
  const linked: LinkedDoc[] = [];

  for (const doc of extracted) {
    const name = doc.title || doc.docId;
    const type = doc.type || 'folder';
    const automergeUrl = `automerge:${doc.docId}` as AutomergeUrl;

    try {
      await fs.linkDoc(`/${name}`, automergeUrl, type);
      linked.push({ name, docId: doc.docId, type });
    } catch {
      // If linking fails (e.g. root folder issue), skip silently
    }
  }

  return linked;
}
