/**
 * Talking to real APIs.
 *
 * `web_fetch` reads public pages through a reader. This is the other half:
 * arbitrary HTTP with methods, headers and bodies.
 *
 * There is no credential store. The agent kept none worth having — anything it
 * is handed lands in the transcript, which is a synced document — so a request
 * that needs a login is one this tool cannot make, and it says so.
 *
 * `alwaysAsk` for the calls that deserve it: anything that is not a GET, and
 * anything with a body. Those change something at the other end, and a
 * standing grant is the wrong level of consent. A plain GET is a fetch, and is
 * granted like one — asking every time for those bought nothing and cost
 * eleven approvals in a single session.
 *
 * CORS still applies — this is a browser. A request to an API that does not
 * serve permissive CORS will fail, and that is what the `task` tier and a
 * runner outside the browser are for.
 */

import { truncate, bytes } from "./format.js"
import { saveSource, isTextResponse, describeBytes } from "./sources.js"

export const httpRequest = {
  id: "http_request",
  name: "Call an API",
  description: [
    "Make an HTTP request and return the response. Use this for JSON APIs and for anything that needs a method, headers or a body — web_fetch is for reading public pages as text.",
    "",
    "There are no stored credentials. Never put a token, password or key in a request, a document or a note: everything here is synced. If an API needs one, tell the user it cannot be reached from here.",
    "",
    "Binary responses — wasm, images, archives, fonts — are kept as bytes and written to a document rather than decoded into this conversation. Pass `folder` to put that document straight into a package. Decoding bytes as text would corrupt them silently, so it is never done.",
    "",
    "A plain GET is granted per site, like web_fetch. Anything that is not a GET, and anything with a body, asks the user every time however much has been granted — so do not reach for a method you do not need.",
    "",
    "This runs in a browser, so the target must serve permissive CORS. A failure that mentions CORS means the API cannot be reached from here.",
  ].join("\n"),
  where: "worker",
  risk: "external",
  /**
   * Every time — but only for the calls that earn it.
   *
   * This was `true` unconditionally, and the cost showed up in a real session:
   * eleven http_request calls, every one a plain GET with no credential, every
   * one stopping to ask. The user granted http_request@* and then three more
   * per-site grants, and not one of them did anything, because alwaysAsk is
   * checked before grants are.
   *
   * The danger was never the tool, it is the arguments. A GET is a fetch and is
   * granted like one. A request that changes something at the other end still
   * asks every single time.
   */
  alwaysAsk: (input) => String(input?.method ?? "GET").toUpperCase() !== "GET" || !!input?.body,
  input_schema: {
    type: "object",
    required: ["url"],
    properties: {
      url: { type: "string", description: "Absolute http(s) URL." },
      method: { type: "string", description: "GET, POST, PUT, PATCH, DELETE. Default GET." },
      headers: { type: "object", description: "Extra headers.", additionalProperties: { type: "string" } },
      body: { type: "string", description: "Request body, already serialized." },
      maxChars: { type: "number", description: "Default 12000. Text responses only." },
      folder: {
        type: "string",
        description: "Folder document to save the response into. Use it for a file you are fetching in order to keep — a wasm module for a package, say.",
      },
      saveAs: { type: "string", description: "File name for the saved document. Defaults to one derived from the URL." },
    },
  },

  async execute(input, ctx) {
    const url = String(input.url ?? "").trim()
    if (!/^https?:\/\//.test(url)) throw new Error("Pass an absolute http(s) URL.")

    const headers = { ...(input.headers ?? {}) }

    const method = (input.method ?? "GET").toUpperCase()
    if (input.body && method === "GET") throw new Error("A GET request cannot have a body.")

    const fetchImpl = ctx.fetchImpl ?? fetch
    let response
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: input.body ?? undefined,
        signal: ctx.signal,
      })
    } catch (err) {
      throw new Error(
        `Request failed: ${err?.message ?? err}. If this is a CORS error, the API cannot be called from a browser — that needs a runner outside the browser.`
      )
    }

    // Read the body ONCE, as bytes, and decide afterwards what it is. Calling
    // response.text() first is the bug this exists to avoid: it decodes as
    // UTF-8 with replacement, so a wasm module comes back full of U+FFFD and
    // still looks like a successful result.
    let body
    if (typeof response.arrayBuffer === "function") {
      body = new Uint8Array(await response.arrayBuffer().catch(() => new ArrayBuffer(0)))
    } else {
      // A fetch implementation that cannot hand back bytes. Decode as text and
      // say so if the result looks damaged, rather than silently returning
      // mojibake that reads like a successful download.
      const text = await response.text().catch(() => "")
      if (/\ufffd/.test(text)) {
        throw new Error(
          "This response is binary and the fetch implementation in use cannot return bytes, so it cannot be retrieved without corrupting it."
        )
      }
      body = new TextEncoder().encode(text)
    }
    const contentType = response.headers?.get?.("content-type") ?? null
    const status = `${method} ${url} → ${response.status} ${response.statusText} (${bytes(body.byteLength)}${contentType ? `, ${contentType.split(";")[0].trim()}` : ""})`

    if (isTextResponse(contentType, body)) {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(body)
      if (!response.ok) return `${status}\n\n${truncate(text, 2000)}`
      return `${status}\n\n${truncate(text, input.maxChars ?? 12000)}`
    }

    // Binary. An error body is small and worth describing; a successful one is
    // the thing that was asked for, so it goes into a document intact.
    if (!response.ok) {
      return `${status}\n\nThe body is binary (${describeBytes(body)}), so it is not shown.`
    }

    const ref = await saveSource(ctx, {
      url,
      content: body,
      name: input.saveAs ?? null,
      mimeType: contentType?.split(";")[0].trim() || "application/octet-stream",
      folder: input.folder ?? null,
    })

    if (!ref) {
      throw new Error(
        `${status}\nThe response is binary (${describeBytes(body)}) and there is nowhere to write it. Binary is never decoded into the conversation, because that would corrupt it.`
      )
    }

    return {
      text: [
        status,
        `Kept as bytes — NOT decoded, so the file is intact.`,
        `First bytes: ${describeBytes(body)}`,
        `Saved as '${ref.name}' at ${ref.url}${ref.folder ? ` in ${ref.folder}` : ""}`,
        ref.folder ? "" : "It is not filed anywhere; pass `folder` to put it in a package.",
      ]
        .filter(Boolean)
        .join("\n"),
      doc: ref,
    }
  },

  summarize(input, output) {
    const status = String(output ?? "").match(/→ (\d{3})/)
    const saved = String(output ?? "").match(/Saved as '([^']+)'/)
    if (saved) return `${(input?.method ?? "GET").toUpperCase()} → ${saved[1]}`
    let host = input?.url ?? ""
    try {
      host = new URL(input.url).host
    } catch {
      /* keep the raw string */
    }
    return `${(input?.method ?? "GET").toUpperCase()} ${host} · ${status ? status[1] : "?"}`
  },
}

export default [httpRequest]
