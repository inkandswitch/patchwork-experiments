import * as Automerge from '@automerge/automerge'
import type { CanvasDoc, DocHandle } from '../core/types.js'
import { deleteShapes } from '../core/commands.js'
import type { TextShape } from './text.js'

export const FONT_FAMILY = "'Playpen Sans', 'Comic Sans MS', cursive, sans-serif"
export const DEFAULT_FONT_SIZE = 18

// Tracks which shape IDs are currently open in an editor, keyed by layer container.
const editingByContainer = new WeakMap<HTMLElement, Set<string>>()

export function isEditing(container: HTMLElement, id: string): boolean {
  return editingByContainer.get(container)?.has(id) ?? false
}

/**
 * Opens an inline contenteditable editor for a text shape inside a container.
 * Pass clientX/clientY to place the caret at the click position; omit for end.
 */
export function openEditor(
  handle: DocHandle<CanvasDoc>,
  container: HTMLElement,
  shapeId: string,
  onClose?: () => void,
  clickAt?: { clientX: number; clientY: number },
) {
  const doc = handle.doc()
  if (!doc) return
  const shape = doc.shapes[shapeId] as TextShape | undefined
  if (!shape) return

  let editing = editingByContainer.get(container)
  if (!editing) { editing = new Set(); editingByContainer.set(container, editing) }
  editing.add(shapeId)

  const size = shape.fontSize ?? DEFAULT_FONT_SIZE
  const color = shape.color ?? '#1a1a1a'

  const editor = document.createElement('div')
  editor.contentEditable = 'true'
  editor.spellcheck = false
  editor.style.cssText = [
    'position:absolute',
    'top:0',
    'left:0',
    'white-space:pre',
    'min-width:4px',
    'min-height:1em',
    'outline:none',
    'cursor:text',
    `transform:translate(${shape.x}px,${shape.y}px)`,
    'z-index:2147483647',
    `font-family:${FONT_FAMILY}`,
    `font-size:${size}px`,
    `color:${color}`,
    'line-height:1.4',
    'caret-color:auto',
  ].join(';')

  editor.innerText = shape.text ?? ''
  container.appendChild(editor)

  // Position caret at click point, or fall back to end of text
  const sel = window.getSelection()
  sel?.removeAllRanges()
  let placed = false
  if (clickAt) {
    const range =
      (document as any).caretRangeFromPoint?.(clickAt.clientX, clickAt.clientY) ??
      (document as any).caretPositionFromPoint?.(clickAt.clientX, clickAt.clientY)
    if (range) {
      if (typeof range.getClientRects === 'function') {
        sel?.addRange(range)
      } else {
        const r = document.createRange()
        r.setStart(range.offsetNode, range.offset)
        r.collapse(true)
        sel?.addRange(r)
      }
      placed = true
    }
  }
  if (!placed) {
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    sel?.addRange(range)
  }

  editor.focus()

  function saveText() {
    handle.change(d => {
      Automerge.updateText(d as Automerge.Doc<unknown>, ['shapes', shapeId, 'text'], editor.innerText ?? '')
    })
  }

  function close() {
    editingByContainer.get(container)?.delete(shapeId)
    if (!(editor.innerText ?? '').trim()) deleteShapes(handle, [shapeId])
    editor.remove()
    onClose?.()
  }

  editor.addEventListener('input', saveText)
  editor.addEventListener('blur', () => { editor.removeEventListener('input', saveText); close() }, { once: true })
  editor.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      editingByContainer.get(container)?.delete(shapeId)
      editor.removeEventListener('input', saveText)
      editor.removeEventListener('blur', close)
      editor.remove()
      if (!(handle.doc()?.shapes[shapeId] as TextShape | undefined)?.text?.trim()) {
        deleteShapes(handle, [shapeId])
      }
      onClose?.()
    }
  })
}
