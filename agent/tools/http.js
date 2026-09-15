/**
 * Talking to real APIs, including ones that need a credential.
 *
 * `web_fetch` reads public pages through a reader. This is the other half:
 * arbitrary HTTP with methods, headers and bodies, and the ability to attach a
 * named secret without ever letting the agent see its value.
 *
 * The security shape matters more than the code:
 *
 *   - The agent names a secret; the executor substitutes the value. The value
 *     appears in no tool input, no transcript, no document.
 *   - Responses are redacted before they are returned, in case a server echoes
 *     a credential back in an error.
 *   - `alwaysAsk` for the calls that deserve it: anything carrying a secret,
 *     anything that is not a GET, anything with a body. Those can take your
 *     credentials to an arbitrary URL or change something at the other end, and
 *     a standing grant is the wrong level of consent. A plain GET is a fetch,
 *     and is granted like one — asking every time for those bought nothing and
 *     cost eleven approvals in a single session.
 *
 * CORS still applies — this is a browser. A request to an API that does not
 * serve permissive CORS will fail, and that is what the `task` tier and a
 * runner outside the browser are for.
 */

import { listSecrets, readSecret, redact } from "../secrets.js"
import { truncate, bytes } from "./format.js"
import { saveSource, isTextResponse, describeBytes } from "./sources.js"

export const secretList = {
  id: "secret_list",
  name: "List available credentials",
  description:
    "List the names of credentials stored on this device. You never see their values — pass a name to http_request as `useSecret` and it will be attached to the request for you. If the credential you need is not listed, ask the user to add it in the agent's settings.",
  where: "host",
  risk: "read",
  input_schema: { type: "object", properties: {} },
  async execute() {
    const names = listSecrets()
    if (!names.length) {
      return "No credentials are stored on this device. The user can add one in the agent panel's settings, then you can use it by name."
    }
    return `Available credentials (names only): ${names.join(", ")}`
  },
  summarize(input, output) {
    return `credentials · ${(String(output).match(/,/g) ?? []).length + 1} available`
  },
}

export const httpRequest = {
  id: "http_request",
  name: "Call an API",
  description: [
    "Make an HTTP request and return the response. Use this for JSON APIs and for anything that needs a method, headers or a body — web_fetch is for reading public pages as text.",
    "",
    "To authenticate, pass `useSecret` with the NAME of a stored credential (see secret_list). Its value is attached to the request for you; you never see it and it never appears in this conversation. By default it is sent as `Authorization: Bearer <value>`; set `secretHeader` and `secretPrefix` for APIs that want something else.",
    "",
    "Binary responses — wasm, images, archives, fonts — are kept as bytes and written to a document rather than decoded into this conversation. Pass `folder` to put that document straight into a package. Decoding bytes as text would corrupt them silently, so it is never done.",
    "",
    "A plain GET is granted per site, like web_fetch. Anything carrying a credential, anything that is not a GET, and anything with a body asks the user every time however much has been granted — so do not reach for a method or a secret you do not need.",
    "",
    "This runs in a browser, so the target must serve permissive CORS. A failure that mentions CORS means the API cannot be reached from here, not that the credential is wrong.",
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
   * The danger was never the tool, it is the arguments. A GET with no secret is
   * a fetch and is granted like one. A request carrying your credentials to an
   * arbitrary URL, or changing something at the other end, is the most
   * dangerous thing in this toolset and still asks every single time.
   */
  alwaysAsk: (input) =>
    !!input?.useSecret || String(input?.method ?? "GET").toUpperCase() !== "GET" || !!input?.body,
  input_schema: {
    type: "object",
    required: ["url"],
    properties: {
      url: { type: "string", description: "Absolute http(s) URL." },
      method: { type: "string", description: "GET, POST, PUT, PATCH, DELETE. Default GET." },
      headers: { type: "object", description: "Extra headers.", additionalProperties: { type: "string" } },
      body: { type: "string", description: "Request body, already serialized." },
      useSecret: { type: "string", description: "Name of a stored credential to attach." },
      secretHeader: { type: "string", description: "Header to put it in. Default 'Authorization'." },
      secretPrefix: { type: "string", description: "Prefix before the value. Default 'Bearer '." },
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

    if (input.useSecret) {
      const value = readSecret(input.useSecret)
      if (!value) {
        throw new Error(
          `No credential named '${input.useSecret}' on this device. Use secret_list to see what exists, or ask the user to add it in the agent's settings.`
        )
      }
      const header = input.secretHeader ?? "Authorization"
      const prefix = input.secretPrefix ?? "Bearer "
      headers[header] = `${prefix}${value}`
    }

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
      // Redact before anything is returned: a server can echo a credential back
      // in an error body, and everything returned here lands in the document
      // and then in the next prompt.
      const safe = redact(text)
      if (!response.ok) return `${status}\n\n${truncate(safe, 2000)}`
      return `${status}\n\n${truncate(safe, input.maxChars ?? 12000)}`
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

export default [secretList, httpRequest]
