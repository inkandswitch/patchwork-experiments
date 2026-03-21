import { createSignal, For, onCleanup, onMount, Show } from "solid-js"

export type ValueType = "null" | "boolean" | "number" | "array" | "object" | "string"

const ALL_TYPES: ValueType[] = ["null", "boolean", "number", "array", "object", "string"]

const DEFAULT_VALUES: Record<ValueType, unknown> = {
  null: null,
  boolean: false,
  number: 0,
  array: [],
  object: {},
  string: "",
}

export function typeOfValue(value: unknown): ValueType {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  switch (typeof value) {
    case "boolean": return "boolean"
    case "number": return "number"
    case "string": return "string"
    case "object": return "object"
    default: return "string"
  }
}

export function parseableTypes(draft: string): ValueType[] {
  const trimmed = draft.trim()
  const lower = trimmed.toLowerCase()
  const types: ValueType[] = []

  if (lower === "null") types.push("null")
  if (lower === "true" || lower === "false") types.push("boolean")
  if (trimmed !== "" && isFinite(Number(trimmed))) types.push("number")

  if (trimmed.length > 0 && (trimmed[0] === "[" || trimmed[0] === "{")) {
    try {
      const v = JSON.parse(trimmed)
      if (Array.isArray(v)) types.push("array")
      else if (v !== null && typeof v === "object") types.push("object")
    } catch {}
  }

  types.push("string")
  return types
}

export function coerceDraft(draft: string, type: ValueType): unknown {
  switch (type) {
    case "null": return null
    case "boolean": return draft.trim().toLowerCase() === "true"
    case "number": {
      const n = Number(draft.trim())
      return Number.isFinite(n) ? n : 0
    }
    case "array":
    case "object":
      try { return JSON.parse(draft.trim()) } catch { return DEFAULT_VALUES[type] }
    case "string": return draft
  }
}

export function TypeCards(props: {
  parseable: ValueType[]
  selected: ValueType
  onSelect: (type: ValueType) => void
  onCast: (type: ValueType, defaultValue: unknown) => void
}) {
  const [dropdownOpen, setDropdownOpen] = createSignal(false)
  let containerRef!: HTMLSpanElement

  const unparseable = () => ALL_TYPES.filter((t) => !props.parseable.includes(t))

  const closeDropdown = (e: MouseEvent) => {
    if (dropdownOpen() && containerRef && !containerRef.contains(e.target as Node)) {
      setDropdownOpen(false)
    }
  }

  onMount(() => document.addEventListener("click", closeDropdown, true))
  onCleanup(() => document.removeEventListener("click", closeDropdown, true))

  return (
    <span class="te-segmented" ref={containerRef}>
      <For each={props.parseable}>
        {(type) => (
          <span
            class={`te-seg${type === props.selected ? " te-seg-active" : ""}`}
            title={`Parse as ${type}`}
            onClick={(e) => {
              e.stopPropagation()
              setDropdownOpen(false)
              props.onSelect(type)
            }}
          >
            {type}
          </span>
        )}
      </For>

      <Show when={unparseable().length > 0}>
        <span
          class={`te-seg te-seg-more${dropdownOpen() ? " te-seg-active" : ""}`}
          title="Cast to another type"
          onClick={(e) => {
            e.stopPropagation()
            setDropdownOpen((v) => !v)
          }}
        >
          ▾
        </span>
      </Show>

      <Show when={dropdownOpen()}>
        <div class="te-seg-dropdown">
          <For each={unparseable()}>
            {(type) => (
              <span
                class="te-seg-dropdown-item"
                title={`Cast to ${type}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setDropdownOpen(false)
                  props.onCast(type, DEFAULT_VALUES[type])
                }}
              >
                {type}
              </span>
            )}
          </For>
        </div>
      </Show>
    </span>
  )
}
