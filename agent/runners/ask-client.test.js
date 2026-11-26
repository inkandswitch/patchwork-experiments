/**
 * runners/ask.js with the task system's own client: what it asks for, and
 * the own queue among the input's documents that always ask.
 */
import { describe, it, expect, afterEach } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import * as kit from "../host/task-client.js"
import { askWork, forget, TASK_CLIENT, SESSION_TASK, workKey } from "./ask.js"

await initSubduction()

const followed = []
afterEach(() => {
  for (const url of followed.splice(0)) forget(url)
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

describe("the task client askWork uses", () => {
  it("is the kit copy's doWork, watchWork, stopWork, ownQueue and served by default", () => {
    expect(TASK_CLIENT).toEqual({ doWork: kit.doWork, watchWork: kit.watchWork, stopWork: kit.stopWork, ownQueue: kit.ownQueue, served: kit.served })
    expect(Object.isFrozen(TASK_CLIENT)).toBe(true)
  })

  it("asks for this package's session task, in the package the asker was loaded from", () => {
    // Loaded from a file, not a package, as in a test: there is no package to name.
    expect(SESSION_TASK).toBe(kit.inSamePackage(import.meta.url, "runners/session-task.js"))
    expect(SESSION_TASK).toBe(null)
    const pkg = encodeURIComponent(`${new Repo({ network: [] }).create({}).url}#abc`)
    expect(kit.inSamePackage(`https://site.example/${pkg}/runners/ask.js`, "runners/session-task.js")).toBe(`/${pkg}/runners/session-task.js`)
  })

  it("puts the person's own queue among the documents that always ask, once, keys last", async () => {
    const repo = new Repo({ network: [] })
    const own = repo.create({ jobs: {} }).url
    const h = session(repo)
    const c = client({ own })
    await askWork(repo, h.url, { client: c, importUrl: "data:text/javascript,", onOnline: () => () => {}, account: { rootFolderUrl: null, sensitiveDocs: ["automerge:settings", own] }, keys: { model: "k", search: null, relay: null } })
    const [, request] = c.asks[0]
    expect(request.key).toBe(workKey(h.url))
    expect(Object.keys(request.input)).toEqual(["session", "heads", "account", "catalogue", "keys"])
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
