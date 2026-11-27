/**
 * The task client runners/ask.js asks with: the registry's (host/import.js
 * taskClient), asked for afresh each time; and the own queue among the input's
 * documents that always ask. The registry and the client are stand-ins
 * (fixtures/tasks-stand-in.js); the probes use the Tasks package's own.
 */
import { describe, it, expect, afterEach } from "vitest"
import { join } from "node:path"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { setHostUrls } from "../host/urls.js"
import { taskClient, clientHere, _holdClient } from "../host/import.js"
import { standIn, install } from "../fixtures/tasks-stand-in.js"
import { askWork, forget, workKey } from "./ask.js"

await initSubduction()

const followed = []
afterEach(() => {
  for (const url of followed.splice(0)) forget(url)
  setHostUrls(null)
  _holdClient(null)
})

function session(repo) {
  _resetIds()
  const handle = repo.create()
  handle.change((d) => {
    initSession(d, {})
    d.turns.push(makeTurn("user", [textBlock("hello")]))
    d.burst = null
  })
  followed.push(handle.url)
  return handle
}

/** A client that records what doWork is asked, and says `own` is the person's queue (or fails to say). */
function client({ own } = {}) {
  const asks = []
  return {
    asks,
    doWork: async (...args) => (asks.push(args), { outcome: "idle", heads: null, own: [] }),
    watchWork: (repo, key, onChange) => (onChange({ state: "missing", runs: [] }), () => {}),
    stopWork: async () => true,
    ...(own === undefined ? {} : { ownQueue: async () => (own instanceof Error ? Promise.reject(own) : own) }),
  }
}

describe("the task client", () => {
  it("is the registry's library tasks-next: said missing until the Tasks package arrives, then had, and a newer one had when asked again", async () => {
    setHostUrls({ "@inkandswitch/patchwork-plugins": join(process.cwd(), "fixtures", "tasks-stand-in.js") })
    let missing = 0
    const had = taskClient(() => missing++)
    await new Promise((r) => setTimeout(r, 20))
    expect([missing, clientHere()]).toEqual([1, null])
    const first = standIn()
    install(first)
    expect(await had).toBe(first)
    expect(clientHere()).toBe(first)
    // Asked again, the registry's now: a newer one registered later is taken up.
    const newer = standIn()
    install(newer)
    expect(await taskClient(() => missing++)).toBe(newer)
    expect(clientHere()).toBe(newer)
    expect(missing).toBe(1)
  })

  it("is not had where there is no registry, and nothing is asked", async () => {
    await expect(taskClient()).rejects.toThrow()
    expect(clientHere()).toBe(null)
  })

  it("is what askWork asks with when none is handed in", async () => {
    const repo = new Repo({ network: [] })
    const c = client({ own: null })
    _holdClient(c)
    await askWork(repo, session(repo).url, { importUrl: "data:text/javascript,", onOnline: () => () => {} })
    expect(c.asks).toHaveLength(1)
  })

  it("puts the person's own queue among the documents that always ask, once, keys last", async () => {
    const repo = new Repo({ network: [] })
    const own = repo.create({ jobs: {} }).url
    const h = session(repo)
    const c = client({ own })
    await askWork(repo, h.url, { client: c, importUrl: "data:text/javascript,", onOnline: () => () => {}, account: { rootFolderUrl: null, sensitiveDocs: ["automerge:settings", own] }, keys: { model: "k", search: null, relay: null } })
    const [, request] = c.asks[0]
    expect(request.key).toBe(workKey(h.url))
    expect(Object.keys(request.input)).toEqual(["session", "heads", "account", "keys"])
    expect(request.input.account.sensitiveDocs).toEqual(["automerge:settings", own])
  })

  it("adds the own queue when the account did not name it, and asks all the same when the client cannot say which it is", async () => {
    const repo = new Repo({ network: [] })
    const own = repo.create({ jobs: {} }).url
    const said = client({ own })
    await askWork(repo, session(repo).url, { client: said, importUrl: "data:text/javascript,", onOnline: () => () => {} })
    expect(said.asks[0][1].input.account).toEqual({ rootFolderUrl: null, sensitiveDocs: [own] })

    const failing = client({ own: new Error("no account here") })
    await askWork(repo, session(repo).url, { client: failing, importUrl: "data:text/javascript,", onOnline: () => () => {} })
    expect(failing.asks[0][1].input.account.sensitiveDocs).toEqual([])
  })
})
