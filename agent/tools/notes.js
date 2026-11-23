/**
 * What the agent has learned, kept where the user can find it.
 *
 * A session starts knowing only what the system prompt and skills say. When it
 * works something out the hard way — how a datatype is shaped, why a write
 * failed, what the user prefers — that knowledge used to end with the session.
 * Notes keep it: markdown files in an "Agent notes" folder in the user's own
 * tree, so the user can read, correct or delete anything the agent believes,
 * and every later session starts with an index of them (`notesSection`).
 *
 * They are ordinary files written through fs_write, so a note is a document
 * with history like any other, and editing one writes only what changed.
 */

import { fsDelete, fsWrite, createFolder, contentToText, isFolder } from "./folders.js"
import { truncate } from "./format.js"

export const NOTES_FOLDER_NAME = "Agent notes"
/** Set on the folder document itself, so a renamed folder is still found. */
const MARKER = "agentNotes"
const README = "README.md"
const README_TEXT = `# Agent notes

The agent keeps what it learns here: one markdown file per topic. Every new
session starts with a list of these notes and reads the ones that matter.

They are yours. Correct one that is wrong, delete one you do not want, or write
one yourself — the agent reads them the same way.
`

/** How many notes the prompt lists before saying how many more there are. */
const INDEX_LIMIT = 80

/**
 * Credentials must never be written anywhere the agent can write: everything
 * here is synced. A note is the likeliest place one would end up — "remember
 * this key" — so it is refused outright.
 */
const CREDENTIAL = new RegExp(
  [
    "sk-[A-Za-z0-9_-]{20,}", // OpenAI, Anthropic, OpenRouter
    "gh[pousr]_[A-Za-z0-9]{20,}",
    "github_pat_[A-Za-z0-9_]{20,}",
    "xox[abpr]-[A-Za-z0-9-]{10,}", // Slack
    "AKIA[0-9A-Z]{16}", // AWS
    "AIza[0-9A-Za-z_-]{30,}", // Google
    "-----BEGIN [A-Z ]*PRIVATE KEY-----",
  ].join("|")
)

export function looksLikeCredential(text) {
  return CREDENTIAL.test(String(text ?? ""))
}

/** "Automerge counters!" -> "automerge-counters.md". */
export function noteFileName(name) {
  const base = String(name ?? "")
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!base) throw new Error("Give the note a name: a few words saying what it is about.")
  return `${base}.md`
}

/**
 * The notes folder: by marker, then by name, created when asked to. Null when
 * the account has no root folder (tests, a page outside Patchwork).
 */
export async function notesFolder(ctx, { create = false } = {}) {
  if (ctx.notesFolderUrl) return ctx.notesFolderUrl
  const rootUrl = ctx.rootFolderUrl
  if (!rootUrl || !ctx.repo) return null

  const rootHandle = await ctx.repo.find(rootUrl)
  const root = rootHandle.doc()
  if (!isFolder(root)) return null

  const folders = root.docs.filter((entry) => entry?.type === "folder")
  const byName = folders.find((entry) => entry.name === NOTES_FOLDER_NAME)
  let found = byName?.url ?? null
  if (!found) {
    for (const entry of folders) {
      try {
        if ((await ctx.repo.find(entry.url)).doc()?.[MARKER]) {
          found = entry.url
          break
        }
      } catch {
        /* unreachable entry; not ours */
      }
    }
  }

  if (!found && create) {
    const folder = await createFolder(ctx.repo, NOTES_FOLDER_NAME)
    folder.change((d) => { d[MARKER] = true })
    rootHandle.change((d) => { d.docs.push({ name: NOTES_FOLDER_NAME, type: "folder", url: folder.url }) })
    found = folder.url
    await fsWrite.execute({ root: found, path: README, content: README_TEXT }, ctx)
  }

  if (found) ctx.notesFolderUrl = found
  return found
}

/** Every note: file name, title, first line, url. README excluded. */
export async function listNotes(ctx) {
  const folderUrl = await notesFolder(ctx)
  if (!folderUrl) return { folderUrl: null, notes: [] }
  const folder = (await ctx.repo.find(folderUrl)).doc()
  const notes = []
  for (const entry of folder?.docs ?? []) {
    if (entry.type === "folder" || !/\.md$/i.test(entry.name) || entry.name === README) continue
    let text = ""
    try {
      text = contentToText((await ctx.repo.find(entry.url)).doc()?.content)
    } catch {
      /* unreadable: list it by name */
    }
    const lines = text.split("\n").map((line) => line.trim())
    const heading = lines.find((line) => line.startsWith("# "))
    const firstLine = lines.find((line) => line && !line.startsWith("#")) ?? ""
    notes.push({
      file: entry.name,
      title: heading ? heading.slice(2).trim() : entry.name.replace(/\.md$/i, ""),
      summary: truncate(firstLine, 140),
      url: entry.url,
      text,
    })
  }
  notes.sort((a, b) => a.file.localeCompare(b.file))
  return { folderUrl, notes }
}

/**
 * The part of the system prompt that says what the agent already knows.
 * Null when there is nowhere to keep notes.
 */
export async function notesSection(ctx) {
  const { folderUrl, notes } = await listNotes(ctx)
  if (!ctx.rootFolderUrl) return null

  const lines = [
    "## Your notes",
    "",
    `You keep notes in the user's "${NOTES_FOLDER_NAME}" folder${folderUrl ? ` (${folderUrl})` : ""}, which they can read and edit. They carry what earlier sessions worked out.`,
  ]
  if (!notes.length) {
    lines.push("", "You have none yet.")
  } else {
    lines.push("", "What you know so far:")
    for (const note of notes.slice(0, INDEX_LIMIT)) {
      lines.push(`- ${note.file.replace(/\.md$/i, "")} — ${note.title}${note.summary ? `: ${note.summary}` : ""}`)
    }
    if (notes.length > INDEX_LIMIT) lines.push(`- …and ${notes.length - INDEX_LIMIT} more; note_read with no name lists them all.`)
    lines.push("", "Before you start, note_read any that bear on the task.")
  }
  lines.push(
    "When you work out something non-obvious that will matter again — and especially when you got it wrong first — note_write it before you finish. How to use a package's tools is the exception: that goes in the package's usage guide (guide_write), not a note."
  )
  return lines.join("\n")
}

function findNote(notes, name) {
  const wanted = String(name ?? "").trim().toLowerCase()
  let file = null
  try {
    file = noteFileName(wanted)
  } catch {
    /* empty name */
  }
  return notes.find((note) => note.file === file || note.title.toLowerCase() === wanted) ?? null
}

export const noteWrite = {
  id: "note_write",
  name: "Write a note",
  description: [
    "Keep something you learned, for every later session. Notes are markdown files in the user's \"Agent notes\" folder; each session starts with a list of them.",
    "",
    "Worth keeping: what you could not have known at the start and had to work out — how a datatype or tool is actually shaped, a mistake and what fixed it, how something in this workspace behaves, a preference the user stated. Not worth keeping: a log of what you did, how to use a package's tools (that goes in the package's guide, guide_write), anything already in a skill, anything you could read straight off a document.",
    "",
    "One topic per note. Start with `# Title`, then one line saying what it is — that line is what later sessions see in the list. To add to a note, note_read it and write the whole thing back: only the difference is written. Rather than a second note on the same topic, update the first; if one turns out wrong, fix it or note_delete it.",
    "",
    "Never write a credential, token, password or key into a note. Notes are synced; one that looks like it holds a credential is refused.",
  ].join("\n"),
  where: "worker",
  risk: "edit",
  input_schema: {
    type: "object",
    required: ["name", "content"],
    properties: {
      name: { type: "string", description: "A few words naming the topic, e.g. 'automerge counters'. Becomes the file name." },
      content: { type: "string", description: "The whole note, in markdown, starting with '# Title' and a one-line summary." },
    },
  },
  async execute(input, ctx) {
    if (looksLikeCredential(input.content) || looksLikeCredential(input.name)) {
      throw new Error("That looks like it contains a credential. Notes are synced, so credentials never go in them — leave it out and write the rest.")
    }
    const file = noteFileName(input.name)
    const folderUrl = await notesFolder(ctx, { create: true })
    if (!folderUrl) throw new Error("This account has no root folder, so there is nowhere to keep notes.")
    const content = String(input.content ?? "").trimEnd() + "\n"
    await fsWrite.execute({ root: folderUrl, path: file, content }, ctx)
    return `Saved ${file} in ${NOTES_FOLDER_NAME} (${folderUrl}).`
  },
  summarize(input) {
    return `noted · ${(() => { try { return noteFileName(input?.name) } catch { return "?" } })()}`
  },
}

export const noteRead = {
  id: "note_read",
  name: "Read a note",
  description: "Read one of your notes in full, by the name shown in your notes list. With no name, list every note.",
  where: "worker",
  risk: "read",
  input_schema: {
    type: "object",
    properties: { name: { type: "string", description: "The note's name, as listed. Omit to list them all." } },
  },
  async execute(input, ctx) {
    const { folderUrl, notes } = await listNotes(ctx)
    if (!folderUrl) return "You have no notes yet."
    if (!input.name) {
      if (!notes.length) return `You have no notes yet. They will go in ${folderUrl}.`
      return notes.map((note) => `- ${note.file.replace(/\.md$/i, "")} — ${note.title}${note.summary ? `: ${note.summary}` : ""}`).join("\n")
    }
    const note = findNote(notes, input.name)
    if (!note) {
      const names = notes.map((n) => n.file.replace(/\.md$/i, ""))
      return `No note called '${input.name}'.${names.length ? ` You have: ${names.join(", ")}.` : " You have none yet."}`
    }
    return note.text
  },
  summarize(input, output) {
    return input?.name ? `read note ${input.name}` : `listed notes · ${String(output ?? "").split("\n").filter((l) => l.startsWith("- ")).length}`
  },
}

export const noteDelete = {
  id: "note_delete",
  name: "Delete a note",
  description: "Remove a note that turned out to be wrong or no longer matters. It stays in the folder's history, so this is recoverable.",
  where: "worker",
  risk: "edit",
  input_schema: {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string", description: "The note's name, as listed." } },
  },
  async execute(input, ctx) {
    const { folderUrl, notes } = await listNotes(ctx)
    const note = folderUrl ? findNote(notes, input.name) : null
    if (!note) throw new Error(`No note called '${input.name}'.`)
    await fsDelete.execute({ root: folderUrl, path: note.file }, ctx)
    return `Deleted ${note.file}.`
  },
  summarize(input) {
    return `deleted note ${input?.name ?? ""}`
  },
}

export default [noteWrite, noteRead, noteDelete]
