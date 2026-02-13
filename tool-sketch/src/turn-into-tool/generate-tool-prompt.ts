import type { TurnIntoToolCapture } from "./TurnIntoToolButton";

const OPENROUTER_API_KEY = import.meta.env.VITE_PUBLIC_OPENROUTER_API_KEY;

const SYSTEM_PROMPT = `You are a tool generator for a collaborative document platform called Patchwork.

Given a screenshot of a UI, you generate a single JavaScript file that contains both a datatype and a tool, plus an example document.

The file must contain:
1. A **datatype** const — a JavaScript object with methods: init(doc), getTitle(doc), setTitle(doc, title), markCopy(doc). The init method sets up the initial document state on a mutable automerge doc.
2. A **Tool** function — \`function Tool(handle, element)\` that renders the UI into the given DOM element using vanilla JS (no frameworks). It reads state via \`handle.doc()\`, mutates state via \`handle.change(d => { ... })\`, and listens for changes via \`handle.on("change", render)\`. It must return a cleanup function.
3. A **plugins** export — an array that registers both the datatype and tool so the platform can discover them. Each plugin entry must use an \`async load()\` function that returns the module (the datatype object or the Tool function), NOT a \`module\` property.

Here is a complete reference example of a Tic Tac Toe tool as a single file:

\`\`\`js
const TicTacToeDatatype = {
  init(doc) {
    doc.title = "Tic Tac Toe";
    doc.board = [null, null, null, null, null, null, null, null, null];
    doc.currentPlayer = "X";
    doc.status = "playing";
    doc.winner = null;
  },
  getTitle(doc) {
    return doc.title || "Tic Tac Toe";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
  markCopy(doc) {
    doc.title = "Copy of " + this.getTitle(doc);
  },
};

function Tool(handle, element) {
  // create <style> and append to element
  // create container DOM, append to element
  // function render() reads handle.doc() and rebuilds the UI
  // mutations go through handle.change(d => { ... })
  // call render() once, then handle.on("change", render)
  // return cleanup function that removes listeners and DOM
}

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "tic-tac-toe",
    name: "Tic Tac Toe",
    async load() {
      return TicTacToeDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "tic-tac-toe-tool",
    name: "Tic Tac Toe",
    supportedDatatypes: ["tic-tac-toe"],
    async load() {
      return Tool;
    },
  },
];
\`\`\`

IMPORTANT RULES:
- Output ONLY valid JSON with four keys: "id", "name", "code", "example".
- "id" is a kebab-case identifier for the tool (e.g. "tic-tac-toe").
- "name" is a human-readable name (e.g. "Tic Tac Toe").
- "code" is a single JavaScript source string containing the datatype, Tool function, and plugins export as shown above. The datatype id in the plugins array must match "id". The tool id in the plugins array should be "id" + "-tool".
- "example" is a JSON object containing only the data properties of a filled-in document (e.g. {title: "...", board: [...]}). Do NOT include any "@patchwork" metadata — just the plain data fields that the init() method would set up.
- The Tool function must use vanilla DOM manipulation — no React, no JSX, no imports.
- The tool should look beautiful with modern CSS styling.
- Use the screenshot as a rough reference for layout and functionality, but come up with a more polished and refined visual style. Don't just replicate the sketch literally — improve it.
- Any markings in RED in the screenshot are annotations and instructions, NOT part of the UI. They explain how things should work or provide context. Do not render them as visual elements.
- Make the tool interactive and functional.
- Do NOT wrap the JSON in markdown code fences.`;

export interface GenerateToolResult {
  id: string;
  name: string;
  code: string;
  example: Record<string, unknown>;
}

export async function generateToolFromCapture(capture: TurnIntoToolCapture, idSuffix: string): Promise<GenerateToolResult> {
  if (!OPENROUTER_API_KEY) {
    throw new Error("VITE_PUBLIC_OPENROUTER_API_KEY is not set");
  }

  const seed = Math.floor(Math.random() * 1_000_000);

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-5.2-codex",
      seed,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
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
              text: `Generate a Patchwork tool that matches this screenshot. Append "-${idSuffix}" to the tool id (e.g. "my-tool-${idSuffix}") and append " (${idSuffix})" to the tool name (e.g. "My Tool (${idSuffix})"). Return JSON with keys: id, name, code, example.`,
            },
          ],
        },
      ],
      max_tokens: 8192,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
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
    id: parsed.id as string,
    name: parsed.name as string,
    code: parsed.code as string,
    example: parsed.example as Record<string, unknown>,
  };

  console.log("Generated tool from capture:", result);

  return result;
}
