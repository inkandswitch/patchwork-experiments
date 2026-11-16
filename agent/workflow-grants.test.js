/**
 * One job, one set of permissions; research that cannot leak; news told once.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest"
import * as A from "@automerge/automerge"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initPlan, PLAN, STEP, validateSteps } from "./workflow/plan.js"
import { WorkflowDriver, WEB_GRANT, _resetDrivers } from "./workflow/driver.js"
import { initSession, makeTurn, textBlock, callBlock, claimLease, CALL, STATUS, _resetIds } from "./session.js"
import { renderWaitingItem } from "./ui/waiting.js"
import { waitingIn } from "./workflow/waiting.js"

await initSubduction()

const step = (id, over = {}) => ({ id, title: id, prompt: "p", why: "w", where: "worker", tier: "fast", after: [], ...over })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => _resetIds())
const drivers = []
afterEach(() => { for (const d of drivers.splice(0)) d.stop(); _resetDrivers(); document.body.replaceChildren() })

/** A session with a web fetch waiting for permission. */
function fetching(handle, url = "https://dnv.com/rules", id = "f1") {
  handle.change((d) => {
    const call = callBlock("web_fetch", { url }, { id })
    call.status = CALL.pending
    d.turns.push(makeTurn("assistant", [call]))
    d.status = STATUS.awaitingApproval
  })
}

function setup(steps, { behaviour = {} } = {}) {
  const repo = new Repo({ network: [] })
  const orchestrator = repo.create({})
  orchestrator.change((d) => initSession(d, {}))
  const plan = repo.create({})
  plan.change((d) => initPlan(d, { title: "Pack", goal: "G", sessionUrl: orchestrator.url, steps }))
  const news = []
  const startSession = async (handle) => {
    const act = behaviour[handle.doc().workflow?.stepId] ?? "hang"
    if (act === "answer" && handle.doc().turns.length === 1) {
      handle.change((d) => {
        d.turns.push(makeTurn("assistant", [textBlock(`result of ${d.workflow.stepId}`)]))
        d.status = STATUS.idle
      })
    }
    return { runner: { interrupt: () => {} }, listen: () => {} }
  }
  const make = () => {
    const driver = new WorkflowDriver({
      repo, handle: plan, startSession, heartbeatMs: 1e9, settleMs: 5, toolIds: { worker: ["doc_read"] }, sensitive: () => [],
      notify: () => ({ notify: (render) => { const text = render(); if (text) news.push(text) }, close: () => {} }),
    })
    drivers.push(driver)
    return driver
  }
  return { repo, plan, orchestrator, news, make }
}

async function settle(driver, rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    await driver.kick()
    await sleep(10)
  }
}

const sessionOf = async (repo, plan, id) => repo.find(plan.doc().steps.find((s) => s.id === id).sessionUrl)

describe("web-only research steps", () => {
  it("are checked: a known access, and on a worker", () => {
    const plan = { steps: [], limits: {} }
    expect(validateSteps(plan, [step("r", { access: "web" })])).toEqual([])
    expect(validateSteps(plan, [step("r", { access: "web", where: "host" })]).join()).toMatch(/runs on a worker/)
    expect(validateSteps(plan, [step("r", { access: "everything" })]).join()).toMatch(/'access' must be/)
  })

  it("are confined by their session's scope, about no document, and may fetch any site", async () => {
    const { repo, plan, make } = setup([step("research", { access: "web" })])
    const driver = make()
    driver.start()
    await settle(driver)
    const session = (await sessionOf(repo, plan, "research")).doc()
    // The scope is the whole of what decides its tools and its reach
    // (scope.js); there is no tool list to edit and no access flag beside it.
    expect(session.scope).toEqual({ kind: "web", ledgerUrl: plan.url, stepId: "research" })
    expect(session.tools).toBeUndefined()
    expect(session.workflow).toEqual({ planUrl: plan.url, stepId: "research", orchestratorUrl: plan.doc().sessionUrl })
    expect(session.subject).toBeNull()
    expect({ ...session.grants }).toEqual({ [WEB_GRANT]: "session" })
  })

  it("and a full step gets none of that", async () => {
    const { repo, plan, make } = setup([step("build")])
    const driver = make()
    driver.start()
    await settle(driver)
    const session = (await sessionOf(repo, plan, "build")).doc()
    expect(session.scope).toBeUndefined()
    expect(session.tools).toEqual({ enabled: ["doc_read"] })
    expect(session.grants[WEB_GRANT]).toBeUndefined()
  })
})

describe("one job, one set of permissions", () => {
  it("a grant given in one step reaches the others, and releases what they were waiting on", async () => {
    const { repo, plan, orchestrator, make } = setup([step("a"), step("b")])
    const driver = make()
    driver.start()
    await settle(driver)
    const a = await sessionOf(repo, plan, "a")
    const b = await sessionOf(repo, plan, "b")
    fetching(b, "https://dnv.com/rules", "fb")

    a.change((d) => { d.grants["web@*"] = "session" }) // granted "any site" in step a
    await settle(driver)

    expect(b.doc().grants["web@*"]).toBe("session")
    expect(orchestrator.doc().grants["web@*"]).toBe("session")
    expect(waitingIn(b.doc())).toEqual([]) // b's waiting fetch went ahead
    expect(b.doc().turns.at(-1).blocks[0].status).toBe(CALL.approved)
  })

  it("but a web-only step's standing 'any site' does not spread to sessions that can read your documents", async () => {
    const { repo, plan, orchestrator, make } = setup([step("research", { access: "web" }), step("build")])
    const driver = make()
    driver.start()
    await settle(driver)
    expect((await sessionOf(repo, plan, "research")).doc().grants[WEB_GRANT]).toBe("session")
    expect((await sessionOf(repo, plan, "build")).doc().grants[WEB_GRANT]).toBeUndefined()
    expect(orchestrator.doc().grants[WEB_GRANT]).toBeUndefined()
  })

  it("a research step neither gives nor receives: not the orchestrator's grants, not its siblings', not its own", async () => {
    const { repo, plan, orchestrator, make } = setup([step("research", { access: "web" }), step("build")])
    orchestrator.change((d) => { d.grants["files@*"] = "session" })
    const driver = make()
    driver.start()
    await settle(driver)
    const research = await sessionOf(repo, plan, "research")
    const build = await sessionOf(repo, plan, "build")
    expect(build.doc().grants["files@*"]).toBe("session") // a full step receives

    build.change((d) => { d.grants["web@dnv.com"] = "session" })
    research.change((d) => { d.grants["doc_edit@*"] = "always" })
    await settle(driver)

    expect({ ...research.doc().grants }).toEqual({ [WEB_GRANT]: "session", "doc_edit@*": "always" })
    expect(orchestrator.doc().grants["web@dnv.com"]).toBe("session") // full steps still share
    for (const full of [orchestrator, build]) expect(full.doc().grants["doc_edit@*"]).toBeUndefined()
  })

  it("never covers the account's own documents", async () => {
    const { repo, plan, make } = setup([step("a")])
    const driver = make()
    driver.sensitive = () => ["automerge:settings"]
    driver.start()
    await settle(driver)
    const a = await sessionOf(repo, plan, "a")
    a.change((d) => {
      d.grants["doc_edit@*"] = "always"
      const call = callBlock("doc_edit", { url: "automerge:settings", ops: [] }, { id: "e1" })
      call.status = CALL.pending
      d.turns.push(makeTurn("assistant", [call]))
      d.status = STATUS.awaitingApproval
    })
    await settle(driver)
    expect(a.doc().turns.at(-1).blocks[0].status).toBe(CALL.pending)
  })

  it("settles: with nothing new, sharing writes nothing", async () => {
    const { repo, plan, make } = setup([step("a"), step("b")])
    const driver = make()
    driver.start()
    await settle(driver)
    ;(await sessionOf(repo, plan, "a")).change((d) => { d.grants["web@dnv.com"] = "session" })
    await settle(driver)
    const heads = await Promise.all(["a", "b"].map(async (id) => A.getHeads((await sessionOf(repo, plan, id)).doc())))
    await settle(driver)
    const after = await Promise.all(["a", "b"].map(async (id) => A.getHeads((await sessionOf(repo, plan, id)).doc())))
    expect(after).toEqual(heads)
  })
})

describe("news, told once", () => {
  it("a new driver — after a reload, or in another tab — does not tell finished steps again", async () => {
    const { plan, news, make } = setup([step("a")], { behaviour: { a: "answer" } })
    const first = make()
    first.start()
    await settle(first)
    expect(news.filter((n) => n.includes("## Done: a"))).toHaveLength(1)
    first.stop()
    plan.change((d) => { d.lease.at = 0 })
    const second = make()
    second.start()
    await settle(second)
    expect(news.filter((n) => n.includes("## Done: a"))).toHaveLength(1)
  })

  it("the end is news once, however many ticks follow it", async () => {
    const { news, make } = setup([step("a")], { behaviour: { a: "answer" } })
    const driver = make()
    driver.start()
    await settle(driver, 20)
    expect(news.filter((n) => n.includes("The workflow is over"))).toHaveLength(1)
  })
})

describe("cancelling", () => {
  it("stops a step whose runner is somewhere else: the session's lease is taken and it says it stopped", async () => {
    const { repo, plan, make } = setup([step("a")])
    const driver = make()
    driver.start()
    await settle(driver)
    const a = await sessionOf(repo, plan, "a")
    a.change((d) => {
      claimLease(d, "tab-elsewhere", Date.now())
      d.status = STATUS.running
    })
    await driver.cancel(["a"])
    expect(a.doc().status).toBe(STATUS.idle)
    expect(a.doc().lease.runner).not.toBe("tab-elsewhere")
    expect(plan.doc().steps[0].status).toBe(STEP.cancelled)
  })
})

describe("granting from the peek or the strip", () => {
  it("offers this site and any site, and any site releases the session's other waiting fetches", async () => {
    const repo = new Repo({ network: [] })
    const handle = repo.create({})
    handle.change((d) => initSession(d, {}))
    fetching(handle, "https://dnv.com/rules", "f1")
    handle.change((d) => {
      const second = callBlock("web_fetch", { url: "https://abs.org/standards" }, { id: "f2" })
      second.status = CALL.pending
      d.turns.at(-1).blocks.push(second)
    })
    const [first] = waitingIn(handle.doc())
    const node = renderWaitingItem({ ...first, handle, stepTitle: "Research" })
    const labels = [...node.querySelectorAll("button")].map((b) => b.textContent)
    expect(labels).toEqual(["Allow once", "Allow dnv.com", "Allow any site", "Deny"])
    ;[...node.querySelectorAll("button")].find((b) => b.textContent === "Allow any site").click()
    expect(waitingIn(handle.doc())).toEqual([]) // both fetches go ahead
  })
})
