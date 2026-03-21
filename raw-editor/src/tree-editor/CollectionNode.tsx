import { createMemo, createSignal, For, Show } from "solid-js"
import { useEditor } from "./context"
import { isCollection, toPathString } from "./helpers"
import { ValueNode } from "./ValueNode"
import { EditActionButtons, ConfirmButtons } from "./EditButtons"
import { ChevronIcon } from "./Icons"
import type { TEInput, TETextarea } from "./IsolatedInput"
import type { CollectionKey, CustomRenderer } from "./types"

export function CollectionNode(props: {
  key: CollectionKey
  value: Record<string, unknown> | unknown[]
  path: CollectionKey[]
  level: number
  parentData: object | null
}) {
  const ctx = useEditor()
  const pathString = toPathString(props.path)

  const isArray = createMemo(() => Array.isArray(props.value))
  const keys = createMemo(() => Object.keys(props.value))
  const size = createMemo(() => keys().length)

  const [collapsed, setCollapsed] = createSignal(
    ctx.collapse({
      key: props.key,
      path: props.path,
      level: props.level,
      value: props.value,
      size: size(),
      parentData: props.parentData,
    })
  )

  const amEditing = () => ctx.isEditing(pathString)
  const [draft, setDraft] = createSignal("")
  const [addingKey, setAddingKey] = createSignal(false)
  const [newKey, setNewKey] = createSignal("")

  const showCount = createMemo(() => {
    if (ctx.showCollectionCount === "when-closed") return collapsed()
    return ctx.showCollectionCount
  })

  const startEdit = () => {
    setDraft(ctx.jsonStringify(props.value))
    ctx.startEditing(pathString)
  }

  const confirmEdit = () => {
    try {
      const parsed = JSON.parse(draft())
      ctx.onEdit(parsed, props.path)
      ctx.stopEditing()
    } catch {
      // invalid JSON — ignore
    }
  }

  const cancelEdit = () => ctx.stopEditing()

  const handleAdd = () => {
    if (isArray()) {
      const arr = props.value as unknown[]
      ctx.onAdd(null, [...props.path, arr.length])
    } else {
      setNewKey("")
      setAddingKey(true)
      setCollapsed(false)
    }
  }

  const confirmAddKey = () => {
    const key = newKey().trim()
    if (key === "") return
    if (key in (props.value as Record<string, unknown>)) return
    ctx.onAdd(null, [...props.path, key])
    setAddingKey(false)
  }

  const cancelAddKey = () => setAddingKey(false)

  const handleDelete = () => {
    if (props.path.length > 0) ctx.onDelete(props.value, props.path)
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(ctx.jsonStringify(props.value))
  }

  const brackets = createMemo(() =>
    isArray() ? { open: "[", close: "]" } : { open: "{", close: "}" }
  )

  const indent = () => (props.level > 0 ? `${ctx.indent / 2}em` : "0")

  const isArrayChild = () =>
    props.parentData !== null && Array.isArray(props.parentData)

  const showKey = () => {
    if (props.path.length === 0) return false
    if (isArrayChild() && !ctx.showArrayIndices) return false
    return true
  }

  return (
    <div class="te-collection" style={{ "margin-left": indent() }}>
      <div class="te-collection-header">
        <span
          class="te-chevron"
          onClick={(e) => {
            e.stopPropagation()
            setCollapsed((c) => !c)
          }}
        >
          <ChevronIcon collapsed={collapsed()} />
        </span>

        <Show when={showKey()}>
          <span class={isArrayChild() ? "te-key te-key-array" : "te-key"}>
            {props.key}
          </span>
          <span class="te-colon">:</span>
        </Show>

        <Show when={!amEditing()}>
          <span class="te-bracket">{brackets().open}</span>
        </Show>

        <Show when={showCount() && !amEditing()}>
          <span class="te-item-count">
            {size()} {size() === 1 ? "item" : "items"}
          </span>
        </Show>

        <Show when={collapsed() && !amEditing()}>
          <span class="te-bracket">{brackets().close}</span>
        </Show>

        <Show when={!amEditing()}>
          <EditActionButtons
            canEdit={true}
            canDelete={props.path.length > 0}
            canAdd={true}
            canCopy={ctx.enableClipboard}
            onEdit={startEdit}
            onDelete={handleDelete}
            onAdd={handleAdd}
            onCopy={handleCopy}
          />
        </Show>
      </div>

      <Show when={!collapsed()}>
        <Show when={amEditing()}>
          <div class="te-collection-edit">
            <te-textarea
              ref={(el: TETextarea) => {
                const ta = el.textarea
                ta.value = draft()
                setTimeout(() => ta.focus(), 0)
                ta.addEventListener("input", () => setDraft(ta.value))
                ta.addEventListener("keydown", (e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    confirmEdit()
                  }
                  if (e.key === "Escape") cancelEdit()
                })
              }}
            />
            <div class="te-collection-edit-actions">
              <ConfirmButtons onOk={confirmEdit} onCancel={cancelEdit} />
            </div>
          </div>
        </Show>

        <div
          class="te-collection-children"
          style={{ display: amEditing() ? "none" : undefined }}
        >
          <For each={keys()}>
            {(childKey) => <ChildEntry
              parentValue={props.value}
              parentPath={props.path}
              parentLevel={props.level}
              childKey={childKey}
              isParentArray={isArray()}
            />}
          </For>

          <Show when={addingKey()}>
            <div class="te-add-key" style={{ "margin-left": `${ctx.indent / 2}em` }}>
              <te-input
                ref={(el: TEInput) => {
                  const input = el.input
                  input.placeholder = "key name"
                  setTimeout(() => input.focus(), 0)
                  input.addEventListener("input", () => setNewKey(input.value))
                  input.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      confirmAddKey()
                    }
                    if (e.key === "Escape") cancelAddKey()
                  })
                }}
              />
              <ConfirmButtons onOk={confirmAddKey} onCancel={cancelAddKey} />
            </div>
          </Show>
        </div>

        <Show when={!amEditing()}>
          <span class="te-bracket te-bracket-closing">
            {brackets().close}
          </span>
        </Show>
      </Show>
    </div>
  )
}

function ChildEntry(props: {
  parentValue: Record<string, unknown> | unknown[]
  parentPath: CollectionKey[]
  parentLevel: number
  childKey: string
  isParentArray: boolean
}) {
  const ctx = useEditor()

  const resolvedKey = createMemo(() =>
    props.isParentArray ? Number(props.childKey) : props.childKey
  )
  const childPath = createMemo(() => [...props.parentPath, resolvedKey()])
  const childValue = createMemo(() => (props.parentValue as any)[props.childKey])

  const customRenderer = createMemo((): CustomRenderer | null => {
    const v = childValue()
    const p = childPath()
    for (const r of ctx.customRenderers) {
      if (r.condition({ value: v, path: p })) return r
    }
    return null
  })

  return (
    <Show
      when={isCollection(childValue()) && !customRenderer()}
      fallback={
        <ValueNode
          key={resolvedKey()}
          value={childValue()}
          path={childPath()}
          level={props.parentLevel + 1}
          parentData={props.parentValue as object}
          customRenderer={customRenderer()}
        />
      }
    >
      <CollectionNode
        key={resolvedKey()}
        value={childValue() as Record<string, unknown> | unknown[]}
        path={childPath()}
        level={props.parentLevel + 1}
        parentData={props.parentValue as object}
      />
    </Show>
  )
}
