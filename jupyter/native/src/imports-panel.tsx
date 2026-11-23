import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { importName, importsOf, nameProblem, type NotebookImport, runOf, type RunRecord, titleOf } from "../../shared/imports"
import type { FindDoc } from "../../shared/run"
import type { NotebookStore } from "./doc"

/**
 * The notebook's linked documents and its last run, for people: each import
 * by its module name and its document's title (open it, rename it, remove
 * it), and what the last run read, by name and version, with what has
 * changed since. Documents dropped anywhere on the notebook are imported.
 */

const DND_MIME = "text/x-patchwork-dnd"
const URLS_MIME = "text/x-patchwork-urls"

export type DropItem = { url: string; name?: string }

export function hasPatchworkDrop(dt: DataTransfer | null): boolean {
  return !!dt?.types?.includes(DND_MIME) || !!dt?.types?.includes(URLS_MIME)
}

/** Documents dragged from Patchwork's sidebar (or anything that drags the same way). */
export function parsePatchworkDrop(dt: DataTransfer): DropItem[] {
  const out: DropItem[] = []
  try {
    const parsed = JSON.parse(dt.getData(DND_MIME) || "null")
    const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : parsed ? [parsed] : []
    for (const item of items) if (item?.url) out.push({ url: String(item.url), name: item.name })
  } catch {}
  if (!out.length) {
    try {
      const urls = JSON.parse(dt.getData(URLS_MIME) || "[]")
      if (Array.isArray(urls)) for (const url of urls) if (url) out.push({ url: String(url) })
    } catch {}
  }
  return out
}

/** The imports with `items` added: each document once, named from its title. */
export function withDropped(imports: NotebookImport[], items: DropItem[], self?: string): NotebookImport[] {
  const out = [...imports]
  for (const item of items) {
    const docUrl = item.url.split("#")[0]
    if (docUrl === self || out.some(i => i.docUrl === docUrl)) continue
    out.push({ name: importName(item.name, out.map(i => i.name)), docUrl })
  }
  return out
}

type Live = { title: string; heads: string[]; type: string | null; missing?: boolean }

const KIND: Record<string, string> = {
  hook: "Python from its datatype",
  "py-file": "Python file",
  notebook: "notebook's code",
  json: "data, as `data`",
  missing: "couldn't be opened",
}

const short = (heads: readonly string[]) => (heads.length ? heads.map(h => h.slice(0, 7)).join("+") : "")
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((h, i) => h === [...b].sort()[i])

function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return ""
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 45) return "just now"
  if (s < 90) return "a minute ago"
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(iso).toLocaleString()
}

export function ImportsPanel(props: {
  store: NotebookStore
  find: FindDoc
  readOnly: () => boolean
  url: string
  open(url: string, title?: string): void
  dragging: () => boolean
  running: () => boolean
}) {
  const imports = createMemo(() => importsOf(props.store.doc()), [], { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) })
  const run = createMemo(() => runOf(props.store.doc()), null, { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) })
  const [live, setLive] = createSignal<Map<string, Live>>(new Map(), { equals: false })
  const [now, setNow] = createSignal(Date.now())
  const tick = setInterval(() => setNow(Date.now()), 30_000)
  onCleanup(() => clearInterval(tick))

  // Every document an import or the last run names, opened once and watched, for titles and versions.
  const watched = new Map<string, () => void>()
  const watch = (url: string) => {
    if (watched.has(url)) return
    let stop = () => {}
    let stopped = false
    watched.set(url, () => {
      stopped = true
      stop()
    })
    props
      .find(url)
      .then(handle => {
        if (stopped) return
        const update = () => {
          const doc = handle.doc()
          live().set(url, { title: titleOf(doc), heads: [...(handle.heads?.() ?? [])], type: doc?.["@patchwork"]?.type ?? null })
          setLive(live())
        }
        const h = handle as unknown as { on?(e: string, f: () => void): void; off?(e: string, f: () => void): void }
        h.on?.("change", update)
        stop = () => h.off?.("change", update)
        update()
      })
      .catch(() => {
        if (stopped) return
        live().set(url, { title: "", heads: [], type: null, missing: true })
        setLive(live())
      })
  }
  createEffect(() => {
    const urls = new Set([...imports().map(i => i.docUrl), ...(run()?.imports ?? []).map(i => i.docUrl)])
    for (const url of urls) watch(url)
    for (const [url, stop] of watched) {
      if (urls.has(url)) continue
      stop()
      watched.delete(url)
    }
  })
  onCleanup(() => watched.forEach(stop => stop()))

  const titleFor = (url: string, fallback = "") => live().get(url)?.title || fallback || "…"
  const write = (next: NotebookImport[]) => props.store.setPatchworkMetadata({ imports: next })
  const remove = (name: string) => write(imports().filter(i => i.name !== name))

  const [renaming, setRenaming] = createSignal<string | null>(null)
  const [problem, setProblem] = createSignal<string | null>(null)
  const rename = (from: string, to: string) => {
    to = to.trim()
    setRenaming(null)
    if (!to || to === from) return setProblem(null)
    const others = imports().filter(i => i.name !== from).map(i => i.name)
    const why = nameProblem(to, others)
    if (why) return setProblem(why)
    setProblem(null)
    write(imports().map(i => (i.name === from ? { ...i, name: to } : i)))
  }

  const ranAs = (url: string) => run()?.imports.find(i => i.docUrl === url)?.as
  const statusText = (r: RunRecord) =>
    r.status === "running" ? "running" : r.status === "ok" ? "ok" : r.status === "error" ? (r.problem ? `didn't run: ${r.problem}` : "a cell failed") : "stopped"

  return (
    <div class="pwnb-links" classList={{ "pwnb-links-dragging": props.dragging() }}>
      <div class="pwnb-imports" aria-label="Imports">
        <span class="pwnb-links-label" title="Documents this notebook imports as Python modules. Each run reads them as they are then.">
          Imports
        </span>
        <For each={imports()}>
          {imp => (
            <span class="pwnb-import" data-import={imp.name}>
              <Show
                when={renaming() === imp.name}
                fallback={
                  <button
                    type="button"
                    class="pwnb-import-name"
                    disabled={props.readOnly()}
                    title={`import ${imp.name}  (click to rename)`}
                    onClick={() => setRenaming(imp.name)}
                  >
                    {imp.name}
                  </button>
                }
              >
                <input
                  class="pwnb-import-rename"
                  value={imp.name}
                  ref={el => queueMicrotask(() => el.select())}
                  onKeyDown={e => {
                    e.stopPropagation()
                    if (e.key === "Enter") rename(imp.name, e.currentTarget.value)
                    if (e.key === "Escape") setRenaming(null)
                  }}
                  onBlur={e => rename(imp.name, e.currentTarget.value)}
                />
              </Show>
              <a
                class="pwnb-import-title"
                href={imp.docUrl}
                title={`Open ${titleFor(imp.docUrl)}`}
                onClick={e => {
                  e.preventDefault()
                  props.open(imp.docUrl, live().get(imp.docUrl)?.title)
                }}
              >
                {live().get(imp.docUrl)?.missing ? "unavailable" : titleFor(imp.docUrl)}
              </a>
              <Show when={ranAs(imp.docUrl)}>{as => <span class="pwnb-import-kind">{KIND[as()]}</span>}</Show>
              <Show when={!props.readOnly()}>
                <button type="button" class="pwnb-import-remove" title={`Remove the import ${imp.name}`} aria-label={`Remove the import ${imp.name}`} onClick={() => remove(imp.name)}>
                  ×
                </button>
              </Show>
            </span>
          )}
        </For>
        <Show when={!props.readOnly()}>
          <span class="pwnb-links-hint">{imports().length ? "Drop a document to import it" : "Drop a document here to import it from Python"}</span>
        </Show>
        <Show when={problem()}>{why => <span class="pwnb-links-problem">Can't rename: {why()}</span>}</Show>
      </div>
      <Show when={run()}>
        {r => (
          <div class="pwnb-run" aria-label="Last run" data-status={r().status}>
            <span class="pwnb-links-label">Last run</span>
            <span>
              {ago(r().at, now())} by {r().by === "agent" ? "the agent" : "a person"} · {r().cells.length} cell{r().cells.length === 1 ? "" : "s"} ·{" "}
              {r().kernel === "fresh" ? "fresh kernel" : "same kernel"} · <span class="pwnb-run-status">{props.running() && r().status === "running" ? "running…" : statusText(r())}</span>
            </span>
            <Show when={r().imports.length}>
              <span>
                read{" "}
                <For each={r().imports}>
                  {(i, n) => {
                    const changed = () => {
                      const now = live().get(i.docUrl)
                      return !!now && !now.missing && i.heads.length > 0 && !same(now.heads, i.heads)
                    }
                    return (
                      <>
                        {n() > 0 ? ", " : ""}
                        <a
                          href={i.docUrl}
                          class="pwnb-run-import"
                          title={`${i.name}: ${KIND[i.as]}${i.heads.length ? `, at version ${short(i.heads)}` : ""}`}
                          onClick={e => {
                            e.preventDefault()
                            props.open(i.docUrl, i.title)
                          }}
                        >
                          {i.title}
                        </a>
                        <Show when={i.heads.length}>
                          <span class="pwnb-run-version"> at {short(i.heads)}</span>
                        </Show>
                        <Show when={i.as === "missing"}>
                          <span class="pwnb-run-changed"> (couldn't be opened)</span>
                        </Show>
                        <Show when={changed()}>
                          <span class="pwnb-run-changed"> (changed since)</span>
                        </Show>
                      </>
                    )
                  }}
                </For>
              </span>
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}

/**
 * Accepts Patchwork documents dropped anywhere on `root`, before the cell
 * editors see them (they would paste the URL as text). Returns a cleanup.
 */
export function acceptDrops(root: HTMLElement, opts: { enabled: () => boolean; onDrop(items: DropItem[]): void; onDragging(on: boolean): void }): () => void {
  let depth = 0
  const over = (e: DragEvent) => {
    if (!opts.enabled() || !hasPatchworkDrop(e.dataTransfer)) return
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = "link"
  }
  const enter = (e: DragEvent) => {
    if (!opts.enabled() || !hasPatchworkDrop(e.dataTransfer)) return
    depth++
    opts.onDragging(true)
  }
  const leave = (e: DragEvent) => {
    if (!hasPatchworkDrop(e.dataTransfer)) return
    depth = Math.max(0, depth - 1)
    if (!depth) opts.onDragging(false)
  }
  const drop = (e: DragEvent) => {
    if (!opts.enabled() || !e.dataTransfer || !hasPatchworkDrop(e.dataTransfer)) return
    e.preventDefault()
    e.stopPropagation()
    depth = 0
    opts.onDragging(false)
    opts.onDrop(parsePatchworkDrop(e.dataTransfer))
  }
  root.addEventListener("dragenter", enter, true)
  root.addEventListener("dragover", over, true)
  root.addEventListener("dragleave", leave, true)
  root.addEventListener("drop", drop, true)
  return () => {
    root.removeEventListener("dragenter", enter, true)
    root.removeEventListener("dragover", over, true)
    root.removeEventListener("dragleave", leave, true)
    root.removeEventListener("drop", drop, true)
  }
}
