import type {
  AutomergeUrl,
  DocHandle,
  Repo,
} from "@automerge/automerge-repo";
import { parseScriptBlocks } from "./parser";
import { createCardApi, createFilesApi, type Card, type Files } from "./files";
import { createSkillsApi, type Skills } from "./skills";
import { SYSTEM_PROMPT, buildTaskMessage } from "./prompt";
import type { CardDocLike, ContentBlock, Message } from "./types";

// Adapted from the llm tool's runLLMProcess (llm/src/llm-process/run.ts): the
// same stream → parse <script> blocks → eval → feed results back loop, but
// messages live in memory for one run (reported through `onUpdate` for the log
// panel) and the eval scope is the files-as-text API over the card's package
// instead of a general workspace.
const API_URL = "https://openrouter.ai/api/v1";
// Inlined at build time from .env (VITE_OPENROUTER_API_KEY) — the key never
// lives in source, but note it does end up in the published dist bundle.
const API_KEY: string | undefined = import.meta.env.VITE_OPENROUTER_API_KEY;
const MODEL = "anthropic/claude-sonnet-4.6";
const MAX_ITERATIONS = 20;

type ApiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type RunResult = {
  // Whether the run repointed the card at a new module (card.setSource). When
  // false, any file edits won't reload — dynamic imports are cached by URL —
  // so the UI should warn.
  sourceWasSet: boolean;
  error?: string;
};

export async function runCardGeneration(options: {
  repo: Repo;
  packageUrl: AutomergeUrl;
  cardHandle: DocHandle<CardDocLike>;
  signal?: AbortSignal;
  onUpdate: (messages: Message[]) => void;
}): Promise<RunResult> {
  const { repo, packageUrl, cardHandle, signal, onUpdate } = options;

  if (!API_KEY) {
    return {
      sourceWasSet: false,
      error:
        "No API key baked into this build — set VITE_OPENROUTER_API_KEY in embark/cards/inspect/.env and rebuild.",
    };
  }

  const files = createFilesApi(repo, packageUrl);
  const { card, sourceWasSet } = createCardApi(cardHandle, packageUrl);
  const skills = createSkillsApi();
  const capturedConsole = createCapturedConsole();

  const messages: Message[] = [];
  const publish = () => onUpdate(structuredClone(messages));

  const spec = await readOptional(files, "spec.md");
  const modulePath = modulePathOf(cardHandle, packageUrl);
  const moduleSource = modulePath ? await readOptional(files, modulePath) : null;
  messages.push({
    role: "user",
    content: buildTaskMessage({ spec: spec ?? "", modulePath, moduleSource }),
  });
  publish();

  let runError: string | undefined;

  try {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      if (signal?.aborted) break;

      const apiMessages = serializeForApi(SYSTEM_PROMPT, messages);

      const assistant: Message = { role: "assistant", content: [] };
      messages.push(assistant);
      const content = assistant.content as ContentBlock[];

      const stream = streamChatCompletion(MODEL, apiMessages, signal);
      let foundScript = false;

      for await (const block of parseScriptBlocks(stream)) {
        if (signal?.aborted) break;

        if (block.type === "text" && block.content.trim().length > 0) {
          const last = content[content.length - 1];
          if (last && last.type === "text") {
            last.text += block.content;
          } else {
            content.push({ type: "text", text: block.content });
          }
          publish();
        }

        if (block.type === "script") {
          const last = content[content.length - 1];
          if (
            last?.type === "script" &&
            last.output === undefined &&
            last.error === undefined
          ) {
            last.code = block.code;
          } else {
            const scriptBlock: ContentBlock = { type: "script", code: block.code };
            if (block.description) scriptBlock.description = block.description;
            content.push(scriptBlock);
          }
          publish();

          if (block.complete) {
            foundScript = true;

            const result = await evalScript(
              block.code,
              files,
              card,
              skills,
              capturedConsole,
            );

            const scriptPart = content[content.length - 1];
            if (scriptPart?.type === "script") {
              if (result.output !== undefined) scriptPart.output = result.output;
              if (result.error !== undefined) scriptPart.error = result.error;
              if (result.output === undefined && result.error === undefined) {
                scriptPart.output = "";
              }
            }
            publish();
            break;
          }
        }
      }

      if (!foundScript) break;
    }
  } catch (err) {
    runError = err instanceof Error ? err.message : String(err);
  }

  publish();
  const result: RunResult = { sourceWasSet: sourceWasSet() };
  if (runError !== undefined) result.error = runError;
  return result;
}

// The current module's package-relative path, recovered from the card's `src`
// (`/automerge%3A<pkg>/dist/card.js` → `dist/card.js`) — but only when the
// module actually lives in this package.
function modulePathOf(
  cardHandle: DocHandle<CardDocLike>,
  packageUrl: AutomergeUrl,
): string | null {
  const src = cardHandle.doc()?.src;
  if (typeof src !== "string" || !src) return null;
  const segments = src.replace(/^\//, "").split("/");
  const root = decodeURIComponent(segments[0] ?? "").split("#")[0];
  if (root !== packageUrl) return null;
  const path = segments.slice(1).join("/");
  return path || null;
}

async function readOptional(files: Files, path: string): Promise<string | null> {
  try {
    return await files.read(path);
  } catch {
    return null;
  }
}

// --- message serialization (unchanged from the llm tool) ----------------------

function serializeForApi(systemPrompt: string, messages: Message[]): ApiMessage[] {
  const apiMessages: ApiMessage[] = [{ role: "system", content: systemPrompt }];

  for (const msg of messages) {
    if (msg.role === "assistant") {
      serializeAssistantMessage(apiMessages, msg);
    } else {
      const content =
        typeof msg.content === "string" ? msg.content : serializeParts(msg.content);
      apiMessages.push({ role: msg.role, content });
    }
  }

  return apiMessages;
}

function serializeAssistantMessage(apiMessages: ApiMessage[], msg: Message): void {
  const parts =
    typeof msg.content === "string"
      ? [{ type: "text" as const, text: msg.content }]
      : msg.content;
  let textAccum = "";

  for (const part of parts) {
    if (part.type === "text") {
      textAccum += part.text;
    } else if (part.type === "script") {
      textAccum += part.description
        ? `<script data-description="${part.description}">\n${part.code}\n</script>`
        : `<script>\n${part.code}\n</script>`;

      if (part.output !== undefined || part.error !== undefined) {
        if (textAccum) {
          apiMessages.push({ role: "assistant", content: textAccum });
          textAccum = "";
        }
        const resultText = part.error
          ? `[Error: ${part.error}]`
          : part.output
            ? `[Output: ${part.output}]`
            : "[Done]";
        apiMessages.push({ role: "user", content: resultText });
      }
    }
  }

  if (textAccum) {
    apiMessages.push({ role: "assistant", content: textAccum });
  }
}

function serializeParts(parts: ContentBlock[]): string {
  return parts
    .map((p) => {
      if (p.type === "text") return p.text;
      if (p.type === "script") {
        let s = p.description
          ? `<script data-description="${p.description}">\n${p.code}\n</script>`
          : `<script>\n${p.code}\n</script>`;
        if (p.error) s += `\n[Error: ${p.error}]`;
        else if (p.output) s += `\n[Output: ${p.output}]`;
        return s;
      }
      return "";
    })
    .join("");
}

// --- script evaluation ---------------------------------------------------------

async function evalScript(
  code: string,
  files: Files,
  card: Card,
  skills: Skills,
  capturedConsole: ReturnType<typeof createCapturedConsole>,
): Promise<{ output?: string; error?: string }> {
  capturedConsole.flush();

  try {
    const fn = new Function(
      "files",
      "card",
      "skills",
      "console",
      `return (async () => {
        ${code}
      })();`,
    );

    const returnValue = await fn(files, card, skills, capturedConsole);
    const consoleOutput = capturedConsole.flush();
    const parts: string[] = [];
    if (consoleOutput) parts.push(consoleOutput);
    if (returnValue !== undefined) parts.push(stringifyArg(returnValue));

    return parts.length > 0 ? { output: parts.join("\n") } : {};
  } catch (err) {
    const consoleOutput = capturedConsole.flush();
    return {
      error: err instanceof Error ? err.message : String(err),
      ...(consoleOutput ? { output: consoleOutput } : {}),
    };
  }
}

function stringifyArg(arg: unknown): string {
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
    log: (...args: unknown[]) => output.push(args.map(stringifyArg).join(" ")),
    error: (...args: unknown[]) =>
      output.push("[error] " + args.map(stringifyArg).join(" ")),
    warn: (...args: unknown[]) =>
      output.push("[warn] " + args.map(stringifyArg).join(" ")),
    info: (...args: unknown[]) => output.push(args.map(stringifyArg).join(" ")),
    flush(): string {
      const text = output.join("\n");
      output.length = 0;
      return text;
    },
  };
}

// --- streaming (unchanged from the llm tool) ------------------------------------

async function* streamChatCompletion(
  model: string,
  messages: ApiMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const url = `${API_URL}/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
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

  try {
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
          // Skip malformed JSON
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
