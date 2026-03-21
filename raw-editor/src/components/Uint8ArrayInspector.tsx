import { createMemo, createSignal, For, Show } from "solid-js"

type InspectMode = "hex" | "decimal" | "utf8" | "base64"

const INSPECT_MODES: { key: InspectMode; label: string }[] = [
  { key: "hex", label: "Hex" },
  { key: "decimal", label: "Decimal" },
  { key: "utf8", label: "UTF-8" },
  { key: "base64", label: "Base64" },
]

function renderInspectContent(bytes: Uint8Array, mode: InspectMode): string {
  if (mode === "base64") {
    let binary = ""
    for (let i = 0; i < bytes.length; i++)
      binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  }
  if (mode === "utf8") {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes)
  }
  if (mode === "decimal") {
    const lines = []
    for (let i = 0; i < bytes.length; i += 16) {
      const slice = bytes.slice(i, i + 16)
      lines.push(
        Array.from(slice)
          .map((b) => b.toString().padStart(3, " "))
          .join(" ")
      )
    }
    return lines.join("\n")
  }
  const lines = []
  for (let i = 0; i < bytes.length; i += 16) {
    const slice = bytes.slice(i, i + 16)
    lines.push(
      Array.from(slice)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ")
    )
  }
  return lines.join("\n")
}

export function Uint8ArrayInspector(props: { bytes: Uint8Array }) {
  const [expanded, setExpanded] = createSignal(false)
  const [mode, setMode] = createSignal<InspectMode>("hex")
  const content = createMemo(() => renderInspectContent(props.bytes, mode()))

  return (
    <span class="u8-node">
      <span class="u8-badge">Uint8Array</span>
      <span class="u8-size">{props.bytes.byteLength} bytes</span>
      <span
        class="u8-toggle"
        onClick={(e) => {
          e.stopPropagation()
          setExpanded((v) => !v)
        }}
      >
        {expanded() ? "hide" : "inspect"}
      </span>
      <Show when={expanded()}>
        <span class="u8-dump">
          <span class="u8-mode-bar">
            <For each={INSPECT_MODES}>
              {(m) => (
                <span
                  class={`u8-mode-btn${mode() === m.key ? " u8-mode-btn--active" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setMode(m.key)
                  }}
                >
                  {m.label}
                </span>
              )}
            </For>
          </span>
          <pre class="u8-pre">{content()}</pre>
        </span>
      </Show>
    </span>
  )
}
