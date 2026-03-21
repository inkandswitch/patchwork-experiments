import { createSignal, For, onCleanup, onMount, Show } from "solid-js"

const STORAGE_KEY = "raw-editor:font"

const FONT_OPTIONS = [
  { id: "system", label: "System", family: "ui-monospace, monospace", google: null },
  { id: "ibm-plex-mono", label: "IBM Plex Mono", family: "'IBM Plex Mono', ui-monospace, monospace", google: "IBM+Plex+Mono:wght@400;500;600" },
  { id: "jetbrains-mono", label: "JetBrains Mono", family: "'JetBrains Mono', ui-monospace, monospace", google: "JetBrains+Mono:wght@400;500;600" },
  { id: "source-code-pro", label: "Source Code Pro", family: "'Source Code Pro', ui-monospace, monospace", google: "Source+Code+Pro:wght@400;500;600" },
  { id: "fira-code", label: "Fira Code", family: "'Fira Code', ui-monospace, monospace", google: "Fira+Code:wght@400;500;600" },
  { id: "inconsolata", label: "Inconsolata", family: "'Inconsolata', ui-monospace, monospace", google: "Inconsolata:wght@400;500;600" },
  { id: "dm-mono", label: "DM Mono", family: "'DM Mono', ui-monospace, monospace", google: "DM+Mono:wght@400;500" },
] as const

type FontId = typeof FONT_OPTIONS[number]["id"]

function loadGoogleFont(googleParam: string) {
  const id = `re-font-${googleParam.split(":")[0]}`
  if (document.getElementById(id)) return
  const link = document.createElement("link")
  link.id = id
  link.rel = "stylesheet"
  link.href = `https://fonts.googleapis.com/css2?family=${googleParam}&display=swap`
  document.head.appendChild(link)
}

function getSavedFont(): FontId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && FONT_OPTIONS.some((f) => f.id === saved)) return saved as FontId
  } catch {}
  return "system"
}

function saveFont(id: FontId) {
  try { localStorage.setItem(STORAGE_KEY, id) } catch {}
}

export function createFontState() {
  const initial = getSavedFont()
  const [fontId, setFontId] = createSignal<FontId>(initial)

  const opt = FONT_OPTIONS.find((f) => f.id === initial)!
  if (opt.google) loadGoogleFont(opt.google)

  const fontFamily = () => {
    const o = FONT_OPTIONS.find((f) => f.id === fontId())
    return o?.family ?? FONT_OPTIONS[0].family
  }

  const selectFont = (id: FontId) => {
    const opt = FONT_OPTIONS.find((f) => f.id === id)
    if (!opt) return
    if (opt.google) loadGoogleFont(opt.google)
    setFontId(id)
    saveFont(id)
  }

  return { fontId, fontFamily, selectFont }
}

export function FontPicker(props: {
  fontId: () => FontId
  onSelect: (id: FontId) => void
}) {
  const [open, setOpen] = createSignal(false)
  let containerRef!: HTMLSpanElement

  const close = (e: MouseEvent) => {
    if (open() && containerRef && !containerRef.contains(e.target as Node)) {
      setOpen(false)
    }
  }

  onMount(() => document.addEventListener("click", close, true))
  onCleanup(() => document.removeEventListener("click", close, true))

  return (
    <span class="re-font-picker" ref={containerRef}>
      <span
        class="re-font-trigger"
        title="Change font"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        Aa
      </span>
      <Show when={open()}>
        <div class="re-font-dropdown">
          <For each={FONT_OPTIONS as unknown as typeof FONT_OPTIONS[number][]}>
            {(opt) => (
              <span
                class={`re-font-option${props.fontId() === opt.id ? " re-font-option--active" : ""}`}
                style={{ "font-family": opt.family }}
                onClick={(e) => {
                  e.stopPropagation()
                  props.onSelect(opt.id)
                  setOpen(false)
                }}
              >
                {opt.label}
              </span>
            )}
          </For>
        </div>
      </Show>
    </span>
  )
}
