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

  const ctx: EditorContext = {
    ...editing,
    get onEdit() { return props.onEdit },
    get onDelete() { return props.onDelete },
    get onAdd() { return props.onAdd },
    collapse: props.collapse ?? (() => false),
    indent: props.indent ?? 3,
    showStringQuotes: props.showStringQuotes ?? true,
    showCollectionCount: props.showCollectionCount ?? true,
    showArrayIndices: props.showArrayIndices ?? true,
    enableClipboard: props.enableClipboard ?? true,
    customRenderers: props.customRenderers ?? [],
    jsonStringify: props.jsonStringify ?? ((d) => JSON.stringify(d, null, 2)),
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
