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

import type { Repo } from "@automerge/automerge-repo";
import { updateText, type AutomergeUrl } from "@automerge/automerge-repo";
import { parseScriptBlocks } from "./parser";
import type { LLMDoc, LLMWorkspaceDoc, OutputBlock, ChatMessage } from "./types";
import { SYSTEM_PROMPT } from "./system-prompt";

// Inline folder doc type — avoids requiring @inkandswitch/patchwork-filesystem
type FolderDoc = {
  docs: { type: string; name: string; url: AutomergeUrl }[];
};

type SkillInfo = {
  name: string;
  description: string;
  content: string;
  importUrl?: string;
};

function swPath(automergeUrl: string): string {
  return automergeUrl.replace("automerge:", "automerge%3A");
}

function stringifyArg(arg: any): string {
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg, null, 2);
  } catch {
    return "[object]";
  }
}

function createCapturedConsole() {
  const output: string[] = [];
  return {
    log: (...args: any[]) => {
      output.push(args.map(stringifyArg).join(" "));
    },
    error: (...args: any[]) => {
      output.push("[error] " + args.map(stringifyArg).join(" "));
    },
    warn: (...args: any[]) => {
      output.push("[warn] " + args.map(stringifyArg).join(" "));
    },
    info: (...args: any[]) => {
      output.push(args.map(stringifyArg).join(" "));
    },
    flush(): string {
      const text = output.join("\n");
      output.length = 0;
      return text;
    },
  };
}

export async function runLLMProcess(repo: Repo, processDocUrl: AutomergeUrl, signal?: AbortSignal): Promise<void> {
  const handle = await repo.find<LLMDoc>(processDocUrl);
  const doc = await handle.doc();

  if (!doc?.prompt) {
    throw new Error("No prompt to run");
  }

  const { apiUrl, model } = doc.config;
  const apiKey = (import.meta as any).env?.VITE_OPENAI_API_KEY || "";

  const capturedConsole = createCapturedConsole();

  const skills = doc.workspaceUrl ? await discoverSkillsFromWorkspace(repo, doc.workspaceUrl) : [];
  const skillDescriptions = buildSkillDescriptions(skills);

  const workspaceContext = doc.workspaceUrl ? await buildWorkspaceContext(repo, doc.workspaceUrl) : undefined;

  const loadSkillDocs = async (name: string): Promise<string> => {
    const skill = skills.find((s) => s.name === name);
    if (!skill) {
      const available = skills.map((s) => s.name).join(", ");
      throw new Error(`Skill not found: "${name}". Available: [${available}]`);
    }
    return skill.content;
  };

  const importSkillApi = async (name: string): Promise<Record<string, unknown>> => {
    const skill = skills.find((s) => s.name === name);
    if (!skill) {
      const available = skills.map((s) => s.name).join(", ");
      throw new Error(`Skill not found: "${name}". Available: [${available}]`);
    }
    if (!skill.importUrl) {
      throw new Error(`Skill "${name}" has no importable API module. Use loadSkillDocs("${name}") to read its documentation.`);
    }
    return await import(/* @vite-ignore */ skill.importUrl);
  };

  const getSkillURL = (name: string): string => {
    const skill = skills.find((s) => s.name === name);
    if (!skill) {
      const available = skills.map((s) => s.name).join(", ");
      throw new Error(`Skill not found: "${name}". Available: [${available}]`);
    }
    if (!skill.importUrl) {
      throw new Error(`Skill "${name}" has no importable API module.`);
    }
    return skill.importUrl;
  };

  const globals: Record<string, unknown> = {
    repo: wrapRepoForLLM(repo, doc.workspaceUrl),
    console: capturedConsole,
    loadSkillDocs,
    importSkillApi,
    getSkillURL,
  };

  console.log(`[llm] starting run: model=${model}, apiUrl=${apiUrl}`);
  console.log(`[llm] prompt:\n${doc.prompt}`);

  await runLoop(
    handle,
    (currentDoc) => buildLLMMessages(currentDoc, skillDescriptions, workspaceContext),
    apiUrl,
    apiKey,
    model,
    capturedConsole,
    globals,
    signal,
  );
}

/**
 * Run an LLM process without skill discovery or workspace context.
 * The process doc must have `systemPrompt` set — it is used verbatim as the
 * system message with no additions. Suitable for self-contained prompts that
 * embed all necessary code and context directly.
 *
 * @param customGlobals - Optional map of functions to expose to LLM scripts
 */
export async function runLLMProcessRaw(
  repo: Repo,
  processDocUrl: AutomergeUrl,
  signal?: AbortSignal,
  customGlobals?: Record<string, unknown>,
): Promise<void> {
  const handle = await repo.find<LLMDoc>(processDocUrl);
  const doc = await handle.doc();

  if (!doc?.prompt) {
    throw new Error("No prompt to run");
  }
  if (!doc?.systemPrompt) {
    throw new Error("runLLMProcessRaw requires doc.systemPrompt to be set");
  }

  const { apiUrl, model } = doc.config;
  const apiKey = (import.meta as any).env?.VITE_OPENAI_API_KEY || "";

  const capturedConsole = createCapturedConsole();

  const globals: Record<string, unknown> = {
    repo,
    console: capturedConsole,
    ...customGlobals,
  };

  console.log(`[llm] starting raw run: model=${model}, apiUrl=${apiUrl}`);
  console.log(`[llm] prompt:\n${doc.prompt}`);

  await runLoop(
    handle,
    (currentDoc) => buildRawMessages(currentDoc),
    apiUrl,
    apiKey,
    model,
    capturedConsole,
    globals,
    signal,
  );
}

// ─── Shared iteration loop ────────────────────────────────────────────────────

async function runLoop(
  handle: import("@automerge/automerge-repo").DocHandle<LLMDoc>,
  buildMessages: (doc: LLMDoc) => ChatMessage[],
  apiUrl: string,
  apiKey: string,
  model: string,
  capturedConsole: ReturnType<typeof createCapturedConsole>,
  globals: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<void> {
  const MAX_ITERATIONS = 20;

  let iteration = 0;
  for (; iteration < MAX_ITERATIONS; iteration++) {
    if (signal?.aborted) {
      console.log("[llm] aborted before iteration", iteration);
      break;
    }

    const currentDoc = await handle.doc();
    if (!currentDoc) break;

    const messages = buildMessages(currentDoc);
    if (iteration === 0) {
      console.log(`[llm] system prompt:\n${messages[0]?.content}`);
    }
    console.log(`[llm] iteration ${iteration}: sending ${messages.length} messages to ${model}`);

    const stream = streamChatCompletion(apiUrl, apiKey, model, messages, signal);

    let foundScript = false;

    for await (const block of parseScriptBlocks(stream)) {
      if (signal?.aborted) break;

      if (block.type === "text" && block.content.trim().length > 0) {
        handle.change((d) => {
          const last = d.output[d.output.length - 1];
          if (last && last.type === "text") {
            const outputIdx = d.output.length - 1;
            updateText(d, ["output", outputIdx, "content"], last.content + block.content);
          } else {
            d.output.push({ type: "text", content: block.content });
          }
        });
      }

      if (block.type === "script") {
        handle.change((d) => {
          const last = d.output[d.output.length - 1];
          if (last && last.type === "script" && last.output === undefined) {
            const outputIdx = d.output.length - 1;
            updateText(d, ["output", outputIdx, "code"], block.code);
          } else {
            if (block.description) {
              d.output.push({ type: "script", code: block.code, description: block.description });
            } else {
              d.output.push({ type: "script", code: block.code });
            }
          }
        });

        if (block.complete) {
          foundScript = true;
          console.log(`[llm] iteration ${iteration}: evaluating script (description="${block.description ?? ""}", ${block.code.length} chars)`);

          const result = await evalScript(block.code, capturedConsole, globals);
          console.log(`[llm] iteration ${iteration}: eval result`, result.error ? `ERROR: ${result.error}` : `output: ${result.output ?? "(none)"}`);

          handle.change((d) => {
            const outputIdx = d.output.length - 1;
            const scriptBlock = d.output[outputIdx];
            if (scriptBlock.type !== "script") return;
            scriptBlock.output = "";
            if (result.output) {
              updateText(d, ["output", outputIdx, "output"], result.output);
            }
            if (result.error) {
              scriptBlock.error = "";
              updateText(d, ["output", outputIdx, "error"], result.error);
            }
          });

          break;
        }
      }
    }

    console.log(`[llm] iteration ${iteration}: stream complete, foundScript=${foundScript}`);

    if (!foundScript) {
      console.log("[llm] no script found — run complete");
      break;
    }
  }

  if (iteration >= MAX_ITERATIONS) {
    console.warn("[llm] reached max iterations limit");
  }

  handle.change((d) => {
    d.done = true;
  });

  console.log("[llm] run finished");
}

// --- Skill discovery ---

async function discoverSkillsFromWorkspace(repo: Repo, workspaceUrl: AutomergeUrl): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  try {
    const wsHandle = await repo.find<LLMWorkspaceDoc>(workspaceUrl);
    const wsDoc = await wsHandle.doc();
    if (!wsDoc?.entries || !Object.keys(wsDoc.entries).length) return skills;

    for (const url of Object.keys(wsDoc.entries) as AutomergeUrl[]) {
      try {
        const docHandle = await repo.find<FolderDoc>(url);
        const doc = await docHandle.doc();
        if (!Array.isArray(doc?.docs)) continue;

        // This workspace entry is a folder — look for skill subfolders inside it
        for (const link of doc.docs) {
          if (link.type !== "folder") continue;
          await discoverSkillInFolder(repo, link.url, skills);
        }
      } catch {
        // Skip inaccessible workspace entries
      }
    }
  } catch {
    // Workspace inaccessible
  }

  return skills;
}

async function discoverSkillInFolder(repo: Repo, folderUrl: AutomergeUrl, skills: SkillInfo[]): Promise<void> {
  try {
    const folderHandle = await repo.find<FolderDoc>(folderUrl);
    const folderDoc = await folderHandle.doc();
    if (!folderDoc?.docs) return;

    const skillMdEntry = folderDoc.docs.find((d) => d.name === "SKILL.md");
    if (!skillMdEntry) return;

    const mdHandle = await repo.find(skillMdEntry.url);
    const mdDoc = (await mdHandle.doc()) as any;
    const content = typeof mdDoc?.content === "string" ? mdDoc.content : mdDoc?.content instanceof Uint8Array ? new TextDecoder().decode(mdDoc.content) : "";

    const frontmatter = parseFrontmatter(content);
    if (!frontmatter.name) return;

    const indexEntry = folderDoc.docs.find((d) => d.name === "index.js");
    skills.push({
      name: frontmatter.name,
      description: frontmatter.description || "",
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
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    result[key] = value;
  }
  return result;
}

function wrapRepoForLLM(repo: Repo, workspaceUrl: AutomergeUrl | undefined): Repo {
  if (!workspaceUrl) return repo;
  const wsUrl: AutomergeUrl = workspaceUrl;

  function ensureEntryExists(url: AutomergeUrl) {
    queueMicrotask(async () => {
      try {
        const wsHandle = await repo.find<LLMWorkspaceDoc>(wsUrl);
        await wsHandle.whenReady();
        wsHandle.change((d) => {
          if (!(url in d.entries)) {
            d.entries[url] = { url, changedAt: null };
          }
        });
      } catch { /* best-effort */ }
    });
  }

  function wrapHandle(handle: import("@automerge/automerge-repo").DocHandle<any>, url: AutomergeUrl) {
    return {
      url: handle.url,
      doc: () => handle.doc(),
      change: (fn: (doc: any) => void) => {
        const preHeads = handle.heads();
        handle.change(fn);
        queueMicrotask(async () => {
          try {
            const wsHandle = await repo.find<LLMWorkspaceDoc>(wsUrl);
            await wsHandle.whenReady();
            wsHandle.change((d) => {
              if (d.entries[url]?.changedAt === null) {
                d.entries[url].changedAt = preHeads;
              }
            });
          } catch { /* best-effort */ }
        });
      },
    };
  }

  return new Proxy(repo, {
    get(target, prop) {
      if (prop === "find") {
        return async (url: AutomergeUrl) => {
          const handle = await target.find(url);
          if (url === wsUrl) return handle;
          ensureEntryExists(url);
          return wrapHandle(handle, url);
        };
      }
      if (prop === "create") {
        return (...args: Parameters<Repo["create"]>) => {
          const newHandle = target.create(...args);
          const url = newHandle.url as AutomergeUrl;
          ensureEntryExists(url);
          return wrapHandle(newHandle, url);
        };
      }
      const value = (target as any)[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function buildSkillDescriptions(skills: SkillInfo[]): string {
  if (!skills.length) return "";
  return skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
}

async function buildWorkspaceContext(repo: Repo, workspaceUrl: AutomergeUrl): Promise<string> {
  try {
    const wsHandle = await repo.find<LLMWorkspaceDoc>(workspaceUrl);
    const wsDoc = await wsHandle.doc();
    if (!wsDoc?.entries || !Object.keys(wsDoc.entries).length) return "";

    const lines: string[] = [];
    for (const url of Object.keys(wsDoc.entries) as AutomergeUrl[]) {
      try {
        const docHandle = await repo.find<any>(url);
        const doc = await docHandle.doc();

        // Skip folder documents (skills folders, directory listings, etc.)
        if (Array.isArray(doc?.docs)) continue;

        const title = doc?.title || doc?.name || doc?.["@patchwork"]?.type || "document";
        lines.push(`  - ${title}: ${url}`);
      } catch {
        // Skip inaccessible documents silently
      }
    }

    return lines.join("\n");
  } catch {
    return "";
  }
}

// --- LLM message building ---

function buildRawMessages(doc: LLMDoc): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: "system", content: doc.systemPrompt! },
    { role: "user", content: doc.prompt },
  ];
  if (doc.output.length > 0) {
    appendOutputMessages(messages, doc.output);
  }
  return messages;
}

export function buildLLMMessages(doc: LLMDoc, skillDescriptions?: string, workspaceContext?: string): ChatMessage[] {
  const messages: ChatMessage[] = [];

  let systemPrompt = SYSTEM_PROMPT;

  if (workspaceContext) {
    systemPrompt += `\n\nDocuments in the workspace (this list is exhaustive — no other documents exist unless you create them):\n${workspaceContext}\nUse repo.find(url) to open a document. If no suitable document exists, create one using the appropriate skill.`;
  } else {
    systemPrompt += `\n\nThere are no documents in the workspace yet. Create any documents you need using the appropriate skill.`;
  }

  if (skillDescriptions) {
    systemPrompt += `\n\nAvailable skills:\n${skillDescriptions}\n\nUse \`await loadSkillDocs('name')\` to read a skill's documentation. Use \`await importSkillApi('name')\` to import its runtime API. Use \`getSkillURL('name')\` to get a skill's import URL for embedding in prompts.`;
  }

  messages.push({ role: "system", content: systemPrompt });

  if (doc.previousMessages) {
    for (const msg of doc.previousMessages) {
      if (msg.role !== "system") {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
  }

  messages.push({ role: "user", content: doc.prompt });

  if (doc.output.length > 0) {
    appendOutputMessages(messages, doc.output);
  }

  return messages;
}

function appendOutputMessages(messages: ChatMessage[], blocks: OutputBlock[]): void {
  let assistantParts: string[] = [];

  for (const block of blocks) {
    if (block.type === "text") {
      assistantParts.push(block.content);
    } else if (block.type === "script") {
      if (block.description) {
        assistantParts.push(`<script data-description="${block.description}">\n${block.code}\n</script>`);
      } else {
        assistantParts.push(`<script>\n${block.code}\n</script>`);
      }

      if (block.output !== undefined) {
        if (assistantParts.length > 0) {
          messages.push({ role: "assistant", content: assistantParts.join("\n") });
          assistantParts = [];
        }
        let resultText: string;
        if (block.error) resultText = `[Error: ${block.error}]`;
        else if (block.output) resultText = `[Output: ${block.output}]`;
        else resultText = "[Done]";
        messages.push({ role: "user", content: resultText });
      }
    }
  }

  if (assistantParts.length > 0) {
    messages.push({ role: "assistant", content: assistantParts.join("\n") });
  }
}

// --- LLM streaming ---

async function* streamChatCompletion(apiUrl: string, apiKey: string, model: string, messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string> {
  const url = `${apiUrl.replace(/\/$/, "")}/chat/completions`;

  const t0 = performance.now();
  console.log(`[llm:stream] fetch → ${url}`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      "HTTP-Referer": globalThis.location?.origin ?? "http://localhost",
      "X-Title": "Patchwork",
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });

  console.log(`[llm:stream] response headers received +${(performance.now() - t0).toFixed(0)}ms status=${response.status}`);

  if (!response.ok) {
    const text = await response.text();
    console.error(`[llm] API error ${response.status} from ${url}:`, text);
    throw new Error(`LLM API error (${response.status}): ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let chunkIndex = 0;
  let tokenCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let tokensInChunk = 0;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]") {
          console.log(`[llm:stream] [DONE] after ${tokenCount} tokens, total time +${(performance.now() - t0).toFixed(0)}ms`);
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
        console.log(`[llm:stream] chunk #${chunkIndex} +${(performance.now() - t0).toFixed(0)}ms → ${tokensInChunk} token(s), total=${tokenCount}`);
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
  globals: Record<string, unknown>,
): Promise<{ output?: string; error?: string }> {
  capturedConsole.flush();

  // Build parameter list and values from globals
  const paramNames = Object.keys(globals);
  const paramValues = Object.values(globals);

  try {
    // Wrap code in an async function that receives globals as parameters
    const wrappedCode = `(async function(${paramNames.join(', ')}) {\n${code}\n})`;
    const fn = eval(wrappedCode);
    const returnValue = await fn(...paramValues);

    const consoleOutput = capturedConsole.flush();
    const parts: string[] = [];
    if (consoleOutput) parts.push(consoleOutput);
    if (returnValue !== undefined) parts.push(stringifyArg(returnValue));

    const result: { output?: string; error?: string } = {};
    if (parts.length > 0) result.output = parts.join("\n");
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
