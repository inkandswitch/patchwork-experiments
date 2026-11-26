/**
 * A session's task through the repo a session's tools are handed
 * (kernel/kernel-repo.js): its input holds its asker's keys, so no tool reads
 * it; other packages' tasks, and every other document, read as before.
 */
import { describe, it, expect } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { kernelRepo, isSessionTask, TASK_REFUSAL } from "./kernel-repo.js"

await initSubduction()

const KEY = "model-key-made-up-for-this-test"

function world() {
  const repo = new Repo({ network: [] })
  const session = repo.create({ title: "a session" })
  const agentTask = repo.create({ importUrl: "data:text/javascript,", input: { session: session.url, keys: { model: KEY } }, key: `agent:${session.url}`, runs: [] })
  const otherTask = repo.create({ importUrl: "data:text/javascript,", input: { mesh: 3 }, key: "fea:run", runs: [{ id: "r", pool: "p", start: 0 }] })
  const queue = repo.create({ "@patchwork": { type: "task-queue-next" }, jobs: { [`agent:${session.url}`]: { taskUrl: agentTask.url, askedAt: 0, package: null } } })
  return { repo, guarded: kernelRepo(repo), session, agentTask, otherTask, queue }
}

describe("a session's task through kernelRepo", () => {
  it("is known by its shape: a task under an agent: key", () => {
    const { agentTask, otherTask, queue, session } = world()
    expect(isSessionTask(agentTask.doc())).toBe(true)
    expect(isSessionTask(otherTask.doc())).toBe(false)
    expect(isSessionTask(queue.doc())).toBe(false)
    expect(isSessionTask(session.doc())).toBe(false)
    expect(isSessionTask(null)).toBe(false)
  })

  it("is found, but nothing of it is read, heard or changed", async () => {
    const { guarded, agentTask } = world()
    const handle = await guarded.find(agentTask.url)
    expect(handle.url).toBe(agentTask.url)
    expect(handle.isReady()).toBe(true)
    await handle.whenReady()
    for (const read of [() => handle.doc(), () => handle.heads(), () => handle.history(), () => handle.on("change", () => {}), () => handle.change((d) => (d.x = 1)), () => handle.view(handle.heads())]) {
      expect(read).toThrow(TASK_REFUSAL)
    }
    expect(agentTask.doc().x).toBeUndefined()
  })

  it("is not exported", async () => {
    const { guarded, agentTask, otherTask } = world()
    await expect(guarded.export(agentTask.documentId)).rejects.toThrow(TASK_REFUSAL)
    expect((await guarded.export(otherTask.documentId)).byteLength).toBeGreaterThan(0)
  })

  it("is refused through the table of live handles too", () => {
    const { guarded, agentTask } = world()
    const live = guarded.handles[agentTask.documentId]
    expect(() => live.doc()).toThrow(TASK_REFUSAL)
  })

  it("leaves another package's task, the queue and the session readable", async () => {
    const { guarded, otherTask, queue, session } = world()
    expect((await guarded.find(otherTask.url)).doc().input.mesh).toBe(3)
    expect(Object.keys((await guarded.find(queue.url)).doc().jobs)).toHaveLength(1)
    expect((await guarded.find(session.url)).doc().title).toBe("a session")
  })
})
