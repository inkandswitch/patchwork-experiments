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
 *   - `alwaysAsk`, every single time. A request that can carry your credentials
 *     to an arbitrary URL is the most dangerous thing in this toolset, and a
 *     session-long grant is the wrong level of consent for it. The approval
 *     card shows the method, the URL, and which secret is attached.
 *
 * CORS still applies — this is a browser. A request to an API that does not
 * serve permissive CORS will fail, and that is what the `task` tier and a
 * runner outside the browser are for.
 */

import { listSecrets, readSecret, redact } from "../secrets.js"
import { truncate, bytes } from "./format.js"

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
    "This runs in a browser, so the target must serve permissive CORS. A failure that mentions CORS means the API cannot be reached from here, not that the credential is wrong.",
  ].join("\n"),
  where: "worker",
  risk: "external",
  // Every time. See the note at the top of this file.
  alwaysAsk: true,
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
      maxChars: { type: "number", description: "Default 12000." },
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

    const text = await response.text().catch(() => "")
    // Redact before anything is returned: a server can echo a credential back
    // in an error body, and everything returned here lands in the document and
    // then in the next prompt.
    const safe = redact(text)

    const summary = `${method} ${url} → ${response.status} ${response.statusText} (${bytes(text.length)})`
    if (!response.ok) {
      return `${summary}\n\n${truncate(safe, 2000)}`
    }
    return `${summary}\n\n${truncate(safe, input.maxChars ?? 12000)}`
  },

  summarize(input, output) {
    const status = String(output ?? "").match(/→ (\d{3})/)
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
