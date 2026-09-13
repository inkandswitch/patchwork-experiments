/**
 * Check the OpenRouter adapter against the live API.
 *
 * Unit tests prove the decoder handles the wire format I *believe* OpenRouter
 * emits. This proves that belief. It runs two passes:
 *
 *   1. a plain streamed completion — auth, SSE framing, text deltas, stop
 *   2. a completion with tools, prompted so the model must call one — tool-call
 *      delta reassembly, argument JSON, and the tool_calls finish reason
 *
 * Usage:  node probes/live-openrouter.mjs [model]
 * Key:    OPENROUTER_API_KEY, or OPENROUTER_KEY_FILE=<path>
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import * as openrouter from "../providers/openrouter.js"

const here = dirname(fileURLToPath(import.meta.url))

function readKey() {
  // The key lives OUTSIDE this package on purpose: `pushwork sync` publishes the
  // whole directory and honours only .pushwork/.git/node_modules, so a
  // credential stored in here would be shipped to the sync server.
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim()
  if (process.env.OPENROUTER_KEY_FILE) {
    try {
      return readFileSync(process.env.OPENROUTER_KEY_FILE, "utf8").trim()
    } catch (err) {
      console.error(`Could not read OPENROUTER_KEY_FILE: ${err.message}`)
      process.exit(2)
    }
  }
  console.error("No key. Set OPENROUTER_API_KEY, or OPENROUTER_KEY_FILE to a file holding one.")
  process.exit(2)
}

const key = readKey()
const model = process.argv[2] ?? "anthropic/claude-sonnet-4.5"

const TOOLS = [
  {
    id: "doc_read",
    description: "Read an automerge document. Returns its contents as JSON.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "automerge: URL of the document" },
        path: { type: "array", items: { type: "string" }, description: "path inside the document" },
      },
      required: ["url"],
    },
  },
]

async function pass(label, request) {
  console.log(`\n=== ${label} ===`)
  const started = Date.now()
  const events = []
  let text = ""
  let firstTokenAt = null

  try {
    for await (const event of openrouter.stream({ ...request, model, key })) {
      if (event.type === "text") {
        firstTokenAt ??= Date.now() - started
        text += event.delta
      }
      if (event.type !== "text" && event.type !== "reasoning") events.push(event)
    }
  } catch (err) {
    console.error(`FAILED: ${err.message}`)
    return { ok: false, error: err.message }
  }

  const calls = events.filter((e) => e.type === "call")
  const stop = events.find((e) => e.type === "stop")
  const usage = events.find((e) => e.type === "usage")

  console.log(`ttft       ${firstTokenAt ?? "-"} ms`)
  console.log(`total      ${Date.now() - started} ms`)
  console.log(`text       ${JSON.stringify(text.slice(0, 160))}`)
  console.log(`stop       ${stop?.reason}`)
  console.log(`usage      ${usage ? `${usage.in} in / ${usage.out} out` : "(none reported)"}`)
  for (const call of calls) {
    console.log(`call       ${call.name}(${JSON.stringify(call.input)})  parseError=${call.parseError}`)
  }

  return { ok: true, text, calls, stop, usage }
}

const plain = await pass("plain completion", {
  system: "You are terse.",
  messages: [{ role: "user", content: [{ type: "text", text: "Say exactly: hello from patchwork" }] }],
  tools: [],
  params: { temperature: 0, maxTokens: 64 },
})

const withTool = await pass("tool call", {
  system: "You are an agent with tools. Use them rather than guessing.",
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "What is in the document at automerge:4NMNnkyJ9u9kVHQr8h1yTgq1qYt2? Read it.",
        },
      ],
    },
  ],
  tools: TOOLS,
  params: { temperature: 0, maxTokens: 256 },
})

const roundTrip = await pass("tool result round-trip", {
  system: "You are an agent with tools.",
  messages: [
    { role: "user", content: [{ type: "text", text: "Read automerge:abc and tell me the title." }] },
    {
      role: "assistant",
      content: [{ type: "call", id: "call_1", name: "doc_read", input: { url: "automerge:abc" } }],
    },
    {
      role: "tool",
      content: [{ type: "result", callId: "call_1", output: '{"title":"Braised Leeks","servings":4}' }],
    },
  ],
  params: { temperature: 0, maxTokens: 128 },
})

console.log("\n=== verdict ===")
const checks = [
  ["auth + streaming works", plain.ok && plain.text.length > 0],
  ["stop reason decoded", plain.stop?.reason != null],
  ["model called the tool", withTool.calls?.length > 0],
  ["tool arguments parsed", withTool.calls?.[0]?.parseError === null],
  ["tool stop reason is tool_use", withTool.stop?.reason === "tool_use"],
  ["tool result round-trips", roundTrip.ok && /leek/i.test(roundTrip.text)],
]
for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`)
process.exit(checks.every(([, ok]) => ok) ? 0 : 1)
