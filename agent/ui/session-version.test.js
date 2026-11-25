/**
 * A session written by another version of the agent: no runner takes it, the
 * view says why, and the places that keep one session for a person are not
 * left holding one that will never run.
 */
import { describe, it, expect } from "vitest"
import { initSession, SCHEMA_VERSION, versionStanding } from "../session/schema.js"
import { ensureSession } from "./panel.js"
import { currentSession } from "./ambient.js"

function fakeRepo(seed = {}) {
  let n = 0
  const docs = new Map(Object.entries(seed))
  const handle = (url) => ({ url, doc: () => docs.get(url), change: (fn) => fn(docs.get(url)) })
  return {
    docs,
    find: async (url) => {
      if (!docs.has(url)) throw new Error("no such document")
      return handle(url)
    },
    create2: async () => {
      const url = "automerge:new" + ++n
      docs.set(url, {})
      return handle(url)
    },
  }
}

const sessionAt = (version) => {
  const doc = {}
  initSession(doc, { title: "Agent" })
  if (version == null) delete doc.schemaVersion
  else doc.schemaVersion = version
  return doc
}

describe("where a session stands against this code", () => {
  it.each([
    [SCHEMA_VERSION, "current"],
    [SCHEMA_VERSION - 1, "earlier"],
    // One from before versions were stamped.
    [null, "earlier"],
    [SCHEMA_VERSION + 1, "newer"],
  ])("version %s is %s", (version, standing) => {
    expect(versionStanding(sessionAt(version))).toBe(standing)
  })
})

// [the session kept, whether it is kept on]
const KEPT = [
  ["a current one", SCHEMA_VERSION, true],
  ["one a newer agent wrote, which that agent can still run", SCHEMA_VERSION + 1, true],
  ["one from an earlier version, which nothing will run", SCHEMA_VERSION - 1, false],
  ["one from before versions were stamped", null, false],
]

describe("the sidebar's session for a document", () => {
  it.each(KEPT)("%s", async (_name, version, keeps) => {
    const repo = fakeRepo({ "automerge:subject": { "@patchwork": { type: "file", agent: "automerge:old" } }, "automerge:old": sessionAt(version) })
    const session = await ensureSession(repo, "automerge:subject")
    const linked = repo.docs.get("automerge:subject")["@patchwork"].agent
    expect(session.url).toBe(linked)
    expect(session.url === "automerge:old").toBe(keeps)
    // What takes an earlier one's place is a session of this version, about the same document.
    expect(versionStanding(session.doc())).toBe(keeps ? versionStanding(sessionAt(version)) : "current")
    if (!keeps) expect(session.doc().subject).toBe("automerge:subject")
    // The earlier one is not touched.
    expect(repo.docs.get("automerge:old")).toEqual(sessionAt(version))
  })
})

describe("the floating box's current session", () => {
  it.each(KEPT)("%s", async (_name, version, keeps) => {
    const repo = fakeRepo({ "automerge:storage": { sessionUrl: "automerge:old", sessions: ["automerge:old"] }, "automerge:old": sessionAt(version) })
    const session = await currentSession(await repo.find("automerge:storage"), repo)
    const storage = repo.docs.get("automerge:storage")
    expect(session.url).toBe(storage.sessionUrl)
    expect(session.url === "automerge:old").toBe(keeps)
    // The earlier one stays in the list, to be read.
    expect(storage.sessions).toEqual(keeps ? ["automerge:old"] : [session.url, "automerge:old"])
  })
})
