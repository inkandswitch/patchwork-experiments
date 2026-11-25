/**
 * Bring a live element's children into line with freshly built ones, keeping
 * every live node that still fits.
 *
 * A view that rebuilds itself on every change loses whatever the person was
 * doing in it: a `<details>` they opened shuts (and the page shrinks, so the
 * scroll jumps), a scrolled box goes back to its top, a selection vanishes,
 * and a click whose press and release straddle a rebuild lands on a node that
 * is gone, so it never fires. Morphing keeps the nodes and changes only what
 * differs.
 *
 * Rules, for each new child against the live child in its place:
 *
 * - **Keys.** An element with `data-key` is matched to the live sibling with
 *   the same key, wherever it is, and moved into place; it never morphs into
 *   an element with another key (or none).
 * - **Text** nodes are kept and their text updated.
 * - **Elements** of the same tag and key are kept: attributes are copied
 *   across and the children morphed in turn. A `<details>`' `open` is the
 *   person's, so it is never copied.
 * - **Whole** elements (`data-morph="whole"`) carry listeners this function
 *   cannot see. One is kept only when its markup is unchanged, and otherwise
 *   replaced outright, so a kept node never runs a stale handler.
 * - Anything else is replaced, except a keyed live element, which a new node
 *   is put in front of, since it may be wanted further on. Live children past
 *   the end are removed.
 *
 * Nodes kept this way must not hold listeners of their own other than inside
 * whole elements: a view handles its events by delegation, reading what to
 * do from attributes, which morphing keeps current.
 */

const keyOf = (node) => (node?.nodeType === 1 ? node.getAttribute("data-key") : null)
const isWhole = (node) => node.nodeType === 1 && node.getAttribute("data-morph") === "whole"

function fits(live, next) {
  if (live.nodeType !== next.nodeType) return false
  if (next.nodeType !== 1) return true
  if (live.tagName !== next.tagName || keyOf(live) !== keyOf(next)) return false
  if (isWhole(live) || isWhole(next)) return isWhole(live) && isWhole(next) && live.outerHTML === next.outerHTML
  return true
}

function syncAttributes(live, next) {
  const keepOpen = live.tagName === "DETAILS"
  for (const { name } of [...live.attributes]) {
    if (keepOpen && name === "open") continue
    if (!next.hasAttribute(name)) live.removeAttribute(name)
  }
  for (const { name, value } of [...next.attributes]) {
    if (keepOpen && name === "open") continue
    if (live.getAttribute(name) !== value) live.setAttribute(name, value)
  }
}

export function morph(live, next) {
  const incoming = [...next.childNodes]
  incoming.forEach((node, i) => {
    let current = live.childNodes[i] ?? null
    const key = keyOf(node)
    if (key !== null && keyOf(current) !== key) {
      const match = [...live.childNodes].slice(i + 1).find((c) => keyOf(c) === key)
      if (match) {
        live.insertBefore(match, current)
        current = match
      }
    }
    if (!current) live.appendChild(node)
    // A keyed live node may be wanted further on: step in front of it.
    else if (!fits(current, node)) keyOf(current) === null ? live.replaceChild(node, current) : live.insertBefore(node, current)
    else if (node.nodeType !== 1) {
      if (current.nodeValue !== node.nodeValue) current.nodeValue = node.nodeValue
    } else if (!isWhole(node)) {
      syncAttributes(current, node)
      morph(current, node)
    }
  })
  // removeChild, not lastChild.remove(): happy-dom 15's HTMLFormElement.remove()
  // throws "not a child of this node" for a form that is one.
  while (live.childNodes.length > incoming.length) live.removeChild(live.lastChild)
}
