import * as Automerge from "@automerge/automerge"

export function walkToParent(
  doc: any,
  path: Automerge.Prop[]
): [parent: any, key: string | number] | null {
  if (path.length === 0) return null
  let node = doc
  for (let i = 0; i < path.length - 1; i++) {
    node = node[path[i]]
    if (node == null) return null
  }
  return [node, path[path.length - 1]]
}

export function applyAtPath(doc: any, path: Automerge.Prop[], value: unknown) {
  const target = walkToParent(doc, path)
  if (!target) return
  const [node, key] = target
  if (
    typeof value === "string" &&
    typeof node[key] === "string" &&
    !Automerge.isImmutableString(node[key])
  ) {
    Automerge.updateText(doc, path, value)
  } else {
    node[key] = value
  }
}

export function deleteAtPath(doc: any, path: Automerge.Prop[]) {
  const target = walkToParent(doc, path)
  if (!target) return
  const [node, key] = target
  if (Array.isArray(node) && typeof key === "number") {
    node.splice(key, 1)
  } else {
    delete node[key]
  }
}
