/**
 * LLM Process loop.
 *
 * Runs in the main thread. Calls LLM streaming endpoint, parses <script>
 * blocks from the response, evals them, feeds results back, and repeats.
 * All output is written to the LLMProcessDoc via Automerge handle.change().
 */

import type { Repo } from '@automerge/automerge-repo';
import { isValidAutomergeUrl, updateText, type AutomergeUrl } from '@automerge/automerge-repo';
import type { FolderDoc } from '@inkandswitch/patchwork-filesystem';
import { AutomergeFS } from './fs';
import { parseScriptBlocks } from './parser';
import type { LLMProcessDoc, OutputBlock, WorkspaceDoc } from './types';

// --- Captured console for eval context ---

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

// --- Main entry point ---

export async function runLLMProcess(repo: Repo, docUrl: AutomergeUrl): Promise<void> {
  const handle = await repo.find<LLMProcessDoc>(docUrl);
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
    handle.change((d) => {
      d.rootFolderUrl = rootFolderUrl;
    });
  }

  // Create or load the workspace doc (COW overlay)
  const workspaceUrl = doc.workspaceUrl;

  const workspaceHandle = await repo.find<WorkspaceDoc>(workspaceUrl);

  // Set up the FS for the eval context
  const fs = new AutomergeFS(repo, workspaceHandle);
  const capturedConsole = createCapturedConsole();

  // Auto-link patchwork URLs found in the task text
  const currentRun = doc.runs[doc.runs.length - 1];
  const linkedDocs = await autoLinkPatchworkUrls(currentRun.task, fs);

  // If docs were linked, append context to the task so the LLM knows what's available.
  // This keeps it as part of the user message to avoid assistant-prefill errors.
  if (linkedDocs.length > 0) {
    const lines = linkedDocs.map((d) => `  /${d.name} (${d.type}) — automerge:${d.docId}`);
    const contextMsg = `\n\n[The following documents were linked into your filesystem:\n${lines.join(
      '\n'
    )}\nYou can browse them with fs.listFolder("/${linkedDocs[0].name}")]`;
    handle.change((d) => {
      const run = d.runs[d.runs.length - 1];
      updateText(d, ['runs', d.runs.length - 1, 'task'], run.task + contextMsg);
    });
  }

  // Inject fs as a global. capturedConsole is stored under a private name
  // and shadowed inside eval.
  (globalThis as any).fs = fs;
  (globalThis as any).__llmCapturedConsole = capturedConsole;

  // Discover available skills
  const skills = await discoverSkills(fs);

  // List root directory so the LLM knows what files are available
  let rootListing: { name: string; type: string; url: string }[] = [];
  try {
    rootListing = await fs.listFolder('/');
  } catch {
    // Empty workspace — that's fine
  }

  const MAX_ITERATIONS = 20;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const currentDoc = handle.doc();
    if (!currentDoc) break;

    const messages = buildLLMMessages(currentDoc, skills, rootFolderUrl, rootListing);
    const stream = streamChatCompletion(apiUrl, apiKey, model, messages);

    let foundScript = false;

    for await (const block of parseScriptBlocks(stream)) {
      if (block.type === 'text' && block.content.trim().length > 0) {
        handle.change((d) => {
          const run = d.runs[d.runs.length - 1];
          const runIdx = d.runs.length - 1;
          const last = run.output[run.output.length - 1];
          if (last && last.type === 'text') {
            const outputIdx = run.output.length - 1;
            updateText(
              d,
              ['runs', runIdx, 'output', outputIdx, 'content'],
              last.content + block.content
            );
          } else {
            run.output.push({ type: 'text', content: block.content });
          }
        });
      }

      if (block.type === 'script') {
        // Update or push the script block (handles both in-progress and final)
        handle.change((d) => {
          const run = d.runs[d.runs.length - 1];
          const runIdx = d.runs.length - 1;
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

          // Merge result into the existing script block using updateText
          handle.change((d) => {
            const runIdx = d.runs.length - 1;
            const run = d.runs[runIdx];
            const outputIdx = run.output.length - 1;
            const scriptBlock = run.output[outputIdx];
            if (scriptBlock.type !== 'script') return;
            // Always set output to signal completion (empty string = no output)
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

function buildLLMMessages(
  doc: LLMProcessDoc,
  skills: SkillInfo[] = [],
  rootFolderUrl?: AutomergeUrl,
  rootListing: { name: string; type: string; url: string }[] = []
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  let systemPrompt = SYSTEM_PROMPT;
  if (skills.length > 0 && rootFolderUrl) {
    systemPrompt += buildSkillsPromptSection(skills, rootFolderUrl);
  }
  if (rootListing.length > 0) {
    const entries = rootListing.map((e) => `  ${e.name} (${e.type}) — ${e.url}`).join('\n');
    systemPrompt += `\n\nCurrent files in the workspace:\n${entries}`;
  }

  messages.push({
    role: 'system',
    content: systemPrompt,
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
 * Text and script code are assistant content (what the LLM wrote).
 * Script results (output/error) are user content (environment feedback).
 * This ensures the conversation never ends with an assistant message.
 */
function appendOutputMessages(messages: ChatMessage[], blocks: OutputBlock[]): void {
  let assistantParts: string[] = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      assistantParts.push(block.content);
    } else if (block.type === 'script') {
      // Script code is assistant content
      if (block.description) {
        assistantParts.push(
          `<script data-description="${block.description}">\n${block.code}\n</script>`
        );
      } else {
        assistantParts.push(`<script>\n${block.code}\n</script>`);
      }

      // If the script has a result, flush assistant and emit result as user message
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

  // Flush any trailing assistant content (text after last result, or text-only output)
  if (assistantParts.length > 0) {
    messages.push({ role: 'assistant', content: assistantParts.join('\n') });
  }
}

const SYSTEM_PROMPT = `You are a coding agent with access to a filesystem and the ability to execute JavaScript.

You can execute code by writing it inside <script> tags. Add a data-description attribute to briefly describe what the code does:

<script data-description="List workspace files">
const files = await fs.listFolder("/")
console.log(files)
</script>

Available APIs in your execution context:
- fs.readDoc(pathOrUrl) — read a document as a string (accepts a filesystem path or an automerge: URL)
- fs.writeFile(path, content) — write/create a file (full replacement)
- fs.patchFile(path, oldStr, newStr) — replace the first occurrence of oldStr with newStr in a file. Prefer this over writeFile for targeted edits to existing files — it's safer and more token-efficient.
- fs.listFolder(path) — list folder contents (returns [{name, type, url}])
- fs.createFolder(path) — create a folder
- fs.move(srcPath, destPath) — move or rename a file or folder
- fs.remove(path) — remove a file or folder
- fs.linkDoc(path, automergeUrl) — link an existing automerge document into a folder
- fs.getDocHandle(pathOrUrl) — get a cloned Automerge DocHandle for a document (accepts a path or automerge: URL; always returns a clone, never the original)
- import("/automerge:docId/path/to/file") — import a module from the automerge filesystem
- import("https://esm.sh/...") — import a module from a URL
- console.log(...) — output text (captured and shown to you)
- return value — return a value from the script (shown to you as output)

Patchwork URLs: If you see a URL like https://example.com/#doc=ABCDEF&type=folder&title=Something, extract the doc ID from the #doc= parameter. The automerge URL is automerge:ABCDEF. Use this with fs.linkDoc(path, automergeUrl) or import(). Bare automerge URLs (automerge:ABCDEF) in your task are automatically linked into the workspace.

After each <script> block you will see the console output, return value, or any errors.
Use this to inspect results and decide your next steps.

Write text outside of script tags to explain your reasoning.
Keep your code concise and focused on the task.

Tips:
- For editing existing files, prefer fs.patchFile() for targeted changes over fs.writeFile() for full rewrites. This is more reliable and avoids issues with large content replacements.
- Use \`return value\` to inspect values; it's the most reliable way to see output.`;

function buildSkillsPromptSection(skills: SkillInfo[], rootFolderUrl: AutomergeUrl): string {
  const exampleSkill = skills[0];
  const lines = skills.map((s) => `- **${s.name}** — ${s.description}`);
  return `

## Available Skills

Skills are reusable modules in /skills/. Read a skill's README for full docs with fs.readDoc("/skills/<name>/README.md"), then import its code:

\`\`\`
const mod = await import("/${rootFolderUrl}/skills/${exampleSkill.folder}/index.js")
\`\`\`

${lines.join('\n')}`;
}

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
): Promise<{ output?: string; error?: string }> {
  capturedConsole.flush();

  // Re-inject the captured console before every eval to guard against
  // previous scripts accidentally deleting or overwriting the global.
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
  const fragmentRegex = /#doc=([A-Za-z0-9]+)([^\s]*)/g;
  let match;

  while ((match = fragmentRegex.exec(text)) !== null) {
    const docId = match[1];
    const rest = match[2] || '';

    const candidateUrl = `automerge:${docId}`;
    if (!isValidAutomergeUrl(candidateUrl)) continue;
    if (seen.has(docId)) continue;
    seen.add(docId);

    const titleMatch = rest.match(/[&?]title=([^&]*)/);
    const typeMatch = rest.match(/[&?]type=([^&]*)/);

    results.push({
      docId,
      title: titleMatch ? decodeURIComponent(titleMatch[1]) : undefined,
      type: typeMatch ? decodeURIComponent(typeMatch[1]) : undefined,
    });
  }

  // Match bare automerge: URLs (e.g. "automerge:442qEMJubfbNtu8bEikzX2j3Yyps")
  const bareRegex = /automerge:([A-Za-z0-9]+)/g;

  while ((match = bareRegex.exec(text)) !== null) {
    const docId = match[1];

    const candidateUrl = `automerge:${docId}`;
    if (!isValidAutomergeUrl(candidateUrl)) continue;
    if (seen.has(docId)) continue;
    seen.add(docId);

    results.push({ docId });
  }

  return results;
}

// --- Skill discovery ---

type SkillInfo = { name: string; description: string; folder: string };

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return result;
}

async function discoverSkills(fs: AutomergeFS): Promise<SkillInfo[]> {
  let entries: { name: string; type: string; url: string }[];
  try {
    entries = await fs.listFolder('/skills');
  } catch {
    return [];
  }

  const skills: SkillInfo[] = [];
  for (const entry of entries) {
    if (entry.type !== 'folder') continue;
    try {
      const readme = await fs.readDoc(`/skills/${entry.name}/README.md`);
      const fm = parseFrontmatter(readme);
      skills.push({
        name: fm.name || entry.name,
        description: fm.description || '',
        folder: entry.name,
      });
    } catch {
      // Skill folder without a README — skip
    }
  }
  return skills;
}

// --- Patchwork URL extraction and auto-linking ---

type LinkedDoc = { name: string; docId: string; type: string };

async function autoLinkPatchworkUrls(taskText: string, fs: AutomergeFS): Promise<LinkedDoc[]> {
  const extracted = extractPatchworkUrls(taskText);
  const linked: LinkedDoc[] = [];

  for (const doc of extracted) {
    const name = doc.title || doc.docId;
    const type = doc.type || 'folder';
    const automergeUrl = `automerge:${doc.docId}` as AutomergeUrl;

    try {
      await fs.linkDoc(`/${name}`, automergeUrl);
      linked.push({ name, docId: doc.docId, type });
    } catch {
      // If linking fails (e.g. root folder issue), skip silently
    }
  }

  return linked;
}
