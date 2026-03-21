import { Show } from "solid-js"
import { EditorProvider, createEditingState, type EditorContext } from "./context"
import { CollectionNode } from "./CollectionNode"
import { ValueNode } from "./ValueNode"
import { isCollection } from "./helpers"
import type { EditorProps } from "./types"
import "./IsolatedInput"
import "./style.css"

export function TreeEditor(props: EditorProps) {
  const editing = createEditingState()

  props.ref?.({ stopEditing: editing.stopEditing })

  const ctx: EditorContext = {
    ...editing,
    get onEdit() { return props.onEdit },
    get onDelete() { return props.onDelete },
    get onAdd() { return props.onAdd },
    get collapse() { return props.collapse ?? (() => false) },
    get indent() { return props.indent ?? 3 },
    get showStringQuotes() { return props.showStringQuotes ?? true },
    get showCollectionCount() { return props.showCollectionCount ?? true },
    get showArrayIndices() { return props.showArrayIndices ?? true },
    get enableClipboard() { return props.enableClipboard ?? true },
    get customRenderers() { return props.customRenderers ?? [] },
  }

  return (
    <EditorProvider value={ctx}>
      <div class="te-container">
        <Show
          when={isCollection(props.data)}
          fallback={
            <ValueNode
              key=""
              value={props.data}
              path={[]}
              level={0}
              parentData={null}
              customRenderer={null}
            />
          }
        >
          <CollectionNode
            key=""
            value={props.data as Record<string, unknown> | unknown[]}
            path={[]}
            level={0}
            parentData={null}
          />
        </Show>
      </div>
    </EditorProvider>
  )
}
