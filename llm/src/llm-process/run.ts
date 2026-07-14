import type { DocHandle, Repo } from "@automerge/automerge-repo";
import { updateText, splice } from "@automerge/automerge-repo";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { stream } from "@chee/patchwork-llm";
import { parseScriptBlocks } from "./parser";
import { createWorkspace } from "../workspace";
import type { LLMProcessDoc, Message, ContentBlock, Workspace } from "../types";

const MAX_ITERATIONS = 20;

type ApiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function runLLMProcess(repo: Repo, handle: DocHandle<LLMProcessDoc>, signal?: AbortSignal): Promise<void> {
  const doc = await handle.doc();
  if (!doc) throw new Error("Process document not found");

  const workspace = createWorkspace(repo, doc.docFolderUrl);
  const capturedConsole = createCapturedConsole();
  const systemPrompt = await buildSystemPrompt(doc.systemPrompt, doc.skills);

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (signal?.aborted) break;

    const currentDoc = await handle.doc();
    if (!currentDoc) break;

    const apiMessages = serializeForApi(currentDoc.messages);

    handle.change((d) => {
      d.messages.push({ role: "assistant", content: [] });
    });
    const assistantIdx = (await handle.doc())!.messages.length - 1;

    const tokenStream = streamTokens(apiMessages, {
      system: systemPrompt,
      signal,
    });
    let foundScript = false;

    for await (const block of parseScriptBlocks(tokenStream)) {
      if (signal?.aborted) break;

      if (block.type === "text" && block.content.length > 0) {
        handle.change((d) => {
          const msg = d.messages[assistantIdx];
          const content = msg.content as ContentBlock[];
          const lastPart = content[content.length - 1];
          if (lastPart && lastPart.type === "text") {
            // Append-only: splice the delta at the end. updateText re-diffs the
            // whole field every token and, on repetitive prose, scatters the
            // splices — which corrupts the streaming markdown render until you
            // refresh. splice is a deterministic end-insert.
            splice(d, ["messages", assistantIdx, "content", content.length - 1, "text"], lastPart.text.length, 0, block.content);
          } else if (block.content.trim().length > 0) {
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
            // block.code is the cumulative script text; append only the new
            // suffix via splice (same reasoning as the text branch).
            const cur = lastPart.code;
            if (block.code.startsWith(cur)) {
              if (block.code.length > cur.length) {
                splice(d, ["messages", assistantIdx, "content", content.length - 1, "code"], cur.length, 0, block.code.slice(cur.length));
              }
            } else {
              updateText(d, ["messages", assistantIdx, "content", content.length - 1, "code"], block.code);
            }
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

function serializeForApi(messages: Message[]): ApiMessage[] {
  const apiMessages: ApiMessage[] = [];

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

type StreamOpts = {
  system?: string;
  signal?: AbortSignal;
};

// Adapt @chee/patchwork-llm's telemetry stream down to a plain stream of text
// deltas, which is what parseScriptBlocks() consumes. Provider / model / API
// key / temperature all come from the account-doc config (set via the library's
// picker), shared across every tool.
async function* streamTokens(messages: ApiMessage[], opts: StreamOpts): AsyncGenerator<string> {
  for await (const ev of stream(messages, opts)) {
    if (ev.type === "token") yield ev.delta as string;
  }
}
