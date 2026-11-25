/**
 * The sidebar panel — the agent, attached to whatever you are looking at.
 *
 * Registered as a `patchwork:component` (render signature `(element) =>
 * cleanup`, with no document of its own), it reads the focused document from
 * the selected-doc provider and finds or creates that document's agent
 * session, stored at `doc["@patchwork"].agent`.
 *
 * So every document has its own agent session, for free, and that session is
 * an ordinary document: shareable, resumable, and openable full-window in the
 * same tool.
 */

import { AgentTool } from "./session-view.js"
import { selectedDocUrl } from "../host/context.js"
import { initSession, versionStanding } from "../session/schema.js"
import { hostImport } from "../host/import.js"

/**
 * Find the agent session attached to `docUrl`, creating and linking one the
 * first time. Returns the session's DocHandle.
 */
export async function ensureSession(repo, docUrl) {
  const subject = await repo.find(docUrl)
  const existing = subject.doc()?.["@patchwork"]?.agent
  if (existing) {
    try {
      const session = await repo.find(existing)
      // One from an earlier version of the agent does not run. The document
      // has one session here, so a new one takes its place; the earlier one
      // is still a document, and still in this one's history.
      if (versionStanding(session.doc()) !== "earlier") return session
    } catch {
      // A link to a document we can no longer load: fall through and make a
      // new one rather than leaving the panel permanently broken.
    }
  }

  const session = await repo.create2()
  session.change((doc) => {
    initSession(doc, { title: "Agent", subject: docUrl })
  })

  subject.change((doc) => {
    if (!doc["@patchwork"]) doc["@patchwork"] = {}
    doc["@patchwork"].agent = session.url
  })

  return session
}

export function AgentPanel(element, options = {}) {
  const repo = options.repo ?? globalThis.repo
  const host = document.createElement("div")
  host.style.height = "100%"
  element.append(host)

  let cleanupTool = null
  let currentSubject = null
  let disposed = false
  let generation = 0

  async function attach(url) {
    if (disposed || url === currentSubject) return
    currentSubject = url
    const mine = ++generation

    cleanupTool?.()
    cleanupTool = null
    host.replaceChildren()

    if (!url) {
      const empty = document.createElement("div")
      empty.className = "patchwork-agent"
      const note = document.createElement("div")
      note.className = "agent-empty"
      note.textContent = "Open a document to work on it with the agent."
      empty.append(note)
      host.append(empty)
      return
    }

    try {
      const session = await ensureSession(repo, url)
      // The selection may have moved on while we were creating the session.
      if (disposed || mine !== generation) return

      const { splice } = await hostImport("automerge").catch(() => ({ splice: null }))
      if (disposed || mine !== generation) return

      cleanupTool = AgentTool(session, host, { mode: "panel", repo, subject: url, splice })
    } catch (err) {
      if (disposed || mine !== generation) return
      const failed = document.createElement("div")
      failed.className = "patchwork-agent"
      const note = document.createElement("div")
      note.className = "agent-empty"
      note.textContent = `Could not open an agent session here: ${err?.message ?? err}`
      failed.append(note)
      host.append(failed)
    }
  }

  const unsubscribe = selectedDocUrl(element, (url) => attach(url))

  return () => {
    disposed = true
    unsubscribe()
    cleanupTool?.()
    host.remove()
  }
}

export default AgentPanel
