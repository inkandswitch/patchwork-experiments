import type { CanvasDoc, DocHandle, Disposer } from '../core/types.js'

/**
 * SelectionLayer — reads `doc.stateByUser[contactUrl].selection` and applies a
 * drop-shadow CSS filter to the DOM elements of selected shapes.
 *
 * Only the current user's selection is highlighted. The original filter value
 * of each element is saved and restored when the shape is deselected.
 */
export default function SelectionLayer(
  handle: DocHandle<CanvasDoc>,
  _element: HTMLElement,
): Disposer {
  const contactUrl = window.accountDocHandle?.doc()?.contactUrl ?? 'local'

  /** shapeId → the element's filter value before we applied the highlight */
  const appliedFilters = new Map<string, string>()

  function applyHighlight(el: HTMLElement) {
    el.style.filter = 'drop-shadow(0 0 4px #1a73e8) drop-shadow(0 0 8px rgba(26,115,232,0.5))'
  }

  function render({ doc }: { doc: CanvasDoc }) {
    const mySelection = doc.stateByUser?.[contactUrl]?.selection ?? {}
    const newSelected = new Set(Object.keys(mySelection))

    // Remove highlight from shapes no longer selected
    for (const [id, origFilter] of appliedFilters) {
      if (!newSelected.has(id)) {
        const el = document.querySelector<HTMLElement>(`[data-shape-id="${id}"]`)
        if (el) el.style.filter = origFilter
        appliedFilters.delete(id)
      }
    }

    // Apply highlight to newly selected shapes
    for (const id of newSelected) {
      if (!appliedFilters.has(id)) {
        const el = document.querySelector<HTMLElement>(`[data-shape-id="${id}"]`)
        if (el) {
          appliedFilters.set(id, el.style.filter)
          applyHighlight(el)
        }
      }
    }
  }

  handle.on('change', render)
  const initial = handle.doc()
  if (initial) render({ doc: initial })

  return () => {
    handle.off('change', render)
    // Restore all filters we applied
    for (const [id, origFilter] of appliedFilters) {
      const el = document.querySelector<HTMLElement>(`[data-shape-id="${id}"]`)
      if (el) el.style.filter = origFilter
    }
    appliedFilters.clear()
  }
}
