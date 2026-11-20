/**
 * Attaching things to a message: documents dragged in from the sidebar,
 * files dropped from the computer, images pasted.
 *
 * A dragged document is attached as a link the agent can open; one that is
 * an image is also shown to the model. A dropped file or a pasted image is
 * kept first, as a file document, so what was attached stays reachable after
 * the message is sent — the agent can read it again, the person can open it.
 * Nothing is sent until the message is: the tray holds what is waiting, each
 * with a way to take it back.
 */

import { imageTypeOf, imageForModel, sniffImage } from "../images.js"
import { fileKind } from "../files.js"

const URLS_MIME = "text/x-patchwork-urls"
const DND_MIME = "text/x-patchwork-dnd"

/** Does this drag carry anything the tray takes? */
export function carriesAttachments(dataTransfer) {
  const types = [...(dataTransfer?.types ?? [])]
  return types.includes(DND_MIME) || types.includes(URLS_MIME) || types.includes("Files")
}

/**
 * What a drop holds: Patchwork documents (the rich payload first, then the
 * plain list of URLs) and files from the computer.
 *
 *   { docs: [{ url, name, type }], files: [File] }
 */
export function readDrop(dataTransfer) {
  const docs = []
  const add = (item) => {
    if (typeof item?.url === "string" && item.url.startsWith("automerge:") && !docs.some((d) => d.url === item.url)) {
      docs.push({ url: item.url, name: item.name ?? null, type: item.type ?? null })
    }
  }
  try {
    const rich = JSON.parse(dataTransfer.getData(DND_MIME) || "null")
    for (const item of rich?.items ?? []) add(item)
  } catch {
    /* not this kind of drag */
  }
  if (!docs.length) {
    try {
      const urls = JSON.parse(dataTransfer.getData(URLS_MIME) || "null")
      if (Array.isArray(urls)) for (const url of urls) add({ url })
    } catch {
      /* not this kind either */
    }
  }
  const files = docs.length ? [] : [...(dataTransfer.files ?? [])]
  return { docs, files }
}

/** The images in a paste. */
export function pastedImages(clipboardData) {
  return [...(clipboardData?.items ?? [])].filter((item) => item.kind === "file" && item.type.startsWith("image/")).map((item) => item.getAsFile()).filter(Boolean)
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

/** Keep a file from the computer as a file document; returns its URL and what it is. */
async function keepFile(repo, file) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const name = file.name || `pasted-${Date.now()}.${(file.type.split("/")[1] || "png").replace("jpeg", "jpg")}`
  const extension = name.includes(".") ? name.split(".").pop().toLowerCase() : ""
  const mimeType = file.type || sniffImage(bytes) || "application/octet-stream"
  // Text is kept as text, as Patchwork's own files keep it, so it reads and
  // edits as a file; everything else as its bytes.
  const kind = fileKind({ name, extension, mimeType, content: bytes })
  const handle = await repo.create2()
  handle.change((d) => {
    d["@patchwork"] = { type: "file" }
    d.name = name
    d.extension = extension
    d.mimeType = mimeType
    d.content = kind?.kind === "text" ? kind.text : bytes
  })
  return { url: handle.url, name, bytes, mimeType }
}

/**
 * The tray of what is waiting to be sent with the next message.
 *
 *   element       to place above the composer's text box
 *   addDrop(dt)   take what a drop holds
 *   addFiles([])  take files (a paste)
 *   take()        what to send, emptying the tray: attachmentBlock inputs
 *   size()        how many are waiting
 */
export function attachmentTray({ repo, onChange = () => {} }) {
  const element = el("div", "agent-attachments")
  element.hidden = true
  /** { key, attachment, preview, pending } */
  let items = []

  function render() {
    element.replaceChildren()
    element.hidden = !items.length
    for (const item of items) {
      const chip = el("span", "agent-attachment-chip")
      if (item.preview) {
        const thumb = el("img", "agent-attachment-thumb")
        thumb.src = item.preview
        thumb.alt = ""
        chip.append(thumb)
      }
      chip.append(el("span", "agent-attachment-name", item.pending ? `${item.label}…` : item.label))
      const remove = el("button", "agent-attachment-remove", "×")
      remove.type = "button"
      remove.title = `Don't attach ${item.label}`
      remove.addEventListener("click", (event) => {
        event.preventDefault()
        items = items.filter((x) => x !== item)
        render()
        onChange()
      })
      chip.append(remove)
      element.append(chip)
    }
  }

  function track(label, work) {
    const item = { label, attachment: null, preview: null, pending: true }
    items.push(item)
    render()
    onChange()
    work
      .then(({ attachment, preview }) => {
        Object.assign(item, { attachment, preview, pending: false, label: attachment.name ?? label })
      })
      .catch(() => {
        items = items.filter((x) => x !== item)
      })
      .finally(() => {
        render()
        onChange()
      })
  }

  async function fromDoc({ url, name, type }) {
    let doc = null
    try {
      doc = (await repo.find(url)).doc()
    } catch {
      doc = null
    }
    const title = name ?? doc?.name ?? doc?.title ?? url.replace(/^automerge:/, "").slice(0, 8)
    const docType = type ?? doc?.["@patchwork"]?.type ?? null
    const imageType = imageTypeOf(doc)
    const shown = imageType ? await imageForModel(doc.content, imageType) : null
    return { attachment: { url, name: title, docType, mimeType: imageType ?? doc?.mimeType ?? null, image: shown?.url ?? null }, preview: shown?.url ?? null }
  }

  async function fromFile(file) {
    const kept = await keepFile(repo, file)
    const imageType = sniffImage(kept.bytes) ?? (kept.mimeType.startsWith("image/") ? kept.mimeType : null)
    const shown = imageType ? await imageForModel(kept.bytes, imageType) : null
    return { attachment: { url: kept.url, name: kept.name, docType: "file", mimeType: kept.mimeType, image: shown?.url ?? null, kept: true }, preview: shown?.url ?? null }
  }

  return {
    element,
    addDrop(dataTransfer) {
      const { docs, files } = readDrop(dataTransfer)
      for (const doc of docs) if (!items.some((x) => x.attachment?.url === doc.url)) track(doc.name ?? "document", fromDoc(doc))
      for (const file of files) track(file.name || "file", fromFile(file))
      return docs.length + files.length
    },
    addFiles(files) {
      for (const file of files) track(file.name || "pasted image", fromFile(file))
      return files.length
    },
    size: () => items.length,
    pending: () => items.some((x) => x.pending),
    take() {
      const ready = items.filter((x) => !x.pending && x.attachment).map((x) => x.attachment)
      items = items.filter((x) => x.pending)
      render()
      return ready
    },
  }
}
