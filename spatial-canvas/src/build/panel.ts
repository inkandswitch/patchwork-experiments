/**
 * BuildPanel — "Build It" button that runs an LLM process loop over the
 * currently selected shapes.
 *
 * On click it creates a ProcessDoc in the repo, sets the shapes JSON as the
 * prompt, mounts a <patchwork-view tool-id="process"> to render it live, and
 * drives the streaming + eval loop by writing into the ProcessDoc via
 * handle.change() — so the existing ProcessView renders output reactively.
 *
 * Core streaming/eval machinery copied from:
 *   llm-canvas/src/process/llm-process.ts
 *   llm-canvas/src/process/parser.ts
 */

import type { DocHandle } from "@automerge/automerge-repo";
import type { CanvasDoc, CanvasShape, Disposer } from "../canvas/types.js";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";

// =============================================================================
// Types — mirrored from llm-canvas/src/process/types.ts
// =============================================================================

type OutputBlock =
  | { type: "text"; content: string }
  | { type: "script"; code: string; description?: string; output?: string; error?: string };

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
};

type ParsedBlock =
  | { id: number; type: "text"; content: string; complete: boolean }
  | { id: number; type: "script"; code: string; description?: string; complete: boolean };

// Shape of ProcessDoc — mirrored from llm-canvas/src/process/types.ts
type ProcessDoc = {
  title: string;
  config: { apiUrl: string; model: string; skillsFolderUrl?: string };
  workspaceUrl: string;
  prompt: string;
  output: OutputBlock[];
  timestamp: number;
};

// =============================================================================
// Panel DOM
// =============================================================================

export default function BuildPanel(
  handle: DocHandle<CanvasDoc>,
  element: PatchworkViewElement,
): Disposer {
  const repo = element.repo;

  let abortController: AbortController | null = null;
  let processViewEl: HTMLElement | null = null;

  // Panel: fixed header + scrollable body
  element.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "min-width:200px",
    "max-width:340px",
  ].join(";");

  // ---- Fixed header (button only, never scrolls) ----
  const header = document.createElement("div");
  header.style.cssText = "flex-shrink:0;padding:8px 8px 6px;";
  element.appendChild(header);

  const buildBtn = document.createElement("button");
  buildBtn.textContent = "Build It";
  buildBtn.style.cssText = [
    "width:100%",
    "padding:6px 14px",
    "font:600 13px/1 system-ui,sans-serif",
    "background:#1a1a1a",
    "color:#fff",
    "border:none",
    "border-radius:6px",
    "cursor:pointer",
    "transition:background 0.15s",
  ].join(";");
  buildBtn.addEventListener("mouseenter", () => {
    if (!buildBtn.disabled) buildBtn.style.background = "#333";
  });
  buildBtn.addEventListener("mouseleave", () => {
    if (!buildBtn.disabled) buildBtn.style.background = "#1a1a1a";
  });
  header.appendChild(buildBtn);

  // ---- Scrollable body (image preview + process view) ----
  const body = document.createElement("div");
  body.style.cssText = [
    "flex:1",
    "overflow-y:auto",
    "max-height:55vh",
    "display:flex",
    "flex-direction:column",
    "gap:6px",
    "padding:0 8px 8px",
  ].join(";");
  element.appendChild(body);

  // ---- Image preview (shown after capture) ----
  const imgPreview = document.createElement("img");
  imgPreview.style.cssText = [
    "display:none",
    "width:100%",
    "border-radius:4px",
    "border:1px solid #e0e0e0",
    "object-fit:contain",
  ].join(";");
  body.appendChild(imgPreview);

  // ---- Click handler ----
  buildBtn.addEventListener("click", async () => {
    abortController?.abort();
    abortController = new AbortController();

    const doc = handle.doc();
    if (!doc) return;

    buildBtn.disabled = true;
    buildBtn.textContent = "Capturing…";
    buildBtn.style.background = "#888";

    // Always capture a fresh screenshot before building
    const imageDataUrl = await captureCanvas();
    if (imageDataUrl) {
      imgPreview.src = imageDataUrl;
      imgPreview.style.display = "block";
    } else {
      imgPreview.style.display = "none";
    }

    buildBtn.textContent = "Building…";

    const shapes: CanvasShape[] = Object.values(doc.shapes);

    // Create a fresh ProcessDoc for this run
    const apiUrl: string =
      (import.meta as any).env?.VITE_LLM_API_URL ?? "https://openrouter.ai/api/v1";
    const model: string = (import.meta as any).env?.VITE_LLM_MODEL ?? "anthropic/claude-opus-4-5";

    const processHandle = repo.create() as unknown as DocHandle<ProcessDoc>;
    processHandle.change((d: any) => {
      d.title = "Build";
      d.config = { apiUrl, model };
      d.workspaceUrl = "";
      d.prompt = "";
      d.output = [];
      d.timestamp = Date.now();
    });

    // Replace previous process view with a fresh patchwork-view
    processViewEl?.remove();
    const view = document.createElement("patchwork-view");
    view.setAttribute("doc-url", processHandle.url);
    view.setAttribute("tool-id", "process");
    view.style.cssText = "display:block;width:100%;";
    body.appendChild(view);
    processViewEl = view;

    // Auto-scroll the body as content streams in
    const scrollObserver = new MutationObserver(() => {
      body.scrollTop = body.scrollHeight;
    });
    scrollObserver.observe(view, { childList: true, subtree: true, characterData: true });

    try {
      await runBuildProcess(
        repo,
        processHandle,
        handle.url,
        shapes,
        abortController.signal,
        imageDataUrl ?? undefined,
      );
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        processHandle.change((d: any) => {
          d.output.push({ type: "text", content: `Error: ${err?.message ?? String(err)}` });
        });
      }
    } finally {
      scrollObserver.disconnect();
      buildBtn.disabled = false;
      buildBtn.textContent = "Build It";
      buildBtn.style.background = "#1a1a1a";
    }
  });

  return () => {
    abortController?.abort();
    element.innerHTML = "";
  };
}

// =============================================================================
// Streaming <script> block parser — copied from llm-canvas/src/process/parser.ts
// =============================================================================

async function* parseScriptBlocks(stream: AsyncIterable<string>): AsyncGenerator<ParsedBlock> {
  let buffer = "";
  let state: "text" | "script" = "text";
  let scriptBuffer = "";
  let blockId = 0;
  let currentDescription: string | undefined;

  const SCRIPT_PREFIX = "<script";
  const CLOSE_TAG = "</script>";

  for await (const chunk of stream) {
    buffer += chunk;

    while (true) {
      if (state === "text") {
        const scriptIdx = buffer.indexOf(SCRIPT_PREFIX);

        if (scriptIdx !== -1) {
          const afterPrefixIdx = scriptIdx + SCRIPT_PREFIX.length;
          if (afterPrefixIdx >= buffer.length) {
            if (scriptIdx > 0) {
              yield {
                id: blockId,
                type: "text",
                content: buffer.slice(0, scriptIdx),
                complete: true,
              };
              buffer = buffer.slice(scriptIdx);
            }
            break;
          }

          const afterChar = buffer[afterPrefixIdx];
          if (afterChar !== ">" && afterChar !== " " && afterChar !== "\t" && afterChar !== "\n") {
            yield {
              id: blockId,
              type: "text",
              content: buffer.slice(0, afterPrefixIdx),
              complete: true,
            };
            buffer = buffer.slice(afterPrefixIdx);
            continue;
          }

          const tagEndIdx = buffer.indexOf(">", afterPrefixIdx);
          if (tagEndIdx !== -1) {
            const openingTag = buffer.slice(scriptIdx, tagEndIdx + 1);
            const descMatch = openingTag.match(/data-description="([^"]*)"/);
            currentDescription = descMatch ? descMatch[1] : undefined;
            if (scriptIdx > 0) {
              yield {
                id: blockId,
                type: "text",
                content: buffer.slice(0, scriptIdx),
                complete: true,
              };
            }
            buffer = buffer.slice(tagEndIdx + 1);
            state = "script";
            scriptBuffer = "";
            blockId++;
          } else {
            if (scriptIdx > 0) {
              yield {
                id: blockId,
                type: "text",
                content: buffer.slice(0, scriptIdx),
                complete: true,
              };
              buffer = buffer.slice(scriptIdx);
            }
            break;
          }
        } else {
          const partialIdx = findPartialTag(buffer, SCRIPT_PREFIX);
          if (partialIdx < buffer.length) {
            if (partialIdx > 0) {
              yield {
                id: blockId,
                type: "text",
                content: buffer.slice(0, partialIdx),
                complete: true,
              };
            }
            buffer = buffer.slice(partialIdx);
          } else {
            if (buffer.length > 0) {
              yield { id: blockId, type: "text", content: buffer, complete: true };
              buffer = "";
            }
          }
          break;
        }
      } else {
        const closeIdx = buffer.indexOf(CLOSE_TAG);
        if (closeIdx !== -1) {
          scriptBuffer += buffer.slice(0, closeIdx);
          yield {
            id: blockId,
            type: "script",
            code: scriptBuffer,
            description: currentDescription,
            complete: true,
          };
          buffer = buffer.slice(closeIdx + CLOSE_TAG.length);
          state = "text";
          scriptBuffer = "";
          currentDescription = undefined;
          blockId++;
        } else {
          const partialIdx = findPartialTag(buffer, CLOSE_TAG);
          if (partialIdx < buffer.length) {
            scriptBuffer += buffer.slice(0, partialIdx);
            buffer = buffer.slice(partialIdx);
          } else {
            scriptBuffer += buffer;
            buffer = "";
          }
          if (scriptBuffer.length > 0) {
            yield {
              id: blockId,
              type: "script",
              code: scriptBuffer,
              description: currentDescription,
              complete: false,
            };
          }
          break;
        }
      }
    }
  }

  if (state === "text") {
    if (buffer.length > 0) yield { id: blockId, type: "text", content: buffer, complete: true };
  } else {
    scriptBuffer += buffer;
    if (scriptBuffer.length > 0)
      yield { id: blockId, type: "text", content: `<script>${scriptBuffer}`, complete: true };
  }
}

function findPartialTag(buffer: string, tag: string): number {
  for (let i = Math.max(0, buffer.length - tag.length + 1); i < buffer.length; i++) {
    if (tag.startsWith(buffer.slice(i))) return i;
  }
  return buffer.length;
}

// =============================================================================
// LLM streaming — copied from llm-canvas/src/process/llm-process.ts
// =============================================================================

async function* streamChatCompletion(
  apiUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const url = `${apiUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
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
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch {
        /* skip malformed JSON */
      }
    }
  }
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

async function evalScript(
  code: string,
  capturedConsole: ReturnType<typeof createCapturedConsole>,
): Promise<{ output?: string; error?: string }> {
  capturedConsole.flush();
  (globalThis as any).__llmCapturedConsole = capturedConsole;
  try {
    const wrapped = `(async () => { const console = globalThis.__llmCapturedConsole;\n${code}\n})()`;
    const returnValue = await eval(wrapped);
    const consoleOutput = capturedConsole.flush();
    const parts: string[] = [];
    if (consoleOutput) parts.push(consoleOutput);
    if (returnValue !== undefined) parts.push(stringifyArg(returnValue));
    const result: { output?: string; error?: string } = {};
    if (parts.length > 0) result.output = parts.join("\n");
    return result;
  } catch (err: any) {
    const consoleOutput = capturedConsole.flush();
    return {
      error: err.message || String(err),
      ...(consoleOutput ? { output: consoleOutput } : {}),
    };
  }
}

// =============================================================================
// Skill discovery — copied from llm-canvas/src/process/llm-process.ts
// =============================================================================

// Hardcoded skills folder URL (same as llm-canvas worker/datatype.ts)
const SKILLS_FOLDER_URL = "automerge:3dryb49P6WNaNEC54TFGpcGUZYJ2";

type SkillInfo = {
  name: string;
  description: string;
  importUrl: string;
};

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    result[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
  }
  return result;
}

async function discoverSkills(repo: any, skillsFolderUrl: string): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];
  try {
    const folderHandle = await repo.find(skillsFolderUrl);
    const folderDoc = folderHandle.doc();
    if (!folderDoc?.docs) return skills;

    for (const link of folderDoc.docs) {
      if (link.type !== "folder") continue;
      try {
        const skillFolderHandle = await repo.find(link.url);
        const skillFolderDoc = skillFolderHandle.doc();
        if (!skillFolderDoc?.docs) continue;

        const skillMd = skillFolderDoc.docs.find((d: any) => d.name === "SKILL.md");
        if (!skillMd) continue;

        const mdHandle = await repo.find(skillMd.url);
        const mdDoc = mdHandle.doc() as any;
        const content =
          typeof mdDoc?.content === "string"
            ? mdDoc.content
            : mdDoc?.content instanceof Uint8Array
              ? new TextDecoder().decode(mdDoc.content)
              : "";

        const frontmatter = parseFrontmatter(content);
        if (!frontmatter.name) continue;

        const indexFile = skillFolderDoc.docs.find((d: any) => d.name === "index.js");
        skills.push({
          name: frontmatter.name,
          description: frontmatter.description || "",
          importUrl: indexFile
            ? `/${skillsFolderUrl}/${link.name}/${indexFile.name}`
            : `/${skillsFolderUrl}/${link.name}`,
        });
      } catch {
        /* skip inaccessible skill folders */
      }
    }
  } catch {
    /* skills folder inaccessible */
  }
  return skills;
}

function buildSkillDescriptions(skills: SkillInfo[]): string {
  if (!skills.length) return "";
  return skills.map((s) => `  - ${s.name}: ${s.description}`).join("\n");
}

// =============================================================================
// System prompt
// =============================================================================

// =============================================================================
// Canvas screenshot via snapdom, scaled to max 1024×1024
// =============================================================================

async function captureCanvas(): Promise<string | null> {
  const canvasEl = document.querySelector(".sc-canvas") as HTMLElement | null;
  if (!canvasEl) {
    console.warn("[BuildPanel] .sc-canvas not found");
    return null;
  }

  try {
    const { snapdom } = await import("@zumer/snapdom");
    const captured = await snapdom.toCanvas(canvasEl);

    const MAX = 1024;
    const { width, height } = captured;
    const scale = Math.min(1, MAX / Math.max(width, height, 1));

    let dataUrl: string;
    if (scale < 1) {
      const offscreen = document.createElement("canvas");
      offscreen.width = Math.round(width * scale);
      offscreen.height = Math.round(height * scale);
      offscreen.getContext("2d")!.drawImage(captured, 0, 0, offscreen.width, offscreen.height);
      dataUrl = offscreen.toDataURL("image/png");
    } else {
      dataUrl = captured.toDataURL("image/png");
    }

    console.log(
      `[BuildPanel] captured ${Math.round(width * scale)}×${Math.round(height * scale)}, length=${dataUrl.length}`,
    );
    return dataUrl;
  } catch (err) {
    console.error("[BuildPanel] snapdom capture failed:", err);
    return null;
  }
}

function buildSystemPrompt(canvasDocUrl: string, skillDescriptions: string): string {
  let prompt = `You are a coding agent with full write access to a Patchwork spatial canvas document.

Your job is to BUILD what the user describes by adding shapes and documents directly to the canvas.
You must always produce code that writes to the canvas — do not just explain or plan.

The canvas document URL is: ${canvasDocUrl}

Canvas shape types:
  embed      — { id, type:'embed', x, y, zIndex, docUrl, docType, toolId, width, height }
  text       — { id, type:'text',  x, y, zIndex, text, color?, fontSize? }
  rectangle  — { id, type:'rectangle', x, y, zIndex, width, height, color?, fill? }

You can execute code by writing it inside <script> tags:

<script data-description="Place a markdown document on the canvas">
const { getCanvas } = await loadSkill('canvas');
const canvas = getCanvas(repo, canvasDocUrl);
const docHandle = repo.create();
docHandle.change(d => { d.content = '# Hello'; d.type = 'markdown'; });
await canvas.placeEmbed(docHandle.url, 'markdown', { width: 480, height: 320 });
</script>

Available APIs in your execution context:

  repo.find(url)      — find a document by URL (async, returns a handle)
  repo.create()       — create a new empty document (full write access, no review)

  handle.url          — the document URL
  handle.doc()        — get the current document state
  handle.change(fn)   — mutate the document immediately

  canvasDocUrl        — AutomergeUrl of the spatial canvas (already set)
  loadSkill(name)     — load a skill module by name
  console.log(...)    — output text (captured and shown to you)
  return value        — return a value from the script (shown to you as output)

After each <script> block you will see the console output, return value, or any errors.
Use the 'canvas' skill for placement — it handles smart positioning automatically.
Always write directly to the canvas. Do not ask for confirmation.`;

  if (skillDescriptions) {
    prompt += `\n\nAvailable skills:\n${skillDescriptions}`;
  }
  return prompt;
}

// =============================================================================
// Process loop — writes into a ProcessDoc handle so patchwork-view renders it
// =============================================================================

function buildCanvasSummary(embedShapes: CanvasShape[], textContent: string): string {
  const parts: string[] = [];
  if (embedShapes.length > 0) {
    parts.push(`Embedded documents:\n${JSON.stringify(embedShapes, null, 2)}`);
  }
  if (textContent) {
    parts.push(`Text on canvas:\n${textContent}`);
  }
  if (parts.length === 0) {
    parts.push("(canvas is empty)");
  }
  return parts.join("\n\n");
}

async function runBuildProcess(
  repo: any,
  processHandle: DocHandle<ProcessDoc>,
  canvasDocUrl: string,
  shapes: CanvasShape[],
  signal: AbortSignal,
  imageDataUrl?: string,
): Promise<void> {
  (globalThis as any).repo = repo;
  (globalThis as any).canvasDocUrl = canvasDocUrl;

  const capturedConsole = createCapturedConsole();

  const embedShapes = shapes.filter((s) => s.type === "embed");
  const textContent = shapes
    .filter((s) => s.type === "text")
    .map((s) => (s as any).text as string)
    .filter(Boolean)
    .join("\n");

  const summary = buildCanvasSummary(embedShapes, textContent);
  const userPrompt = `${summary}\n\nBuild this.`;

  const apiUrl: string =
    (import.meta as any).env?.VITE_LLM_API_URL ?? "https://openrouter.ai/api/v1";
  const apiKey: string = (import.meta as any).env?.VITE_LLM_API_KEY ?? "";
  const model: string = (import.meta as any).env?.VITE_LLM_MODEL ?? "anthropic/claude-opus-4-5";

  // Discover skills and expose loadSkill in the eval context
  const skills = await discoverSkills(repo, SKILLS_FOLDER_URL);
  const loadSkill = async (name: string) => {
    const skill = skills.find((s) => s.name === name);
    if (!skill) {
      const available = skills.map((s) => s.name).join(", ");
      throw new Error(`Skill not found: "${name}". Available: [${available}]`);
    }
    return import(skill.importUrl);
  };
  (globalThis as any).loadSkill = loadSkill;

  const systemPrompt = buildSystemPrompt(canvasDocUrl, buildSkillDescriptions(skills));

  // Write prompt into the ProcessDoc so the process viewer shows it
  processHandle.change((d: any) => {
    d.prompt = userPrompt;
  });

  const MAX_ITERATIONS = 10;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (signal.aborted) break;

    const currentDoc = processHandle.doc();
    if (!currentDoc) break;

    // Build conversation messages from current ProcessDoc output
    const firstUserContent: ChatMessage["content"] =
      imageDataUrl && iteration === 0
        ? [
            { type: "image_url", image_url: { url: imageDataUrl } },
            { type: "text", text: userPrompt },
          ]
        : userPrompt;

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: firstUserContent },
    ];

    const priorOutput: OutputBlock[] = (currentDoc as any).output ?? [];
    let assistantParts: string[] = [];
    for (const block of priorOutput) {
      if (block.type === "text") {
        assistantParts.push(block.content);
      } else if (block.type === "script") {
        const tag = block.description
          ? `<script data-description="${block.description}">\n${block.code}\n</script>`
          : `<script>\n${block.code}\n</script>`;
        assistantParts.push(tag);
        if (block.output !== undefined) {
          messages.push({ role: "assistant", content: assistantParts.join("\n") });
          assistantParts = [];
          messages.push({
            role: "user",
            content: block.error
              ? `[Error: ${block.error}]`
              : block.output
                ? `[Output: ${block.output}]`
                : "[Done]",
          });
        }
      }
    }
    if (assistantParts.length > 0) {
      messages.push({ role: "assistant", content: assistantParts.join("\n") });
    }

    const stream = streamChatCompletion(apiUrl, apiKey, model, messages, signal);
    let foundScript = false;

    for await (const block of parseScriptBlocks(stream)) {
      if (signal.aborted) break;

      if (block.type === "text" && block.content.trim().length > 0) {
        processHandle.change((d: any) => {
          const last = d.output[d.output.length - 1];
          if (last?.type === "text") {
            last.content += block.content;
          } else {
            d.output.push({ type: "text", content: block.content });
          }
        });
      }

      if (block.type === "script") {
        processHandle.change((d: any) => {
          const last = d.output[d.output.length - 1];
          if (last?.type === "script" && last.output === undefined) {
            last.code = block.code;
          } else {
            const entry: OutputBlock = { type: "script", code: block.code };
            if (block.description) (entry as any).description = block.description;
            d.output.push(entry);
          }
        });

        if (block.complete) {
          foundScript = true;
          const result = await evalScript(block.code, capturedConsole);
          processHandle.change((d: any) => {
            const last = d.output[d.output.length - 1];
            if (last?.type === "script") {
              last.output = result.output ?? "";
              if (result.error) last.error = result.error;
            }
          });
          break;
        }
      }
    }

    if (!foundScript) break;
  }
}
