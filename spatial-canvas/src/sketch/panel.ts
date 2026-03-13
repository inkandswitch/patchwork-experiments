import type { DocHandle } from '@automerge/automerge-repo'
import type { CanvasDoc, Disposer } from '../core/types.js'
import type { PatchworkViewElement } from '@inkandswitch/patchwork-elements'
import {
  getRegistry,
  createDocOfDatatype2,
  type DatatypeDescription,
  type LoadedDatatype,
} from '@inkandswitch/patchwork-plugins'

// Width of the sketch panel when expanded — resolves against .sc-container
// (the flex parent) which has a definite width, so no JS calculation needed.
const EXPANDED_WIDTH = '30%'
// Width of the collapsed tab handle
const COLLAPSED_WIDTH = '28px'

/**
 * SketchPanel — a collapsible side panel that hosts a second spatial canvas.
 *
 * Collapsed: a thin 28px vertical tab showing a rotated "Sketch" label.
 * Expanded: slides out to 30% of the canvas width via CSS transition.
 *
 * Mounted as a direct flex child of .sc-container (not inside the grid overlay),
 * so width:30% and height:100% both resolve correctly without any JS calculation.
 */
export default function SketchPanel(
  handle: DocHandle<CanvasDoc>,
  element: PatchworkViewElement,
): Disposer {
  const repo = element.repo

  let open = false
  let canvasView: HTMLElement | null = null

  // ---- Shell styles ----
  element.style.cssText = [
    `width: ${COLLAPSED_WIDTH}`,
    'height: 100%',
    'display: flex',
    'flex-direction: row',
    'overflow: hidden',
    'transition: width 200ms ease',
  ].join(';')

  // ---- Tab handle ----
  const tab = document.createElement('div')
  tab.style.cssText = [
    'flex-shrink: 0',
    `width: ${COLLAPSED_WIDTH}`,
    'height: 100%',
    'display: flex',
    'align-items: center',
    'justify-content: center',
    'cursor: pointer',
    'user-select: none',
    '-webkit-user-select: none',
    'background: white',
    'border-left: 1px solid #e0e0e0',
    'box-shadow: -2px 0 8px rgba(0,0,0,0.06)',
    'transition: background 0.1s',
    'z-index: 1',
    'box-sizing: border-box',
  ].join(';')

  const label = document.createElement('span')
  label.textContent = 'Sketch'
  label.style.cssText = [
    'font: 500 11px/1 system-ui, sans-serif',
    'color: #555',
    'letter-spacing: 0.05em',
    'transform: rotate(-90deg)',
    'white-space: nowrap',
    'transition: color 0.1s',
    'pointer-events: none',
  ].join(';')

  tab.appendChild(label)
  element.appendChild(tab)

  // ---- Canvas container (fills remaining width when expanded) ----
  const canvasContainer = document.createElement('div')
  canvasContainer.style.cssText = [
    'flex: 1',
    'min-width: 0',
    'height: 100%',
    'overflow: hidden',
    'border-left: 2px solid #e0e0e0',
    'background: #f8f8f8',
  ].join(';')
  element.appendChild(canvasContainer)

  // ---- Hover style ----
  tab.addEventListener('mouseenter', () => {
    tab.style.background = '#f5f5f5'
    label.style.color = '#222'
  })
  tab.addEventListener('mouseleave', () => {
    tab.style.background = open ? '#fafafa' : 'white'
    label.style.color = open ? '#222' : '#555'
  })

  // ---- Toggle logic ----
  async function expand() {
    open = true
    element.style.width = EXPANDED_WIDTH
    tab.style.background = '#fafafa'
    label.style.color = '#222'

    // Create the sketch doc on first open
    let sketchUrl = handle.doc()?.llmSketchUrl
    if (!sketchUrl) {
      try {
        const datatypeRegistry = getRegistry<DatatypeDescription>('patchwork:datatype')
        const loaded = await datatypeRegistry.load('spatial-canvas')
        if (!loaded) {
          console.error('[SketchPanel] spatial-canvas datatype not found')
          return
        }
        const docHandle = await createDocOfDatatype2(loaded as LoadedDatatype, repo)
        sketchUrl = docHandle.url
        handle.change(d => {
          d.llmSketchUrl = sketchUrl
        })
      } catch (err) {
        console.error('[SketchPanel] failed to create sketch doc', err)
        return
      }
    }

    // Mount the sketch canvas (once)
    if (!canvasView) {
      const view = document.createElement('patchwork-view')
      view.setAttribute('doc-url', sketchUrl)
      view.setAttribute('tool-id', 'spatial-canvas')
      view.style.cssText = 'display:block;width:100%;height:100%;'
      canvasContainer.appendChild(view)
      canvasView = view
    }
  }

  function collapse() {
    open = false
    element.style.width = COLLAPSED_WIDTH
    tab.style.background = 'white'
    label.style.color = '#555'
  }

  tab.addEventListener('click', () => {
    if (open) {
      collapse()
    } else {
      expand()
    }
  })

  return () => {
    element.innerHTML = ''
    canvasView = null
  }
}
