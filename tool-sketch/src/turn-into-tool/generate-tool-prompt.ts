import type { TurnIntoToolCapture } from "./TurnIntoToolButton";
import type { PromptConfig } from "./prompts";

const OPENROUTER_API_KEY = import.meta.env.VITE_PUBLIC_OPENROUTER_API_KEY;

export interface GenerateToolResult {
  mode: "create" | "extend";
  id: string;
  name: string;
  code: string;
  /** In extend mode this is the docUrl of the existing document to reuse (chosen by the LLM). */
  docUrl: string | null;
  /** In extend mode this is the toolId to display the result with (chosen by the LLM). */
  toolId: string | null;
  /** In create mode, a filled-in example document. Null for extend mode. */
  example: Record<string, unknown> | null;
}

/**
 * Build the text portion of the user message, including the embed list so the
 * LLM knows which documents are available to extend.
 */
function buildUserText(
  capture: TurnIntoToolCapture,
  idSuffix: string
): string {
  let text = `Generate a Patchwork tool that matches this screenshot. Append "-${idSuffix}" to the tool id (e.g. "my-tool-${idSuffix}") and append " (${idSuffix})" to the tool name (e.g. "My Tool (${idSuffix})"). Return JSON with keys: mode, id, name, code, docUrl, toolId, example.`;

  if (capture.embeds.length > 0) {
    text += "\n\nEmbedded documents in the selection:";
    for (const embed of capture.embeds) {
      text += `\n- docUrl: "${embed.docUrl}", dataType: "${embed.dataType}", toolId: "${embed.toolId}"`;
      if (embed.docContent) {
        text += `\n  Document content:\n\`\`\`json\n${embed.docContent}\n\`\`\``;
      }
      if (embed.sourceCode) {
        text += `\n  Current tool source code:\n\`\`\`javascript\n${embed.sourceCode}\n\`\`\``;
      }
    }
  }

  return text;
}

export async function generateToolFromCapture(
  capture: TurnIntoToolCapture,
  idSuffix: string,
  promptConfig: PromptConfig,
  model = "openai/gpt-5.2-codex"
): Promise<GenerateToolResult> {
  if (!OPENROUTER_API_KEY) {
    throw new Error("VITE_PUBLIC_OPENROUTER_API_KEY is not set");
  }

  const seed = Math.floor(Math.random() * 1_000_000);

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        seed,
        messages: [
          {
            role: "system",
            content: promptConfig.systemPrompt,
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: capture.imageUrl },
              },
              {
                type: "text",
                text: buildUserText(capture, idSuffix),
              },
            ],
          },
        ],
        max_tokens: 8192,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `OpenRouter API error (${response.status}): ${errorText}`
    );
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("No content in OpenRouter response");
  }

  // Parse the JSON response — strip code fences if the model added them anyway
  const cleaned = content
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  const parsed = JSON.parse(cleaned);

  const result: GenerateToolResult = {
    mode: parsed.mode === "extend" ? "extend" : "create",
    id: parsed.id as string,
    name: parsed.name as string,
    code: parsed.code as string,
    docUrl: (parsed.docUrl as string) ?? null,
    toolId: (parsed.toolId as string) ?? null,
    example: (parsed.example as Record<string, unknown>) ?? null,
  };

  console.log("Generated tool from capture:", result);

  return result;
}
