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
 * A successful GET is a fetch like any other, so its body is kept as a
 * document (see sources.js). Filing it somewhere — a wasm module into the
 * package that needs it — is source_file's job, not this tool's.
 *
 * CORS still applies in a browser. A request to an API that does not serve
 * permissive CORS will fail, and that is what a runner outside the browser is
 * for.
 */

import { truncate, bytes } from "../documents/format.js"
import { isTextResponse, describeBytes, decodeText } from "../documents/media.js"
import { sourceFooter } from "./sources.js"
import { readBytes, keepResponse, htmlToText } from "./web.js"
import { fetcher } from "../net/guard.js"

export const httpRequest = {
  id: "http_request",
  name: "Call an API",
  description: [
    "Make an HTTP request and return the response. Use this for JSON APIs, for files, and for anything that needs a method, headers or a body — web_fetch is for reading pages.",
    "",
    "There are no stored credentials. Never put a token, password or key in a request, a document or a note: everything here is synced. If an API needs one, tell the user it cannot be reached from here.",
    "",
    "Every successful GET is kept as a document, exactly as it came: text decoded, binary — wasm, images, archives, fonts — as bytes, never decoded into this conversation, because decoding bytes as text corrupts them silently. The result says where it was kept; read more of a long text response with source_read, and put a kept file into a folder (a package that needs it) with source_file.",
    "",
    "A plain GET is granted per site, like web_fetch. Anything that is not a GET, and anything with a body, asks the user every time however much has been granted — so do not reach for a method you do not need.",
    "",
    "In a browser the target must serve permissive CORS. A failure that mentions CORS means the API cannot be reached from here.",
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
      method: { type: "string", description: "GET, POST, PUT, PATCH, DELETE, HEAD. Default GET." },
      headers: { type: "object", description: "Extra headers.", additionalProperties: { type: "string" } },
      body: { type: "string", description: "Request body, already serialized." },
      maxChars: { type: "number", description: "How much of a text response to show in the result. Default 12000; the rest is read with source_read." },
    },
  },

  async execute(input, ctx) {
    const url = String(input.url ?? "").trim()
    if (!/^https?:\/\//.test(url)) throw new Error("Pass an absolute http(s) URL.")

    const headers = { ...(input.headers ?? {}) }

    const method = (input.method ?? "GET").toUpperCase()
    if (input.body && method === "GET") throw new Error("A GET request cannot have a body.")

    const fetchImpl = fetcher(ctx)
    const at = Date.now()
    let response
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: input.body ?? undefined,
        signal: ctx.signal,
      })
    } catch (err) {
      if (err?.refused) throw err
      throw new Error(
        `Request failed: ${err?.message ?? err}. If this is a CORS error, the API cannot be called from a browser — that needs a runner outside the browser.`
      )
    }

    // Read the body ONCE, as bytes, and decide afterwards what it is.
    const body = await readBytes(response)
    const contentType = response.headers?.get?.("content-type") ?? null
    const status = `${method} ${url} → ${[response.status, response.statusText].filter(Boolean).join(" ")} (${bytes(body.byteLength)}${contentType ? `, ${contentType.split(";")[0].trim()}` : ""})`
    const textual = isTextResponse(contentType, body)

    // Only a successful GET is a fetch of something; anything else is an
    // exchange, shown and not kept. An empty body has nothing to keep.
    const keep = method === "GET" && response.ok && body.byteLength > 0
    if (!keep) {
      if (!body.byteLength) return status
      if (textual) return `${status}\n\n${truncate(decodeText(body, contentType), response.ok ? input.maxChars ?? 12000 : 2000)}`
      return `${status}\n\nThe body is binary (${describeBytes(body)}), so it is not shown.`
    }

    const { ref, marks } = await keepResponse(ctx, { source: url, response, body, at })
    // A research step has no source_file, and a result that names a tool the
    // step lacks is a dead end it walks into; what it keeps is filed for it.
    const filing = ctx.scope ? null : `To put it in a folder — a package that needs it — use source_file {source:"${ref.url}", folder:"…"}.`

    if (!textual) {
      return {
        text: [
          status,
          `Kept as bytes — NOT decoded, so the file is intact.`,
          `First bytes: ${describeBytes(body)}`,
          `Kept as '${ref.name}' at ${ref.url}.`,
          ...(filing ? [filing] : []),
        ].join("\n"),
        doc: ref,
      }
    }

    // A text response shows its text; an HTML one shows the text kept beside it.
    const decoded = decodeText(body, contentType)
    const text = ref.mimeType === "text/html" || ref.mimeType === "application/xhtml+xml" ? htmlToText(decoded) : decoded
    const shown = Math.min(Math.max(0, Math.floor(input.maxChars ?? 12000)), text.length)
    return {
      text: [status, `Kept as '${ref.name}' at ${ref.url}.`, "", text.slice(0, shown), sourceFooter(ref, shown, marks)].join("\n"),
      doc: ref,
    }
  },

  summarize(input, output) {
    const status = String(output ?? "").match(/→ (\d{3})/)
    const saved = String(output ?? "").match(/Kept as '([^']+)'/)
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

/**
 * http_request as a research step has it (kernel/scope.js): GET and HEAD, never a
 * body. A research step may fetch any site without asking, which is fine for
 * reading; a request that changes something at the other end is not a read,
 * and with no one asked there is no one to have agreed to it. What it gets
 * back is kept like any other fetch.
 */
export const scopedHttpRequest = {
  ...httpRequest,
  description: [
    "Fetch a URL with GET (or HEAD, for headers only) and keep the response: for JSON APIs, files, and a page's own source. web_fetch is for reading pages.",
    "",
    "Every successful GET is kept as a document, exactly as it came: text decoded, binary as bytes. The result says where; read more of a long text response with source_read.",
    "",
    "A research step sends no request bodies and makes no other kind of request. In a browser the target must serve permissive CORS.",
  ].join("\n"),
  alwaysAsk: false,
  input_schema: {
    type: "object",
    required: ["url"],
    properties: {
      url: httpRequest.input_schema.properties.url,
      method: { type: "string", enum: ["GET", "HEAD"], description: "GET (the default) or HEAD." },
      headers: httpRequest.input_schema.properties.headers,
      maxChars: httpRequest.input_schema.properties.maxChars,
    },
  },
  async execute(input, ctx) {
    const method = String(input?.method ?? "GET").toUpperCase()
    if (method !== "GET" && method !== "HEAD") throw new Error("A research step makes only GET and HEAD requests.")
    if (input?.body != null) throw new Error("A research step sends no request body.")
    return httpRequest.execute({ ...input, method }, ctx)
  },
}

export default [httpRequest]
