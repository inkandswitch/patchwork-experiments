import type { DocHandle, Repo } from "@automerge/automerge-repo";
import { updateText } from "@automerge/automerge-repo";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { parseScriptBlocks } from "./parser";
import { createWorkspace } from "../workspace";
import type { LLMProcessDoc, Message, ContentBlock, Workspace } from "../types";

const API_URL = "https://openrouter.ai/api/v1";
// Inlined at build time from .env (VITE_OPENROUTER_API_KEY) — the key never
// lives in source, but note it does end up in the published dist bundle.
const API_KEY: string | undefined = import.meta.env.VITE_OPENROUTER_API_KEY;
const MAX_ITERATIONS = 20;

type ApiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function runLLMProcess(repo: Repo, handle: DocHandle<LLMProcessDoc>, signal?: AbortSignal): Promise<void> {
  if (!API_KEY) {
    throw new Error(
      "No API key baked into this build — set VITE_OPENROUTER_API_KEY in llm/.env and rebuild.",
    );
  }
  const doc = await handle.doc();
  if (!doc) throw new Error("Process document not found");

  const workspace = createWorkspace(repo, doc.docFolderUrl);
  const capturedConsole = createCapturedConsole();
  const systemPrompt = await buildSystemPrompt(doc.systemPrompt, doc.skills);

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (signal?.aborted) break;

    const currentDoc = await handle.doc();
    if (!currentDoc) break;

    const apiMessages = serializeForApi(systemPrompt, currentDoc.messages);

    handle.change((d) => {
      d.messages.push({ role: "assistant", content: [] });
    });
    const assistantIdx = (await handle.doc())!.messages.length - 1;

    const stream = streamChatCompletion(currentDoc.model, apiMessages, signal);
    let foundScript = false;

    for await (const block of parseScriptBlocks(stream)) {
      if (signal?.aborted) break;

      if (block.type === "text" && block.content.trim().length > 0) {
        handle.change((d) => {
          const msg = d.messages[assistantIdx];
          const content = msg.content as ContentBlock[];
          const lastPart = content[content.length - 1];
          if (lastPart && lastPart.type === "text") {
            updateText(d, ["messages", assistantIdx, "content", content.length - 1, "text"], lastPart.text + block.content);
          } else {
            content.push({ type: "text", text: block.content });
          }
        });
      }

      if (block.type === "script") {
        handle.change((d) => {
          const msg = d.messages[assistantIdx];
          const content = msg.content as ContentBlock[];
          const lastPart = content[content.length - 1];
          if (lastPart?.type === "script" && lastPart.output === undefined && lastPart.error === undefined) {
            updateText(d, ["messages", assistantIdx, "content", content.length - 1, "code"], block.code);
          } else {
            const scriptBlock: any = {
              type: "script",
              code: block.code,
            };
            if (block.description) {
              scriptBlock.description = block.description;
            }
            content.push(scriptBlock);
          }
        });

        if (block.complete) {
          foundScript = true;

          const result = await evalScript(block.code, workspace, capturedConsole);

          handle.change((d) => {
            const msg = d.messages[assistantIdx];
            const content = msg.content as ContentBlock[];
            const scriptPart = content[content.length - 1];
            if (scriptPart.type !== "script") return;

            if (result.output !== undefined) {
              scriptPart.output = result.output;
            }
            if (result.error !== undefined) {
              scriptPart.error = result.error;
            }
            if (result.output === undefined && result.error === undefined) {
              scriptPart.output = "";
            }
          });

          break;
        }
      }
    }

    if (!foundScript) break;
  }

  handle.change((d) => {
    d.running = false;
  });
}

async function buildSystemPrompt(basePrompt: string, skillIds?: string[]): Promise<string> {
  const parts: string[] = [];

  if (basePrompt) {
    parts.push(basePrompt);
  }

  const registry = getRegistry("patchwork:skill");
  const skillSummaries: string[] = [];

  try {
    const allSkills = registry.all();
    const skillsToUse = skillIds && skillIds.length > 0 ? allSkills.filter((s: any) => skillIds.includes(s.id)) : allSkills;

    for (const skill of skillsToUse) {
      const desc = (skill as any).description || "No description";
      skillSummaries.push(`- **${(skill as any).id}**: ${desc}`);
    }
  } catch {
    // Registry not available
  }

  if (skillSummaries.length > 0) {
    parts.push("Available skills:\n" + skillSummaries.join("\n"));
    parts.push("To use a skill, first load its documentation:\n" + "```javascript\n" + 'const docs = await workspace.getSkillDocumentation("skillId");\n' + "```\n" + "Then load and use it:\n" + "```javascript\n" + 'const skill = await workspace.loadSkill("skillId");\n' + "```");
  }

  parts.push("The `workspace` object is available with:\n" + "- workspace.loadSkill(skillId)\n" + "- workspace.getSkillDocumentation(skillId)\n" + "- workspace.find(url)\n" + "- workspace.create({ name?, type? })\n" + "- workspace.listDocuments()");

  return parts.join("\n\n");
}

function serializeForApi(systemPrompt: string, messages: Message[]): ApiMessage[] {
  const apiMessages: ApiMessage[] = [{ role: "system", content: systemPrompt }];

  for (const msg of messages) {
    if (msg.role === "assistant") {
      serializeAssistantMessage(apiMessages, msg);
    } else {
      const content = typeof msg.content === "string" ? msg.content : serializeParts(msg.content);
      apiMessages.push({ role: msg.role, content });
    }
  }

  return apiMessages;
}

function serializeAssistantMessage(apiMessages: ApiMessage[], msg: Message): void {
  const parts = typeof msg.content === "string" ? [{ type: "text" as const, text: msg.content }] : msg.content;
  let textAccum = "";

  for (const part of parts) {
    if (part.type === "text") {
      textAccum += part.text;
    } else if (part.type === "script") {
      textAccum += part.description ? `<script data-description="${part.description}">\n${part.code}\n</script>` : `<script>\n${part.code}\n</script>`;

      if (part.output !== undefined || part.error !== undefined) {
        if (textAccum) {
          apiMessages.push({ role: "assistant", content: textAccum });
          textAccum = "";
        }
        const resultText = part.error ? `[Error: ${part.error}]` : part.output ? `[Output: ${part.output}]` : "[Done]";
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
        let s = p.description ? `<script data-description="${p.description}">\n${p.code}\n</script>` : `<script>\n${p.code}\n</script>`;
        if (p.error) s += `\n[Error: ${p.error}]`;
        else if (p.output) s += `\n[Output: ${p.output}]`;
        return s;
      }
      return "";
    })
    .join("");
}

async function evalScript(code: string, workspace: Workspace, capturedConsole: ReturnType<typeof createCapturedConsole>): Promise<{ output?: string; error?: string }> {
  capturedConsole.flush();

  try {
    const fn = new Function(
      "workspace",
      "console",
      `return (async () => {
        ${code}
      })();`,
    );

    const returnValue = await fn(workspace, capturedConsole);
    const consoleOutput = capturedConsole.flush();
    const parts: string[] = [];
    if (consoleOutput) parts.push(consoleOutput);
    if (returnValue !== undefined) parts.push(stringifyArg(returnValue));

    return parts.length > 0 ? { output: parts.join("\n") } : {};
  } catch (err: any) {
    const consoleOutput = capturedConsole.flush();
    return {
      error: err.message || String(err),
      ...(consoleOutput ? { output: consoleOutput } : {}),
    };
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
    log: (...args: any[]) => output.push(args.map(stringifyArg).join(" ")),
    error: (...args: any[]) => output.push("[error] " + args.map(stringifyArg).join(" ")),
    warn: (...args: any[]) => output.push("[warn] " + args.map(stringifyArg).join(" ")),
    info: (...args: any[]) => output.push(args.map(stringifyArg).join(" ")),
    flush(): string {
      const text = output.join("\n");
      output.length = 0;
      return text;
    },
  };
}

async function* streamChatCompletion(model: string, messages: ApiMessage[], signal?: AbortSignal): AsyncGenerator<string> {
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
