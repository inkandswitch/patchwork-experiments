import { describe, it, expect } from "vitest"
import { sessionTitleTool } from "./tools/naming.js"
import { AgentSessionDatatype } from "./datatype.js"
import {
  initSession,
  sessionTitle,
  derivedTitle,
  cleanTitle,
  needsApproval,
  makeTurn,
  textBlock,
  MAX_TITLE,
} from "./session.js"
import { BUILTIN_TOOLS } from "./tools/index.js"
import { describeCall } from "./ui/calls.js"

function fresh(turns = []) {
  const doc = {}
  initSession(doc)
  doc.turns = turns
  return doc
}

const asked = (text) => [makeTurn("user", [textBlock(text)])]

/** A repo double holding one session document. */
function repoWith(doc, url = "automerge:session") {
  return {
    docs: new Map([[url, doc]]),
    async find(u) {
      const found = this.docs.get(u)
      if (!found) throw new Error(`no such document ${u}`)
      return { url: u, doc: () => found, change: (fn) => fn(found) }
    },
  }
}

describe("what a session is called", () => {
  it("starts with no title at all, rather than a placeholder", () => {
    // The bug this replaces: init set the title to "Agent", so `doc.title` was
    // always truthy, the fallback below was unreachable dead code, and every
    // session in the user's document list was called "Agent".
    expect(fresh().title).toBeNull()
  })

  it("is named by what was first asked, until it names itself", () => {
    const doc = fresh(asked("Build me a tally counter tool"))
    expect(sessionTitle(doc)).toBe("Build me a tally counter tool")
    expect(AgentSessionDatatype.getTitle(doc)).toBe("Build me a tally counter tool")
  })

  it("prefers what the agent called it", () => {
    const doc = fresh(asked("have a look at why the folder thing is slow"))
    doc.title = "Folder view performance"
    expect(sessionTitle(doc)).toBe("Folder view performance")
  })

  it("falls back to Agent only when there is genuinely nothing", () => {
    expect(AgentSessionDatatype.getTitle(fresh())).toBe("Agent")
    expect(sessionTitle(fresh())).toBeNull()
  })

  it("ignores an assistant turn when deriving a name", () => {
    const doc = fresh([makeTurn("assistant", [textBlock("Certainly!")]), ...asked("do the thing")])
    expect(derivedTitle(doc)).toBe("do the thing")
  })

  it("survives a session with no turns key at all", () => {
    expect(() => sessionTitle({})).not.toThrow()
    expect(sessionTitle(undefined)).toBeNull()
  })
})

describe("tidying a title", () => {
  it("collapses whitespace and trims", () => {
    expect(cleanTitle("  Tally   counter \n tool ")).toBe("Tally counter tool")
  })

  it("strips the quotes a model puts round a title", () => {
    expect(cleanTitle('"Tally counter"')).toBe("Tally counter")
    expect(cleanTitle("“Tally counter”")).toBe("Tally counter")
  })

  it("caps it, because this lives in a document list", () => {
    const long = cleanTitle("x".repeat(200))
    expect(long.length).toBe(MAX_TITLE)
    expect(long.endsWith("…")).toBe(true)
  })

  it("does not leave a trailing space before the ellipsis", () => {
    const title = cleanTitle(`${"word ".repeat(30)}`)
    expect(title).not.toContain(" …")
  })

  it("treats empty and whitespace as no title", () => {
    expect(cleanTitle("")).toBeNull()
    expect(cleanTitle("   ")).toBeNull()
    expect(cleanTitle(null)).toBeNull()
  })
})

describe("the agent naming its own work", () => {
  const ctx = (doc) => ({ repo: repoWith(doc), sessionUrl: "automerge:session" })

  it("writes the title onto the session document", async () => {
    const doc = fresh(asked("do a thing"))
    const out = await sessionTitleTool.execute({ title: "Tally counter tool" }, ctx(doc))

    expect(doc.title).toBe("Tally counter tool")
    expect(out).toBe("Named this session 'Tally counter tool'.")
  })

  it("renames, and says what it renamed from", async () => {
    const doc = fresh()
    doc.title = "First guess"
    const out = await sessionTitleTool.execute({ title: "What it turned out to be" }, ctx(doc))
    expect(out).toBe("Renamed from 'First guess' to 'What it turned out to be'.")
    expect(doc.title).toBe("What it turned out to be")
  })

  it("does not write when nothing would change", async () => {
    const doc = fresh()
    doc.title = "Same"
    let changes = 0
    const repo = repoWith(doc)
    const original = repo.find.bind(repo)
    repo.find = async (u) => {
      const handle = await original(u)
      return { ...handle, change: (fn) => { changes++; fn(doc) } }
    }
    const out = await sessionTitleTool.execute({ title: "Same" }, { repo, sessionUrl: "automerge:session" })
    expect(out).toBe("Already called 'Same'.")
    expect(changes).toBe(0)
  })

  it("tidies what it is given", async () => {
    const doc = fresh()
    await sessionTitleTool.execute({ title: '  "Import the 2024 invoices"  ' }, ctx(doc))
    expect(doc.title).toBe("Import the 2024 invoices")
  })

  it("refuses an empty title rather than clearing the name", async () => {
    const doc = fresh()
    doc.title = "Something"
    await expect(sessionTitleTool.execute({ title: "   " }, ctx(doc))).rejects.toThrow(/something in it/)
    expect(doc.title).toBe("Something")
  })

  it("says so plainly when the runner cannot reach the session", async () => {
    await expect(sessionTitleTool.execute({ title: "x" }, { repo: repoWith(fresh()) })).rejects.toThrow(
      /cannot reach the session document/
    )
  })

  it("runs without asking, because it touches nothing but this conversation", () => {
    // Its own risk level rather than claiming to be a reader: it does write,
    // and a tool list that says otherwise is lying to whoever audits it.
    expect(sessionTitleTool.risk).toBe("self")
    expect(needsApproval(fresh(), sessionTitleTool, { input: { title: "x" } })).toBe(false)
    expect(sessionTitleTool.alwaysAsk).toBeUndefined()
  })

  it("is the only tool allowed to skip approval by writing", () => {
    // If a second tool ever claims "self", it had better also write nothing but
    // the session document — so make adding one a deliberate act.
    const selfWriters = BUILTIN_TOOLS.filter((t) => t.risk === "self").map((t) => t.id)
    expect(selfWriters).toEqual(["session_title"])
  })

  it("reads as naming something in the log", () => {
    const row = describeCall({ tool: "session_title", input: { title: "Tally counter tool" }, status: "done" }, null)
    expect(row.verb).toBe("name")
    expect(row.detail).toBe("Tally counter tool")
  })
})
