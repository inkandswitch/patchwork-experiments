import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import {
  formatInventory,
  gatherCanvasInventory,
  type CanvasDocInfo,
} from "./canvas-inventory";
import { parseScriptBlocks } from "./parser";
import { SYSTEM_PROMPT } from "./prompt";
import {
  GiveUpSignal,
  createCapturedConsole,
  createLoopApi,
  stringifyArg,
} from "./runtime";
import type {
  CapturedConsole,
  ChatMessage,
  LlmCardDoc,
  LoopApi,
  TranscriptEntry,
} from "../types";

const MAX_ITERATIONS = 15;

// Run the generation loop for a card. Streams chat completions, parses
// <script> blocks out of the response, evaluates them against the live canvas
// (writing files into the card's folder), and feeds results back until the
// model stops emitting scripts, calls giveUp, or we hit the iteration cap.
// Everything streams into `cardHandle.doc().transcript` for the UI.
export async function runLlmLoop(
  element: ToolElement,
  cardHandle: DocHandle<LlmCardDoc>,
  folderUrl: AutomergeUrl,
  signal?: AbortSignal,
): Promise<{ gaveUp?: string }> {
  const doc = cardHandle.doc();
  if (!doc) throw new Error("card document not found");

  const { apiUrl, model } = doc.config;
  const apiKey = (import.meta as { env?: Record<string, string> }).env
    ?.VITE_LLM_API_KEY ?? "";

  const captured = createCapturedConsole();
  const api = createLoopApi(element, folderUrl, captured);

  // Snapshot what's on the canvas once up front so every turn can tell the
  // model what it's working with (name + type only; it reads contents itself).
  const inventory = await gatherCanvasInventory(api, cardHandle.url);

  // If this card was generated before, hand the model its previous effect.js as
  // a starting point so it edits rather than rewrites from scratch.
  const previousEffect = await api.readFile(doc.entry ?? "effect.js");

  let gaveUp: string | undefined;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (signal?.aborted) break;

    const current = cardHandle.doc();
    if (!current) break;

    const messages = buildMessages(
      current.description,
      inventory,
      previousEffect,
      current.transcript,
    );
    const stream = streamChatCompletion(apiUrl, apiKey, model, messages, signal);

    let foundScript = false;

    for await (const block of parseScriptBlocks(stream)) {
      if (signal?.aborted) break;

      if (block.type === "text" && block.content.trim().length > 0) {
        appendText(cardHandle, block.content);
      }

      if (block.type === "script") {
        upsertScript(cardHandle, block.code, block.description);

        if (block.complete) {
          foundScript = true;
          const result = await evalScript(block.code, api, captured);
          recordResult(cardHandle, result);
          if (result.gaveUp !== undefined) gaveUp = result.gaveUp;
          break;
        }
      }
    }

    if (gaveUp !== undefined) break;
    if (!foundScript) break;
  }

  return { gaveUp };
}

// --- Transcript writers ---

function appendText(cardHandle: DocHandle<LlmCardDoc>, content: string): void {
  cardHandle.change((doc) => {
    const last = doc.transcript[doc.transcript.length - 1];
    if (last && last.type === "text") last.content += content;
    else doc.transcript.push({ type: "text", content });
  });
}

// Update the in-progress script block as it streams, or start a new one. A
// block is "in progress" until its result has been recorded.
function upsertScript(
  cardHandle: DocHandle<LlmCardDoc>,
  code: string,
  description?: string,
): void {
  cardHandle.change((doc) => {
    const last = doc.transcript[doc.transcript.length - 1];
    if (
      last &&
      last.type === "script" &&
      last.output === undefined &&
      last.error === undefined
    ) {
      last.code = code;
      if (description) last.description = description;
    } else {
      const entry: Extract<TranscriptEntry, { type: "script" }> = {
        type: "script",
        code,
      };
      if (description) entry.description = description;
      doc.transcript.push(entry);
    }
  });
}

function recordResult(
  cardHandle: DocHandle<LlmCardDoc>,
  result: EvalResult,
): void {
  cardHandle.change((doc) => {
    const last = doc.transcript[doc.transcript.length - 1];
    if (!last || last.type !== "script") return;
    last.output = result.output ?? "";
    if (result.error) last.error = result.error;
    if (result.gaveUp !== undefined) last.error = `gave up: ${result.gaveUp}`;
  });
}

// --- LLM message building ---

function buildMessages(
  description: string,
  inventory: CanvasDocInfo[],
  previousEffect: string | undefined,
  transcript: TranscriptEntry[],
): ChatMessage[] {
  const parts = [
    `Generate effect.js for this card. The desired effect:\n\n${description}`,
    `Documents currently on the canvas:\n${formatInventory(inventory)}`,
  ];
  if (previousEffect) {
    parts.push(
      `This card already has a working effect.js from a previous run. Treat it ` +
        `as the starting point and modify it to match the description above ` +
        `instead of rewriting from scratch:\n\n\`\`\`js\n${previousEffect}\n\`\`\``,
    );
  }
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: parts.join("\n\n") },
  ];
  appendTranscriptMessages(messages, transcript);
  return messages;
}

// Replay the transcript as alternating assistant turns (text + <script>) and
// user turns (the eval result), so the model sees its own history. Mirrors
// llm-canvas's appendOutputMessages.
function appendTranscriptMessages(
  messages: ChatMessage[],
  transcript: TranscriptEntry[],
): void {
  let assistantParts: string[] = [];

  const flushAssistant = () => {
    if (assistantParts.length === 0) return;
    messages.push({ role: "assistant", content: assistantParts.join("\n") });
    assistantParts = [];
  };

  for (const entry of transcript) {
    if (entry.type === "text") {
      assistantParts.push(entry.content);
      continue;
    }

    assistantParts.push(
      entry.description
        ? `<script data-description="${entry.description}">\n${entry.code}\n</script>`
        : `<script>\n${entry.code}\n</script>`,
    );

    if (entry.output !== undefined || entry.error !== undefined) {
      flushAssistant();
      let resultText: string;
      if (entry.error) resultText = `[Error: ${entry.error}]`;
      else if (entry.output) resultText = `[Output: ${entry.output}]`;
      else resultText = "[Done]";
      messages.push({ role: "user", content: resultText });
    }
  }

  flushAssistant();
}

// --- Script evaluation ---

type EvalResult = { output?: string; error?: string; gaveUp?: string };

// Evaluate a generation <script> with the loop API injected as parameters. The
// model's code is the body of an async function so top-level await and dynamic
// import work; `return value` surfaces back to the model.
async function evalScript(
  code: string,
  api: LoopApi,
  captured: CapturedConsole,
): Promise<EvalResult> {
  captured.flush();
  try {
    const fn = new Function(
      "element",
      "repo",
      "subscribe",
      "accept",
      "loadSkill",
      "writeFile",
      "readFile",
      "listFiles",
      "giveUp",
      "console",
      `"use strict";\nreturn (async () => {\n${code}\n})();`,
    );
    const returnValue = await fn(
      api.element,
      api.repo,
      api.subscribe,
      api.accept,
      api.loadSkill,
      api.writeFile,
      api.readFile,
      api.listFiles,
      api.giveUp,
      api.console,
    );

    const consoleOutput = captured.flush();
    const parts: string[] = [];
    if (consoleOutput) parts.push(consoleOutput);
    if (returnValue !== undefined) parts.push(stringifyArg(returnValue));

    const result: EvalResult = {};
    if (parts.length > 0) result.output = parts.join("\n");
    return result;
  } catch (err) {
    const consoleOutput = captured.flush();
    if (err instanceof GiveUpSignal) {
      return { gaveUp: err.reason, output: consoleOutput || undefined };
    }
    const result: EvalResult = {
      error: err instanceof Error ? err.message : String(err),
    };
    if (consoleOutput) result.output = consoleOutput;
    return result;
  }
}

// --- LLM streaming (OpenAI-compatible /chat/completions) ---

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
  if (!reader) throw new Error("no response body");

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
        // skip malformed SSE chunks
      }
    }
  }
}
