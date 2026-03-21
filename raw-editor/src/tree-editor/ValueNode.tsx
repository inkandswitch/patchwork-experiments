import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { useEditor } from "./context"
import { toPathString } from "./helpers"
import { EditActionButtons, ConfirmButtons } from "./EditButtons"
import type { TEInput } from "./IsolatedInput"
import type { CollectionKey, CustomRenderer } from "./types"

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

  createEffect(() => {
    if (amEditing()) setDraft(String(props.value ?? ""))
  })

  const canEdit = createMemo(() => {
    if (props.customRenderer && props.customRenderer.showEditTools === false)
      return false
    return (
      typeof props.value !== "function" &&
      !(props.value instanceof Uint8Array)
    )
  })

  const nodeData = createMemo(() => ({
    key: props.key,
    path: props.path,
    level: props.level,
    value: props.value,
    size: null,
    parentData: props.parentData,
  }))

  const startEdit = () => {
    setDraft(String(props.value ?? ""))
    ctx.startEditing({
      pathString,
      path: props.path,
      value: props.value,
      nodeData: nodeData(),
    })
  }

  const confirmEdit = () => {
    let newValue: unknown = draft()
    if (typeof props.value === "number") {
      const n = Number(draft())
      newValue = isNaN(n) ? 0 : n
    } else if (typeof props.value === "boolean") {
      newValue = draft() === "true"
    } else if (props.value === null && draft() === "null") {
      newValue = null
    }
    ctx.onEdit(newValue, props.path)
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

  const showKey = () => {
    if (isArrayChild() && !ctx.showArrayIndices) return false
    return true
  }

  const displayText = createMemo(() => {
    const v = props.value
    if (v === null) return "null"
    if (typeof v === "string")
      return ctx.showStringQuotes ? `"${v}"` : v
    return String(v)
  })

  const valueClass = createMemo(() => {
    const v = props.value
    if (v === null) return "te-value-display te-null"
    switch (typeof v) {
      case "string":
        return "te-value-display te-string"
      case "number":
        return "te-value-display te-number"
      case "boolean":
        return "te-value-display te-boolean"
      default:
        return "te-value-display te-invalid"
    }
  })

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
          {/* View mode content */}
          <Show when={!amEditing()}>
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
          </Show>

          {/* Edit mode input */}
          <Show when={amEditing()}>
            <Show
              when={typeof props.value === "boolean"}
              fallback={
                <te-input
                  ref={(el: TEInput) => {
                    const input = el.input
                    input.value = draft()
                    setTimeout(() => {
                      input.focus()
                      input.select()
                    }, 0)
                    input.addEventListener("input", () =>
                      setDraft(input.value)
                    )
                    input.addEventListener("keydown", (e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        confirmEdit()
                      }
                      if (e.key === "Escape") cancelEdit()
                    })
                  }}
                />
              }
            >
              <span
                class="te-bool-label"
                onClick={() => {
                  setDraft(draft() === "true" ? "false" : "true")
                }}
              >
                {draft() === "true" ? "true" : "false"}
              </span>
            </Show>
          </Show>

          {/* Edit mode OK/Cancel */}
          <Show when={amEditing()}>
            <ConfirmButtons onOk={confirmEdit} onCancel={cancelEdit} />
          </Show>

          {/* View mode action buttons */}
          <Show when={!amEditing()}>
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
