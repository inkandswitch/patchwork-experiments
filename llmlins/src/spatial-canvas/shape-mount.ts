import type { CanvasShape, MountedShape, Disposer } from './types.js'

/**
 * Mount a single shape into the DOM and return controls for updating/unmounting it.
 *
 * DOM structure created:
 *   .sc-shape
 *     .sc-positioned         ← carries transform + size
 *       .sc-shape-content    ← embed or token content renders here
 *
 * Position updates write directly to element.style — no framework involved.
 */
export function mountShape(
  shape: CanvasShape,
  shapesContainer: HTMLElement,
  mountContent: (container: HTMLElement, shape: CanvasShape) => Disposer
): MountedShape {
  const shapeEl = document.createElement('div')
  shapeEl.className = 'sc-shape'
  shapeEl.dataset.shapeId = shape.id

  const positioned = document.createElement('div')
  positioned.className = 'sc-positioned'

  const content = document.createElement('div')
  content.className = 'sc-shape-content'
  // Suppress native browser drag-and-drop on the content container so it
  // doesn't interfere with our custom pointer-based drag handling.
  content.draggable = false

  positioned.appendChild(content)
  shapeEl.appendChild(positioned)
  shapesContainer.appendChild(shapeEl)

  // Mount content
  let disposeContent = mountContent(content, shape)
  let currentDocUrl = shape.docUrl
  let currentToolId = shape.toolId

  function updatePosition(s: CanvasShape) {
    positioned.style.setProperty(
      'transform',
      `translate(` +
        `calc(${s.x}px - var(--sc-padding)),` +
        `calc(${s.y}px - var(--sc-padding))` +
      `) rotate(${s.rotation}rad)`
    )
    positioned.style.setProperty(
      'width',
      `calc(${Math.floor(s.width)}px + var(--sc-padding) * 2)`
    )
    positioned.style.setProperty(
      'height',
      `calc(${Math.floor(s.height)}px + var(--sc-padding) * 2)`
    )

    // Remount patchwork-view only when docUrl or toolId changes
    if (s.docUrl !== currentDocUrl || s.toolId !== currentToolId) {
      disposeContent()
      content.innerHTML = ''
      disposeContent = mountContent(content, s)
      currentDocUrl = s.docUrl
      currentToolId = s.toolId
    }
  }

  function setSelected(selected: boolean) {
    positioned.classList.toggle('selected', selected)
    shapeEl.classList.toggle('selected', selected)
  }

  // Initial position
  updatePosition(shape)

  return {
    updatePosition,
    setSelected,
    unmount() {
      disposeContent()
      shapeEl.remove()
    },
  }
}

/**
 * Mount a <patchwork-view> custom element inside a container.
 * Returns a Disposer that removes the element.
 */
export function mountPatchworkView(
  container: HTMLElement,
  docUrl: string,
  toolId: string
): Disposer {
  const el = document.createElement('patchwork-view') as HTMLElement
  el.setAttribute('doc-url', docUrl)
  el.setAttribute('tool-id', toolId)
  el.style.cssText = 'width: 100%; height: 100%; display: block; pointer-events: auto;'
  container.appendChild(el)
  return () => el.remove()
}
