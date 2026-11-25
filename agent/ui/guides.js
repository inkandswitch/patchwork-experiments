/**
 * Where a person sees the usage guides the agent keeps, and whether each is up
 * to date, in words. A header button opens a short list: each guide's name, its
 * one-line summary and where it stands against its package ("May be out of
 * date: 3 files changed since this guide was checked on 22 Nov"), and a click
 * opens the guide itself, an ordinary document they can correct.
 *
 * The state is worked out when the list is opened, not on every update: it
 * reads the packages.
 */

import { guidesOverview, listGuides } from "../knowledge/guides.js"

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

export function createGuidesButton({ repo, rootFolderUrl, openDoc }) {
  const button = el("button", "agent-guides-link", "Guides")
  button.title = "What the agent has learned about using each package's tools"
  button.hidden = true
  const panel = el("div", "agent-guides-panel")
  panel.hidden = true

  async function load() {
    if (!repo || !rootFolderUrl) return []
    try {
      return await guidesOverview({ repo, rootFolderUrl })
    } catch {
      return []
    }
  }

  function render(rows) {
    panel.replaceChildren()
    if (!rows.length) {
      panel.append(el("div", "agent-guides-empty", "No usage guides yet. The agent writes one the first time it works out how to use a package."))
      return
    }
    for (const row of rows) {
      const item = el("div", `agent-guides-item agent-guides-${row.state}`)
      const name = el("a", "agent-guides-name", row.name)
      name.href = "#"
      name.addEventListener("click", (event) => {
        event.preventDefault()
        openDoc?.(row.url)
      })
      item.append(name)
      if (row.summary) item.append(el("div", "agent-guides-summary", row.summary))
      item.append(el("div", "agent-guides-words", row.words))
      panel.append(item)
    }
  }

  button.addEventListener("click", async () => {
    panel.hidden = !panel.hidden
    if (panel.hidden) return
    panel.replaceChildren(el("div", "agent-guides-empty", "Checking…"))
    render(await load())
  })

  /** Show the button only when there are guides (a cheap read of the folder, no packages). */
  async function refresh() {
    try {
      button.hidden = !(repo && rootFolderUrl) || !(await listGuides({ repo, rootFolderUrl })).guides.length
    } catch {
      button.hidden = true
    }
  }

  return { button, panel, refresh }
}
