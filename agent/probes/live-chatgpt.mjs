/**
 * Check the ChatGPT plan adapter against the live API, on a real plan.
 *
 * The unit tests prove the adapter against OpenAI's documents. This proves the
 * documents: that the plan route takes what buildBody sends (the namespace of
 * tools, the carry sent back), what /v1/models really
 * lists, and whether the prompt cache is hit.
 *
 * Node can do what a page cannot: listen on 127.0.0.1:1455 for the sign-in's
 * callback. So with --sign-in it signs in the real way, as "Patchwork (probe)"
 * — its own registration, apart from the browser's — and keeps the sign-in in
 * a file OUTSIDE this package (pushwork publishes the whole directory),
 * written owner-only.
 *
 * Usage:
 *   node probes/live-chatgpt.mjs --sign-in      sign in, then run the passes
 *   node probes/live-chatgpt.mjs [model]        run the passes (default: the first model listed)
 *   node probes/live-chatgpt.mjs --sign-out     revoke and forget
 * File:  CHATGPT_CREDENTIALS_FILE, default ~/.config/patchwork-agent/chatgpt-probe.json
 *
 * Each pass is one small request on the plan: five in all.
 */

import { createServer } from "node:http"
import { readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { execFile } from "node:child_process"
import * as auth from "../providers/chatgpt-auth.js"
import * as chatgpt from "../providers/chatgpt.js"

const FILE = process.env.CHATGPT_CREDENTIALS_FILE ?? join(homedir(), ".config", "patchwork-agent", "chatgpt-probe.json")

/** A storage over one owner-only JSON file, as chatgpt-auth takes one. */
function fileStorage(path) {
  const load = () => {
    try {
      return JSON.parse(readFileSync(path, "utf8"))
    } catch {
      return {}
    }
  }
  const save = (all) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 })
    chmodSync(tmp, 0o600)
    renameSync(tmp, path)
  }
  return {
    getItem: (key) => load()[key] ?? null,
    setItem: (key, value) => save({ ...load(), [key]: String(value) }),
    removeItem: (key) => {
      const all = load()
      delete all[key]
      save(all)
    },
  }
}

const storage = fileStorage(FILE)
const args = process.argv.slice(2)

async function signIn() {
  const record = auth.readRecord(storage)
  const url = await auth.begin({ storage, agentName: "Patchwork (probe)", registration: record ? { clientId: record.clientId, email: record.email } : null })
  const done = new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      if (!req.url.startsWith("/auth/callback")) {
        res.writeHead(404).end()
        return
      }
      try {
        const kept = await auth.finish(`http://127.0.0.1:1455${req.url}`, { storage })
        res.writeHead(200, { "content-type": "text/plain" }).end("Signed in. You can close this tab.")
        server.close()
        resolve(kept)
      } catch (err) {
        res.writeHead(400, { "content-type": "text/plain" }).end(`Sign-in failed: ${err.message}`)
        server.close()
        reject(err)
      }
    })
    server.listen(1455, "127.0.0.1")
    setTimeout(() => {
      server.close()
      reject(new Error("No sign-in within 10 minutes."))
    }, 600_000).unref()
  })
  console.log(`\nOpen this to sign in (opening it for you on macOS):\n\n${url}\n`)
  if (process.platform === "darwin") execFile("open", [url], () => {})
  const kept = await done
  console.log(`Signed in as ${kept.email ?? kept.subject}; plan use ${kept.scopes.includes(auth.PLAN_SCOPE) ? "granted" : "NOT granted"}. Kept in ${FILE}.`)
}

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

// Long enough to pass the 1,024-token minimum a prefix needs before it is cached.
const SYSTEM = ["You are a terse assistant inside a document tool. Answer in one short sentence unless a tool is needed.", ...Array.from({ length: 120 }, (_, i) => `Rule ${i + 1}: keep answers short and never invent document contents.`)].join("\n")

async function pass(label, request) {
  console.log(`\n=== ${label} ===`)
  const started = Date.now()
  const out = { text: "", reasoning: "", calls: [], carry: null, usage: null, stop: null, retries: [] }
  try {
    for await (const event of chatgpt.stream({ ...request, onRetry: (info) => out.retries.push(info) })) {
      if (event.type === "text") out.text += event.delta
      else if (event.type === "reasoning") out.reasoning += event.delta
      else if (event.type === "call") out.calls.push(event)
      else if (event.type === "carry") out.carry = event.data
      else if (event.type === "usage") out.usage = event
      else if (event.type === "stop") out.stop = event.reason
    }
  } catch (err) {
    console.log(`FAILED (${err.name}${err.code ? `, ${err.code}` : ""}${err.param ? `, param ${err.param}` : ""}): ${err.message}`)
    return { ...out, error: err }
  }
  console.log(`${Date.now() - started} ms · stop ${out.stop} · usage ${JSON.stringify(out.usage)}`)
  if (out.retries.length) console.log(`retries: ${JSON.stringify(out.retries)}`)
  if (out.reasoning) console.log(`reasoning summary: ${out.reasoning.slice(0, 160).replace(/\n/g, " ")}…`)
  if (out.text) console.log(`text: ${out.text.slice(0, 200)}`)
  for (const call of out.calls) console.log(`call: ${call.name}(${JSON.stringify(call.input)}) id ${call.id}${call.parseError ? ` PARSE ERROR ${call.parseError}` : ""}`)
  if (out.carry) console.log(`carry: ${out.carry.items.map((i) => `${i.type}${i.phase ? `:${i.phase}` : ""}${i.encrypted_content ? `[${i.encrypted_content.length} sealed chars]` : ""}`).join(", ")}`)
  return out
}

async function main() {
  if (args.includes("--sign-out")) {
    console.log(JSON.stringify(await auth.forget({ storage })))
    return
  }
  if (args.includes("--sign-in")) await signIn()

  const token = await auth.accessToken({ storage })
  const record = auth.readRecord(storage)
  const key = { token, expiresAt: record.expiresAt }
  const results = {}

  console.log("\n=== models ===")
  const raw = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${token}` } })
  const body = await raw.json().catch(() => null)
  const list = body?.models ?? body?.data ?? []
  console.log(`${raw.status} · top-level keys: ${Object.keys(body ?? {}).join(", ")} · ${list.length} entries`)
  if (list[0]) console.log(`first entry's fields: ${Object.keys(list[0]).join(", ")}`)
  const listed = await chatgpt.models({ key })
  console.log(listed.map((m) => chatgpt.describeModel(m) + ` [${m.id}]`).join("\n"))
  const model = args.find((a) => !a.startsWith("--")) ?? listed[0]?.id
  if (!model) throw new Error("No model to try.")
  console.log(`\nUsing ${model}.`)

  const base = { system: SYSTEM, tools: TOOLS, model, params: {}, key, cacheKey: "probe-session" }
  const user = (text) => ({ role: "user", content: [{ type: "text", text }] })

  results.plain = await pass("1. plain reply", { ...base, tools: [], messages: [user("Say exactly: hello from the plan")] })

  const ask = user("Read the document automerge:example-document and tell me its title.")
  results.call = await pass("2. a tool call", { ...base, messages: [ask] })
  const call = results.call.calls?.[0]
  if (!call) {
    console.log("No call came back; stopping here.")
    return report(results)
  }

  const reply = {
    role: "assistant",
    content: [...(results.call.text ? [{ type: "text", text: results.call.text }] : []), ...results.call.calls.map((c) => ({ type: "call", id: c.id, name: c.name, input: c.input }))],
    ...(results.call.carry ? { carry: { provider: "chatgpt", data: results.call.carry } } : {}),
  }
  const answer = { role: "tool", content: results.call.calls.map((c) => ({ type: "result", callId: c.id, output: JSON.stringify({ title: "Boat refit notes" }) })) }
  results.replay = await pass("3. the result, with the carry sent back", { ...base, messages: [ask, reply, answer] })
  results.again = await pass("4. the same request again (the cache)", { ...base, messages: [ask, reply, answer] })

  const { carry: _carry, ...bare } = reply
  results.bare = await pass("5. the result without the carry", { ...base, messages: [ask, bare, answer] })
  report(results)
}

function report(results) {
  console.log("\n=== summary ===")
  for (const [name, r] of Object.entries(results)) {
    console.log(`${name.padEnd(7)} ${r.error ? `FAILED ${r.error.code ?? r.error.message}` : `ok · in ${r.usage?.in} (cached ${r.usage?.cached}) · out ${r.usage?.out} (reasoning ${r.usage?.reasoning})`}${r.retries?.length ? ` · ${r.retries.map((x) => x.reason).join("; ")}` : ""}`)
  }
}

main().catch((err) => {
  console.error(`\n${err.name}: ${err.message}`)
  process.exit(1)
})
