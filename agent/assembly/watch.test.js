import { describe, it, expect, vi } from "vitest"
import * as A from "@automerge/automerge"

// The host's automerge and repo, supplied from node_modules instead of the importmap.
vi.mock("../host/import.js", () => ({
  hostImport: (name) =>
    name === "automerge" ? import("@automerge/automerge")
    : name === "repo" ? import("@automerge/automerge-repo")
    : Promise.reject(new Error(`no host module ${name} in tests`)),
}))

const { Repo, initSubduction } = await import("@automerge/automerge-repo")
await initSubduction()
const { docWatch, restoreWatches, splitTarget, KEPT_EDITS } = await import("../tools/watch.js")
const { createEvents } = await import("../kernel/events.js")
const { handleStore, watchesWriter } = await import("../kernel/store.js")
const { initSession, STATUS } = await import("../session/schema.js")
const { fullContext } = await import("../kernel/runner.js")

/** Change events are judged a microtask after they fire (tools/watch.js). */
const settled = () => new Promise((r) => setTimeout(r, 0))

/** A run document as OpenFOAM writes one: big frozen inputs, a status, a log. */
function runDoc(repo) {
  return repo.create({
    status: "queued",
    stl: new Uint8Array(200_000),
    progress: [],
    log: "",
    error: null,
  })
}

function sessionStore(repo) {
  const handle = repo.create()
  handle.change((d) => initSession(d))
  return handleStore(handle, A.splice)
}

/** Events that record every notify, so a test can deliver when it likes. */
function recordingEvents() {
  const channels = new Map()
  const events = {
    open(key, { onClose } = {}) {
      const channel = {
        renders: [],
        closed: false,
        notify(render) {
          if (!channel.closed) channel.renders.push(render)
        },
        close() {
          if (channel.closed) return
          channel.closed = true
          onClose?.()
        },
      }
      channels.get(key)?.close()
      channels.set(key, channel)
      return channel
    },
    forTool: () => events,
    channel: (key) => channels.get(key),
    /** Deliver: render the latest notice, as kernel/events.js does once it may wake. */
    deliver(key) {
      const channel = channels.get(key)
      const render = channel?.renders.at(-1)
      if (!channel) return ""
      channel.renders = []
      return render ? render() : ""
    },
    stopAll() {
      for (const c of channels.values()) c.close()
    },
  }
  return events
}

/** doc_watch as a runner calls it: the watches writer is its privilege. */
async function watch(input, { repo, store, events, subject = null }) {
  const ctx = { repo, subject, events, watches: watchesWriter(store) }
  return docWatch.execute(input, ctx)
}

const idOf = (text) => text.match(/, as (w\w+)\./)[1]

describe("doc_watch: woken by what matters, not by every change", () => {
  it("a run's status: only the edits that match wake, with the value they replaced", async () => {
    const repo = new Repo({ network: [] })
    const run = runDoc(repo)
    const store = sessionStore(repo)
    const events = recordingEvents()

    const result = await watch({ url: run.url, path: ["status"], match: "failed|done", label: "the run" }, { repo, store, events })
    expect(result).toContain('Now: "queued"')
    const id = idOf(result)

    // Progress elsewhere in the document is not even heard: the sub-handle is
    // told only about its own path.
    run.change((d) => { d.progress.push(1, 2, 3) })
    run.change((d) => { d.status = "solving" })
    await settled()
    expect(events.channel(id).renders).toHaveLength(0)

    run.change((d) => { d.status = "failed" })
    await settled()
    expect(events.channel(id).renders).toHaveLength(1)
    await settled()
    const text = events.deliver(id)
    expect(text).toContain('set /status = "failed" (was "solving")')
    expect(text).toContain(`Still watching (${id})`)

    // Delivered once: nothing more to say until something new matches.
    await settled()
    expect(events.deliver(id)).toBe("")
  })

  it("text appended to a log matches inside the inserted text", async () => {
    const repo = new Repo({ network: [] })
    const run = runDoc(repo)
    const store = sessionStore(repo)
    const events = recordingEvents()
    const id = idOf(await watch({ url: run.url, path: ["log"], match: "fatal" }, { repo, store, events }))

    run.change((d) => { A.splice(d, ["log"], 0, 0, "Time = 1\nsolving\n") })
    await settled()
    expect(events.channel(id).renders).toHaveLength(0)
    run.change((d) => { A.splice(d, ["log"], d.log.length, 0, "--> FOAM FATAL ERROR: cannot open mesh\n") })
    await settled()
    expect(events.deliver(id)).toMatch(/insert \/log\/\d+ = ".*FOAM FATAL ERROR/)
  })

  it("with no match, every edit under the path is reported, and nothing outside it", async () => {
    const repo = new Repo({ network: [] })
    const run = runDoc(repo)
    const store = sessionStore(repo)
    const events = recordingEvents()
    const id = idOf(await watch({ url: run.url, path: ["error"] }, { repo, store, events }))

    run.change((d) => { d.status = "meshing" })
    await settled()
    expect(events.channel(id).renders).toHaveLength(0)
    run.change((d) => { d.error = "snappyHexMesh exited 1" })
    await settled()
    expect(events.deliver(id)).toContain('set /error = "snappyHexMesh exited 1" (was null)')
  })

  it("a change that replaces the watched part wholesale is one edit of all of it", async () => {
    const repo = new Repo({ network: [] })
    const doc = repo.create({ runs: [{ status: "solving" }] })
    const store = sessionStore(repo)
    const events = recordingEvents()
    const id = idOf(await watch({ url: doc.url, path: ["runs", 0] }, { repo, store, events }))

    doc.change((d) => { d.runs[0] = { status: "done", drag: 12.5 } })
    await settled()
    const text = events.deliver(id)
    expect(text).toContain("/runs/0")
    expect(text).toContain('"done"')
  })

  it("the session's own edits are not reported; a person's in the same tab are, even mid-turn", async () => {
    const repo = new Repo({ network: [] })
    const run = runDoc(repo)
    const store = sessionStore(repo)
    const events = recordingEvents()
    // The repo a runner hands this session's tools: every write noted as its own.
    const agentRepo = fullContext({ repo }, store).repo
    const id = idOf(await watch({ url: run.url, path: ["status"] }, { repo: agentRepo, store, events }))
    store.change((d) => { d.burst = { run: "run-elsewhere" } })

    // The agent cancels the run, through its own tools' repo.
    ;(await agentRepo.find(run.url)).change((d) => { d.status = "cancelled" })
    await settled()
    expect(events.channel(id).renders).toHaveLength(0)

    // The person, in the same tab, at the same moment, through the page's repo.
    run.change((d) => { d.status = "queued" })
    await settled()
    expect(events.deliver(id)).toContain('set /status = "queued" (was "cancelled")')
  })

  it("another session's edits are someone else's", async () => {
    const repo = new Repo({ network: [] })
    const run = runDoc(repo)
    const store = sessionStore(repo)
    const other = sessionStore(repo)
    const events = recordingEvents()
    const id = idOf(await watch({ url: run.url, path: ["status"] }, { repo: fullContext({ repo }, store).repo, store, events }))

    ;(await fullContext({ repo }, other).repo.find(run.url)).change((d) => { d.status = "done" })
    await settled()
    expect(events.deliver(id)).toContain('set /status = "done"')
  })

  it("the session's own edit is recorded as seen, so a runner that starts later does not report it", async () => {
    const repo = new Repo({ network: [] })
    const run = runDoc(repo)
    const store = sessionStore(repo)
    const agentRepo = fullContext({ repo }, store).repo
    const first = recordingEvents()
    const id = idOf(await watch({ url: run.url, path: ["status"] }, { repo: agentRepo, store, events: first }))
    ;(await agentRepo.find(run.url)).change((d) => { d.status = "cancelled" })
    await settled()
    first.stopAll()

    const second = recordingEvents()
    await restoreWatches({ repo: agentRepo, events: second, store })
    await settled()
    expect(second.deliver(id)).toBe("")
  })

  it("edits from another peer are reported even mid-turn", async () => {
    const repo = new Repo({ network: [] })
    const run = runDoc(repo)
    const store = sessionStore(repo)
    const events = recordingEvents()
    const id = idOf(await watch({ url: run.url, path: ["status"] }, { repo, store, events }))
    store.change((d) => { d.burst = { run: "run-elsewhere" } })

    // The daemon's edit, arriving as changes from elsewhere.
    const elsewhere = A.change(A.clone(run.doc()), (d) => { d.status = "failed" })
    run.update((d) => A.applyChanges(d, A.getChanges(run.doc(), elsewhere))[0])
    await settled()
    expect(events.deliver(id)).toContain('set /status = "failed"')
  })

  it(`keeps the newest ${KEPT_EDITS} edits for one wake and counts the rest`, async () => {
    const repo = new Repo({ network: [] })
    const doc = repo.create({ n: 0 })
    const store = sessionStore(repo)
    const events = recordingEvents()
    const id = idOf(await watch({ url: doc.url, path: ["n"] }, { repo, store, events }))

    for (let i = 1; i <= KEPT_EDITS + 5; i++) doc.change((d) => { d.n = i })
    await settled()
    const text = events.deliver(id)
    expect(text).toContain(`${KEPT_EDITS + 5} edits`)
    expect(text).toContain("(5 earlier edits not shown")
    expect(text).toContain(`set /n = ${KEPT_EDITS + 5} (was ${KEPT_EDITS + 4})`)
    expect(text).not.toContain("set /n = 5 (was 4)")
  })
})

describe("doc_watch: a watch outlives its runner", () => {
  it("a runner that starts reports what matched while nobody was listening, once", async () => {
    const repo = new Repo({ network: [] })
    const run = runDoc(repo)
    const store = sessionStore(repo)
    const first = recordingEvents()
    const id = idOf(await watch({ url: run.url, path: ["status"], match: "failed" }, { repo, store, events: first }))

    // The tab closes: its runner's channels close, and nobody is listening.
    first.stopAll()
    run.change((d) => { d.status = "solving" })
    run.change((d) => { d.status = "failed" })
    await settled()
    expect(first.channel(id).renders).toHaveLength(0)

    // A runner starts and opens the session's watches again.
    const second = recordingEvents()
    expect(await restoreWatches({ repo, events: second, store })).toEqual([{ id, ok: true }])
    // A catch-up is the net difference: queued → failed, one edit.
    await settled()
    const text = second.deliver(id)
    expect(text).toContain('set /status = "failed" (was "queued")')
    expect(text).toContain("1 edit matching")

    // Reported, and recorded as reported: the next runner has nothing to say.
    second.stopAll()
    const third = recordingEvents()
    await restoreWatches({ repo, events: third, store })
    await settled()
    expect(third.deliver(id)).toBe("")

    // ...and is listening: new edits still arrive.
    run.change((d) => { d.status = "failed" })
    run.change((d) => { d.status = "solving" })
    run.change((d) => { d.status = "failed" })
    await settled()
    expect(third.deliver(id)).toContain('set /status = "failed" (was "solving")')
  })

  it("an edit seen but not yet delivered when the runner goes is reported by the next", async () => {
    const repo = new Repo({ network: [] })
    const run = runDoc(repo)
    const store = sessionStore(repo)
    const first = recordingEvents()
    const id = idOf(await watch({ url: run.url, path: ["status"] }, { repo, store, events: first }))
    run.change((d) => { d.status = "done" })
    first.stopAll() // never delivered

    const second = recordingEvents()
    await restoreWatches({ repo, events: second, store })
    await settled()
    expect(second.deliver(id)).toContain('set /status = "done" (was "queued")')
  })

  it("one page holds one watch per id: opening it again replaces the old listener", async () => {
    const repo = new Repo({ network: [] })
    const run = runDoc(repo)
    const store = sessionStore(repo)
    const first = recordingEvents()
    const id = idOf(await watch({ url: run.url, path: ["status"] }, { repo, store, events: first }))
    const second = recordingEvents()
    await restoreWatches({ repo, events: second, store })

    await settled()
    expect(first.channel(id).closed).toBe(true)
    run.change((d) => { d.status = "done" })
    await settled()
    expect(first.channel(id).renders).toHaveLength(0)
    await settled()
    expect(second.deliver(id)).toContain('"done"')
  })
})

describe("doc_watch: stopping", () => {
  it("stop removes the watch from the session and stops listening", async () => {
    const repo = new Repo({ network: [] })
    const run = runDoc(repo)
    const store = sessionStore(repo)
    const events = recordingEvents()
    const id = idOf(await watch({ url: run.url, path: ["status"] }, { repo, store, events }))

    const result = await watch({ stop: id }, { repo, store, events })
    expect(result).toContain(`Stopped ${id}.`)
    expect(result).toContain("No watches.")
    expect(store.doc().watches[id]).toBeUndefined()
    await settled()
    expect(events.channel(id).closed).toBe(true)
    run.change((d) => { d.status = "done" })
    await settled()
    expect(events.channel(id).renders).toHaveLength(0)
  })

  it("a watch stopped from another runner closes itself here at its next change", async () => {
    const repo = new Repo({ network: [] })
    const run = runDoc(repo)
    const store = sessionStore(repo)
    const events = recordingEvents()
    const id = idOf(await watch({ url: run.url, path: ["status"] }, { repo, store, events }))

    store.change((d) => { delete d.watches[id] }) // as another tab's doc_watch {stop} writes it
    run.change((d) => { d.status = "done" })
    await settled()
    expect(events.channel(id).renders).toHaveLength(0)
    await settled()
    expect(events.channel(id).closed).toBe(true)
  })

  it("watching the same thing again updates the watch instead of adding one", async () => {
    const repo = new Repo({ network: [] })
    const run = runDoc(repo)
    const store = sessionStore(repo)
    const events = recordingEvents()
    const id = idOf(await watch({ url: run.url, path: ["status"], match: "x" }, { repo, store, events }))
    const again = await watch({ url: run.url, path: ["status"], match: "x", label: "renamed" }, { repo, store, events })
    expect(again).toContain(`Already watching; updated`)
    expect(idOf(again)).toBe(id)
    expect(Object.keys(store.doc().watches)).toEqual([id])
  })
})

describe("doc_watch: what it is given", () => {
  it("a path may ride in the URL, as a sub-handle's URL carries it", () => {
    expect(splitTarget("automerge:abc/runs/0/status")).toEqual({ doc: "automerge:abc", path: ["runs", 0, "status"] })
    expect(splitTarget("automerge:abc/runs", [2, "log"])).toEqual({ doc: "automerge:abc", path: ["runs", 2, "log"] })
    expect(splitTarget("automerge:abc")).toEqual({ doc: "automerge:abc", path: [] })
  })

  it("a fixed version cannot be watched", () => {
    expect(() => splitTarget("automerge:abc#xyz")).toThrow(/fixed version/)
  })

  it("defaults to the session's document", async () => {
    const repo = new Repo({ network: [] })
    const run = runDoc(repo)
    const store = sessionStore(repo)
    const result = await watch({ path: ["status"] }, { repo, store, events: recordingEvents(), subject: run.url })
    expect(result).toContain(`Watching ${run.url} /status`)
  })

  it("a session that cannot be woken cannot watch", async () => {
    const repo = new Repo({ network: [] })
    const run = runDoc(repo)
    await expect(docWatch.execute({ url: run.url }, { repo, watches: null, events: null })).rejects.toThrow(/cannot be woken/)
  })
})

describe("doc_watch through events.js: a real wake", () => {
  it("a matching edit becomes an event turn in an idle session", async () => {
    const repo = new Repo({ network: [] })
    const run = runDoc(repo)
    const store = sessionStore(repo)
    const events = createEvents(store, { policy: { settleMs: 5, maxDelayMs: 20, minGapMs: 0 } })
    await watch({ url: run.url, path: ["status"], match: "failed", label: "OpenFOAM run" }, { repo, store, events: events.forTool("doc_watch") })

    run.change((d) => { d.status = "solving" })
    run.change((d) => { d.status = "failed" })
    await vi.waitFor(() => expect(store.doc().turns.length).toBe(1), { timeout: 1000 })
    const [block] = store.doc().turns[0].blocks
    expect(block.type).toBe("event")
    expect(block.source).toBe("doc_watch")
    expect(block.label).toBe("OpenFOAM run")
    expect(block.text).toContain('set /status = "failed" (was "solving")')
    events.stop()
  })

  it("stopping the session's events lets go of the document", async () => {
    const repo = new Repo({ network: [] })
    const run = runDoc(repo)
    const store = sessionStore(repo)
    const events = createEvents(store, { policy: { settleMs: 5, maxDelayMs: 20, minGapMs: 0 } })
    await watch({ url: run.url, path: ["status"] }, { repo, store, events: events.forTool("doc_watch") })
    expect(events.listening()).toBe(1)
    const sub = run.sub("status")
    const before = sub.listenerCount("change")
    events.stop()
    expect(sub.listenerCount("change")).toBe(before - 1)
  })
})

describe("doc_watch: the page that shows the session listens again", () => {
  it("restoreWatches opens the session's watches and the next edit wakes it (runners/page.js follow)", async () => {
    const repo = new Repo({ network: [] })
    const run = runDoc(repo)
    const store = sessionStore(repo)
    const first = recordingEvents()
    const id = idOf(await watch({ url: run.url, path: ["status"], match: "done" }, { repo, store, events: first }))
    first.stopAll() // the page that made it is gone

    const events = createEvents(store, { policy: { settleMs: 5, maxDelayMs: 20, minGapMs: 0 } })
    await restoreWatches({ repo, events, store })
    expect(events.listening()).toBe(1)

    run.change((d) => { d.status = "done" })
    await vi.waitFor(() => expect(store.doc().turns.length).toBe(1), { timeout: 1000 })
    expect(store.doc().turns[0].blocks[0].text).toContain(`set /status = "done" (was "queued")`)
    expect(store.doc().turns[0].blocks[0].text).toContain(`Still watching (${id})`)
    events.stop()
  })
})
