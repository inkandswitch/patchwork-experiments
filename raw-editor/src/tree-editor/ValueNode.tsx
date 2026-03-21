import { createSignal, onCleanup, Show } from "solid-js"
import { useEditor } from "./context"
import { toPathString } from "./helpers"
import { EditActionButtons, ConfirmButtons } from "./EditButtons"
import { TypeCards, parseableTypes, coerceDraft, typeOfValue, type ValueType } from "./TypeCards"
import type { TEInput } from "./IsolatedInput"
import type { CollectionKey, CustomRenderer, NodeData } from "./types"

export function ValueNode(props: {
  key: CollectionKey
  value: unknown
  path: CollectionKey[]
  level: number
  parentData: object | null
  customRenderer: CustomRenderer | null
}) {
  const ctx = useEditor()
  const pathString = toPathString(props.path)
  const amEditing = () => ctx.isEditing(pathString)

  const [draft, setDraft] = createSignal("")
  const [selectedType, setSelectedType] = createSignal(typeOfValue(props.value))

  const canEdit = () => {
    if (props.customRenderer && props.customRenderer.showEditTools === false)
      return false
    return (
      typeof props.value !== "function" &&
      !(props.value instanceof Uint8Array)
    )
  }

  const nodeData = (): NodeData => ({
    key: props.key,
    path: props.path,
    level: props.level,
    value: props.value,
    size: null,
    parentData: props.parentData,
  })

  const startEdit = () => {
    setDraft(String(props.value))
    setSelectedType(typeOfValue(props.value))
    ctx.startEditing(pathString)
  }

  const confirmEdit = () => {
    const value = coerceDraft(draft(), selectedType())
    ctx.onEdit(value, props.path)
    ctx.stopEditing()
  }

  const handleCast = (_type: ValueType, defaultValue: unknown) => {
    ctx.onEdit(defaultValue, props.path)
    ctx.stopEditing()
  }

  const cancelEdit = () => ctx.stopEditing()
  const handleDelete = () => ctx.onDelete(props.value, props.path)
  const handleCopy = () => {
    navigator.clipboard.writeText(ctx.jsonStringify(props.value))
  }

  const indent = () =>
    props.parentData !== null ? `${ctx.indent / 2}em` : "0"

  const isArrayChild = () => Array.isArray(props.parentData)

  const showKey = () => !isArrayChild() || ctx.showArrayIndices

  const displayText = () => {
    const v = props.value
    if (v === null) return "null"
    if (typeof v === "string")
      return ctx.showStringQuotes ? `"${v}"` : v
    return String(v)
  }

  const valueClass = () => {
    const v = props.value
    if (v === null) return "te-value-display te-null"
    switch (typeof v) {
      case "string": return "te-value-display te-string"
      case "number": return "te-value-display te-number"
      case "boolean": return "te-value-display te-boolean"
      default: return "te-value-display te-invalid"
    }
  }

  return (
    <div class="te-value" style={{ "margin-left": indent() }}>
      <div class="te-value-row">
        <Show when={showKey()}>
          <span class={isArrayChild() ? "te-key te-key-array" : "te-key"}>
            {props.key}
          </span>
          <span class="te-colon">:</span>
        </Show>

        <div class="te-value-and-buttons">
          <Show
            when={!amEditing()}
            fallback={
              <EditingUI
                draft={draft()}
                setDraft={setDraft}
                selectedType={selectedType()}
                setSelectedType={setSelectedType}
                onConfirm={confirmEdit}
                onCancel={cancelEdit}
                onCast={handleCast}
              />
            }
          >
            <Show
              when={props.customRenderer}
              fallback={
                <span class={valueClass()}>
                  {displayText()}
                </span>
              }
            >
              {(renderer) =>
                renderer().render({ value: props.value, nodeData: nodeData() })
              }
            </Show>

            <EditActionButtons
              canEdit={canEdit()}
              canDelete={true}
              canAdd={false}
              canCopy={ctx.enableClipboard}
              onEdit={canEdit() ? startEdit : undefined}
              onDelete={handleDelete}
              onCopy={handleCopy}
            />
          </Show>
        </div>
      </div>
    </div>
  )
}

function EditingUI(props: {
  draft: string
  setDraft: (v: string) => void
  selectedType: ValueType
  setSelectedType: (t: ValueType) => void
  onConfirm: () => void
  onCancel: () => void
  onCast: (type: ValueType, defaultValue: unknown) => void
}) {
  const [parseable, setParseable] = createSignal<ValueType[]>(
    parseableTypes(props.draft)
  )
  let debounceTimer: ReturnType<typeof setTimeout>
  onCleanup(() => clearTimeout(debounceTimer))

  const onInput = (value: string) => {
    props.setDraft(value)
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      const types = parseableTypes(value)
      setParseable(types)
      if (!types.includes(props.selectedType)) {
        props.setSelectedType(types[0])
      }
    }, 150)
  }

  return (
    <div class="te-editing-row">
      <te-input
        ref={(el: TEInput) => {
          const input = el.input
          input.value = props.draft
          setTimeout(() => {
            input.focus()
            input.select()
          }, 0)
          input.addEventListener("input", () => onInput(input.value))
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              props.onConfirm()
            }
            if (e.key === "Escape") props.onCancel()
          })
        }}
      />

      <TypeCards
        parseable={parseable()}
        selected={props.selectedType}
        onSelect={props.setSelectedType}
        onCast={props.onCast}
      />

      <ConfirmButtons onOk={props.onConfirm} onCancel={props.onCancel} />
    </div>
  )
}
