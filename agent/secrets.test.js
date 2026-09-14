import { describe, it, expect, beforeEach } from "vitest"
import { listSecrets, readSecret, writeSecret, hasSecret, redact } from "./secrets.js"
import { httpRequest, secretList } from "./tools/http.js"
import { nameFor, titleFrom, webImport } from "./tools/ingest.js"

beforeEach(() => localStorage.clear())

describe("the secret store", () => {
  it("round-trips a value and lists it by name", () => {
    writeSecret("github", "ghp_secretvalue123")
    expect(listSecrets()).toEqual(["github"])
    expect(readSecret("github")).toBe("ghp_secretvalue123")
    expect(hasSecret("github")).toBe(true)
  })

  it("removes a secret when the value is empty", () => {
    writeSecret("x", "v")
    writeSecret("x", null)
    expect(listSecrets()).toEqual([])
  })

  it("ignores unrelated localStorage keys", () => {
    localStorage.setItem("patchwork-agent:key:openrouter", "sk-or-nope")
    writeSecret("github", "v")
    expect(listSecrets()).toEqual(["github"])
  })
})

describe("redact", () => {
  it("replaces a secret value that a server echoed back", () => {
    writeSecret("github", "ghp_averylongsecretvalue")
    const echoed = 'error: bad credentials "ghp_averylongsecretvalue"'
    expect(redact(echoed)).toBe('error: bad credentials "[secret:github redacted]"')
  })

  it("leaves text alone when no secret appears in it", () => {
    writeSecret("github", "ghp_averylongsecretvalue")
    expect(redact("all fine here")).toBe("all fine here")
  })

  it("does not redact very short values, which would mangle ordinary text", () => {
    writeSecret("tiny", "abc")
    expect(redact("abc appears in lots of words")).toBe("abc appears in lots of words")
  })
})

describe("secret_list", () => {
  it("returns names and never values", async () => {
    writeSecret("github", "ghp_secretvalue123")
    const out = await secretList.execute({}, {})
    expect(out).toContain("github")
    expect(out).not.toContain("ghp_secretvalue123")
  })

  it("tells the agent what to do when there are none", async () => {
    expect(await secretList.execute({}, {})).toMatch(/No credentials are stored/)
  })
})

describe("http_request", () => {
  const ok = (body = "{}", status = 200) => async () => ({
    ok: status < 400, status, statusText: "OK", text: async () => body,
  })

  it("attaches a named secret as a bearer token without revealing it", async () => {
    writeSecret("github", "ghp_secretvalue123")
    let seen = null
    const fetchImpl = async (url, options) => { seen = { url, options }; return (await ok()()) }

    await httpRequest.execute({ url: "https://api.example.com/x", useSecret: "github" }, { fetchImpl })

    expect(seen.options.headers.Authorization).toBe("Bearer ghp_secretvalue123")
  })

  it("honours a custom header and prefix", async () => {
    writeSecret("api", "abc123def456")
    let seen = null
    const fetchImpl = async (url, options) => { seen = options; return (await ok()()) }

    await httpRequest.execute(
      { url: "https://api.example.com", useSecret: "api", secretHeader: "X-Api-Key", secretPrefix: "" },
      { fetchImpl }
    )
    expect(seen.headers["X-Api-Key"]).toBe("abc123def456")
    expect(seen.headers.Authorization).toBeUndefined()
  })

  it("explains a missing credential instead of sending an unauthenticated request", async () => {
    let called = false
    const fetchImpl = async () => { called = true; return (await ok()()) }
    await expect(
      httpRequest.execute({ url: "https://api.example.com", useSecret: "nope" }, { fetchImpl })
    ).rejects.toThrow(/No credential named 'nope'/)
    expect(called).toBe(false)
  })

  it("redacts a credential the server echoed back", async () => {
    writeSecret("github", "ghp_secretvalue123")
    const fetchImpl = ok('{"error":"bad token ghp_secretvalue123"}', 401)
    const out = await httpRequest.execute({ url: "https://api.example.com", useSecret: "github" }, { fetchImpl })
    expect(out).not.toContain("ghp_secretvalue123")
    expect(out).toContain("[secret:github redacted]")
    expect(out).toContain("401")
  })

  it("reports status and body for a failure", async () => {
    const out = await httpRequest.execute({ url: "https://api.example.com" }, { fetchImpl: ok("nope", 404) })
    expect(out).toMatch(/404/)
    expect(out).toContain("nope")
  })

  it("names CORS when the request itself fails", async () => {
    const fetchImpl = async () => { throw new TypeError("Failed to fetch") }
    await expect(httpRequest.execute({ url: "https://api.example.com" }, { fetchImpl })).rejects.toThrow(/CORS/)
  })

  it("rejects a relative url and a GET with a body", async () => {
    await expect(httpRequest.execute({ url: "/x" }, {})).rejects.toThrow(/absolute/)
    await expect(httpRequest.execute({ url: "https://x.com", body: "a" }, {})).rejects.toThrow(/GET request cannot/)
  })

  it("always asks, whatever grants exist", () => {
    expect(httpRequest.alwaysAsk).toBe(true)
  })
})

describe("import naming", () => {
  it("prefers the page title", () => {
    expect(nameFor("https://example.com/a/b", "Leek Soup Recipe")).toBe("Leek Soup Recipe.md")
  })
  it("falls back to host and last path segment", () => {
    expect(nameFor("https://example.com/docs/intro")).toBe("example.com-intro.md")
  })
  it("strips characters that break a file name", () => {
    expect(nameFor("https://x.com", 'a/b:c*d?"e')).toBe("a b c d e.md")
  })
  it("reads the reader's Title line", () => {
    expect(titleFrom("Title: Hello World\n\nURL Source: x")).toBe("Hello World")
    expect(titleFrom("no title here")).toBeNull()
  })
})

describe("web_import", () => {
  function repoWithRoot() {
    let n = 0
    const docs = new Map([["automerge:root", { title: "root", docs: [] }]])
    const handle = (url) => ({ url, doc: () => docs.get(url), change(fn) { fn(docs.get(url)) } })
    return {
      docs,
      async create2() { const url = `automerge:d${++n}`; docs.set(url, {}); return handle(url) },
      async find(url) { if (!docs.has(url)) throw new Error("missing"); return handle(url) },
    }
  }

  const page = "Title: Automerge\n\nMarkdown Content:\nA CRDT library."
  const ctx = (repo) => ({
    repo,
    rootFolderUrl: "automerge:root",
    fetchImpl: async () => ({ ok: true, text: async () => page }),
  })

  it("creates a file document in an Imports folder and links it", async () => {
    const repo = repoWithRoot()
    const out = await webImport.execute({ url: "https://automerge.org" }, ctx(repo))

    expect(out.text).toMatch(/Imported https:\/\/automerge\.org as 'Automerge\.md'/)
    const root = repo.docs.get("automerge:root")
    const importsLink = root.docs.find((d) => d.name === "Imports")
    expect(importsLink).toBeTruthy()

    const imports = repo.docs.get(importsLink.url)
    expect(imports.docs).toHaveLength(1)
    const file = repo.docs.get(imports.docs[0].url)
    expect(file.content).toBe(page)
    expect(file.source).toBe("https://automerge.org")
    expect(file.mimeType).toBe("text/markdown")

    // The transcript links to what was imported rather than only describing it.
    expect(out.doc).toMatchObject({ url: imports.docs[0].url, name: "Automerge.md", mimeType: "text/markdown" })
  })

  it("updates in place when the same source is imported again", async () => {
    const repo = repoWithRoot()
    await webImport.execute({ url: "https://automerge.org" }, ctx(repo))
    const importsLink = repo.docs.get("automerge:root").docs.find((d) => d.name === "Imports")
    const firstFileUrl = repo.docs.get(importsLink.url).docs[0].url

    const second = await webImport.execute({ url: "https://automerge.org" }, {
      ...ctx(repo),
      fetchImpl: async () => ({ ok: true, text: async () => "Title: Automerge\n\nUpdated." }),
    })

    expect(second.text).toMatch(/Updated Automerge\.md/)
    expect(repo.docs.get(importsLink.url).docs).toHaveLength(1)
    expect(repo.docs.get(firstFileUrl).content).toContain("Updated.")
    // Still the same document, so the link in the transcript still resolves.
    expect(second.doc.url).toBe(firstFileUrl)
  })

  it("reuses the Imports folder rather than making a second one", async () => {
    const repo = repoWithRoot()
    await webImport.execute({ url: "https://a.example" }, ctx(repo))
    await webImport.execute({ url: "https://b.example" }, ctx(repo))
    const folders = repo.docs.get("automerge:root").docs.filter((d) => d.name === "Imports")
    expect(folders).toHaveLength(1)
  })

  it("needs somewhere to put it", async () => {
    const repo = repoWithRoot()
    await expect(
      webImport.execute({ url: "https://x.com" }, { repo, fetchImpl: ctx(repo).fetchImpl })
    ).rejects.toThrow(/No folder to import into/)
  })
})
