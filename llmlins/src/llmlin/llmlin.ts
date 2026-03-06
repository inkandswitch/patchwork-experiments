import type { LLMlinDoc, AutomergeUrl, DocHandle, Disposer } from './types.js'
import type { Repo } from '@automerge/automerge-repo'
import { updateText } from '@automerge/automerge'

type ToolElement = HTMLElement & { repo: Repo }
import llmlinCss from './css/llmlin.css?inline'
import { resolveDocTitle } from '../shared/resolve-doc-title.js'

// ============================================================================
// Constants
// ============================================================================

const MODELS = [
  { id: 'gpt-4o',              label: 'GPT-4o' },
  { id: 'gpt-4o-mini',         label: 'GPT-4o mini' },
  { id: 'claude-opus-4-5',     label: 'Claude Opus 4.5' },
  { id: 'claude-sonnet-4-5',   label: 'Claude Sonnet 4.5' },
  { id: 'gemini-2.0-flash',    label: 'Gemini 2.0 Flash' },
]

const DEFAULT_MODEL = 'claude-sonnet-4-5'

// ============================================================================
// Datatype
// ============================================================================

export const LLMlinDatatype = {
  init(doc: LLMlinDoc) {
    doc.readDocUrls    = []
    doc.writeDocUrls   = []
    doc.prompt         = ''
    doc.model          = DEFAULT_MODEL
    doc.watchedDocUrls = []
  },

  getTitle(_doc: LLMlinDoc): string {
    return 'LLMlin'
  },

  markCopy(_doc: LLMlinDoc) {},
}

// ============================================================================
// Helpers
// ============================================================================

let styleInjected = false
function injectStyles() {
  if (styleInjected) return
  styleInjected = true
  const style = document.createElement('style')
  style.textContent = llmlinCss
  document.head.appendChild(style)
}

// ============================================================================
// SVG constants
// ============================================================================

const SVG_NS = 'http://www.w3.org/2000/svg'

const PLAY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
  fill="currentColor">
  <polygon points="5,3 19,12 5,21"/>
</svg>`

// Cartoon eye — always open.
// Bold oval outline, large off-center iris/pupil, small highlight dot.
// ViewBox: -22 -16 44 32  (44×32 units, center at origin).
// Pupil cx/cy are animated by JS when eyeMode is active.
const EYE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" class="ll-eye-svg"
  viewBox="-22 -16 44 32" width="52" height="38">
  <!-- Outer oval (white of eye) -->
  <ellipse cx="0" cy="0" rx="20" ry="14"
    fill="#fffef8" stroke="#2a2420" stroke-width="2.5"/>
  <!-- Iris + pupil (one large dark circle) -->
  <circle class="ll-eye-iris" cx="-4" cy="-2" r="9"/>
  <!-- Pupil darker core -->
  <circle class="ll-eye-pupil" cx="-4" cy="-2" r="6"/>
  <!-- Specular highlight -->
  <circle class="ll-eye-highlight" cx="-7" cy="-5" r="2.2"/>
</svg>`

// ============================================================================
// Token pill helpers
// ============================================================================

function makeTokenPill(
  docUrl: AutomergeUrl,
  bucket: 'read' | 'write',
  repo: Repo | undefined,
  watched: boolean,
  eyeMode: boolean,
  onToggleWatch: (url: AutomergeUrl) => void,
  onDragStart: (e: DragEvent, url: AutomergeUrl, bucket: 'read' | 'write') => void
): HTMLElement {
  const pill = document.createElement('div')
  const classes = ['ll-token']
  if (watched)             classes.push('ll-token-watched')
  if (eyeMode && !watched) classes.push('ll-token-dim')
  pill.className = classes.join(' ')
  pill.dataset.docUrl = docUrl
  pill.textContent = 'Untitled Doc'
  pill.draggable = true

  if (repo) {
    repo.find<Record<string, unknown>>(docUrl)
      .then(h => resolveDocTitle(h))
      .then(title => { pill.textContent = title })
      .catch(() => {})
  }

  if (eyeMode) {
    pill.addEventListener('click', () => onToggleWatch(docUrl))
  }

  pill.addEventListener('dragstart', e => onDragStart(e, docUrl, bucket))

  return pill
}

function renderTokens(
  container: HTMLElement,
  urls: AutomergeUrl[],
  bucket: 'read' | 'write',
  watchedSet: Set<AutomergeUrl>,
  eyeMode: boolean,
  onToggleWatch: (url: AutomergeUrl) => void,
  onDragStart: (e: DragEvent, url: AutomergeUrl, bucket: 'read' | 'write') => void,
  repo: Repo | undefined
) {
  container.innerHTML = ''
  for (const url of urls) {
    container.appendChild(
      makeTokenPill(url, bucket, repo, watchedSet.has(url), eyeMode, onToggleWatch, onDragStart)
    )
  }
}

// ============================================================================
// Trapezoid overlay
// ============================================================================

/**
 * Draws light-beam trapezoids from the eye (top-left, above header) downward
 * to each watched token pill. Fans out from the eye's bottom edge to the
 * full width of the token pill.
 */
function redrawOverlay(
  svg: SVGSVGElement,
  root: HTMLElement,
  eyeBtn: HTMLElement,
  watchedUrls: AutomergeUrl[]
) {
  svg.innerHTML = ''
  if (watchedUrls.length === 0) return

  const rootRect = root.getBoundingClientRect()
  const eyeRect  = eyeBtn.getBoundingClientRect()

  // Source: bottom-center of the eye, narrow spread
  const srcCX  = (eyeRect.left + eyeRect.right) / 2 - rootRect.left
  const srcY   = eyeRect.bottom - rootRect.top
  const halfSrc = Math.max(eyeRect.width * 0.18, 4)

  for (const url of watchedUrls) {
    const pill = root.querySelector<HTMLElement>(`.ll-token[data-doc-url="${url}"]`)
    if (!pill) continue

    const pillRect = pill.getBoundingClientRect()
    const tgtY  = pillRect.bottom - rootRect.top
    const tgtX1 = pillRect.left   - rootRect.left
    const tgtX2 = pillRect.right  - rootRect.left

    const poly = document.createElementNS(SVG_NS, 'polygon')
    poly.setAttribute(
      'points',
      `${srcCX - halfSrc},${srcY} ${tgtX1},${tgtY} ${tgtX2},${tgtY} ${srcCX + halfSrc},${srcY}`
    )
    poly.setAttribute('class', 'll-trap')
    svg.appendChild(poly)
  }
}

// ============================================================================
// Tool
// ============================================================================

export function LLMlinTool(
  handle: DocHandle<LLMlinDoc>,
  element: ToolElement
): Disposer {
  injectStyles()

  const repo = element.repo

  // ---- Build DOM ----

  const root = document.createElement('div')
  root.className = 'll-root'

  // Eye bar — top-left, above the drop-zone header
  const eyebar = document.createElement('div')
  eyebar.className = 'll-eyebar'

  const eyeBtn = document.createElement('div')
  eyeBtn.className = 'll-eye-btn'
  eyeBtn.innerHTML = EYE_SVG
  eyeBtn.setAttribute('title', 'Toggle view mode')
  eyebar.appendChild(eyeBtn)

  // Header — drop zones; label rendered BELOW the token row
  const header = document.createElement('div')
  header.className = 'll-header'

  const readZone = document.createElement('div')
  readZone.className = 'll-zone'
  readZone.dataset.bucket = 'read'

  const readTokens = document.createElement('div')
  readTokens.className = 'll-tokens'

  const readLabel = document.createElement('div')
  readLabel.className = 'll-zone-label'
  readLabel.textContent = 'Read'

  readZone.appendChild(readTokens)  // tokens first
  readZone.appendChild(readLabel)   // label below

  const writeZone = document.createElement('div')
  writeZone.className = 'll-zone'
  writeZone.dataset.bucket = 'write'

  const writeTokens = document.createElement('div')
  writeTokens.className = 'll-tokens'

  const writeLabel = document.createElement('div')
  writeLabel.className = 'll-zone-label'
  writeLabel.textContent = 'Write'

  writeZone.appendChild(writeTokens) // tokens first
  writeZone.appendChild(writeLabel)  // label below

  header.appendChild(readZone)
  header.appendChild(writeZone)

  // Body
  const body = document.createElement('div')
  body.className = 'll-body'

  const textarea = document.createElement('textarea')
  textarea.className = 'll-prompt'
  textarea.placeholder = 'Write your prompt here…'
  body.appendChild(textarea)

  // Footer
  const footer = document.createElement('div')
  footer.className = 'll-footer'

  const modelSelect = document.createElement('select')
  modelSelect.className = 'll-model'
  for (const m of MODELS) {
    const opt = document.createElement('option')
    opt.value = m.id
    opt.textContent = m.label
    modelSelect.appendChild(opt)
  }

  const playBtn = document.createElement('button')
  playBtn.className = 'll-play'
  playBtn.innerHTML = PLAY_SVG
  playBtn.setAttribute('title', 'Run')

  footer.appendChild(modelSelect)
  footer.appendChild(playBtn)

  // SVG overlay (full-root, pointer-events: none)
  const overlay = document.createElementNS(SVG_NS, 'svg')
  overlay.setAttribute('class', 'll-overlay')
  overlay.setAttribute('width', '100%')
  overlay.setAttribute('height', '100%')

  root.appendChild(eyebar)
  root.appendChild(header)
  root.appendChild(body)
  root.appendChild(footer)
  root.appendChild(overlay)
  element.appendChild(root)

  // ---- State ----

  let eyeMode = false

  // ---- Pupil mouse tracking (only active in eye mode) ----

  const onMouseMove = (e: MouseEvent) => {
    if (!eyeMode) return

    // The iris and pupil share the same offset from the SVG center.
    // We move both together so the dark circle tracks as one unit.
    const iris      = eyeBtn.querySelector<SVGCircleElement>('.ll-eye-iris')
    const pupil     = eyeBtn.querySelector<SVGCircleElement>('.ll-eye-pupil')
    const highlight = eyeBtn.querySelector<SVGCircleElement>('.ll-eye-highlight')
    if (!iris || !pupil) return

    const eyeRect = eyeBtn.getBoundingClientRect()
    const eyeCx   = eyeRect.left + eyeRect.width  / 2
    const eyeCy   = eyeRect.top  + eyeRect.height / 2

    const dx   = e.clientX - eyeCx
    const dy   = e.clientY - eyeCy
    const dist = Math.sqrt(dx * dx + dy * dy)

    // Resting offset (iris starts at -4, -2 in the SVG)
    const restX = -4
    const restY = -2

    if (dist < 1) {
      iris.setAttribute('cx',  String(restX))
      iris.setAttribute('cy',  String(restY))
      pupil.setAttribute('cx', String(restX))
      pupil.setAttribute('cy', String(restY))
      highlight?.setAttribute('cx', String(restX - 3))
      highlight?.setAttribute('cy', String(restY - 3))
      return
    }

    // ViewBox is 44 units wide rendered at eyeRect.width px.
    // Iris radius = 9, max travel = ~5 SVG units from rest position.
    const svgUnitsPerPx = 44 / eyeRect.width
    const MAX_TRAVEL    = 5

    const normX  = dx / dist
    const normY  = dy / dist
    const travel = Math.min(dist * svgUnitsPerPx, MAX_TRAVEL)

    const cx = restX + normX * travel
    const cy = restY + normY * travel

    iris.setAttribute('cx',  String(cx))
    iris.setAttribute('cy',  String(cy))
    pupil.setAttribute('cx', String(cx))
    pupil.setAttribute('cy', String(cy))
    highlight?.setAttribute('cx', String(cx - 3))
    highlight?.setAttribute('cy', String(cy - 3))
  }

  document.addEventListener('mousemove', onMouseMove)

  // ---- Render function ----

  function render() {
    const doc = handle.doc()
    if (!doc) return

    const watchedSet = new Set(doc.watchedDocUrls)

    const onToggleWatch = (url: AutomergeUrl) => {
      handle.change(d => {
        const idx = d.watchedDocUrls.indexOf(url)
        if (idx === -1) {
          d.watchedDocUrls.push(url)
        } else {
          d.watchedDocUrls.splice(idx, 1)
        }
      })
    }

    const onDragStart = (e: DragEvent, url: AutomergeUrl, bucket: 'read' | 'write') => {
      e.dataTransfer?.setData('text/x-patchwork-urls', JSON.stringify([url]))
      e.dataTransfer?.setData('text/x-llmlin-source', bucket)
    }

    renderTokens(readTokens,  doc.readDocUrls,  'read',  watchedSet, eyeMode, onToggleWatch, onDragStart, repo)
    renderTokens(writeTokens, doc.writeDocUrls, 'write', watchedSet, eyeMode, onToggleWatch, onDragStart, repo)

    if (document.activeElement !== textarea) {
      textarea.value = doc.prompt ?? ''
    }

    modelSelect.value = doc.model ?? DEFAULT_MODEL

    root.classList.toggle('ll-eye-mode', eyeMode)

    if (eyeMode) {
      requestAnimationFrame(() => {
        redrawOverlay(overlay, root, eyeBtn, doc.watchedDocUrls)
      })
    } else {
      overlay.innerHTML = ''
    }
  }

  // ---- Drop handlers ----

  function setupDropZone(zone: HTMLElement, bucket: 'read' | 'write') {
    zone.addEventListener('dragover', e => {
      e.stopPropagation()
      if (e.dataTransfer?.types.includes('text/x-patchwork-urls')) {
        e.preventDefault()
        zone.classList.add('ll-drag-over')
      }
    })

    zone.addEventListener('dragleave', e => {
      e.stopPropagation()
      zone.classList.remove('ll-drag-over')
    })

    zone.addEventListener('drop', e => {
      e.preventDefault()
      e.stopPropagation()
      zone.classList.remove('ll-drag-over')

      const raw = e.dataTransfer?.getData('text/x-patchwork-urls')
      if (!raw) return

      let urls: AutomergeUrl[]
      try {
        urls = JSON.parse(raw) as AutomergeUrl[]
      } catch {
        return
      }

      const sourceBucket = e.dataTransfer?.getData('text/x-llmlin-source') as 'read' | 'write' | ''

      handle.change(doc => {
        const target = bucket === 'read' ? doc.readDocUrls : doc.writeDocUrls
        const source = bucket === 'read' ? doc.writeDocUrls : doc.readDocUrls

        for (const url of urls) {
          // Add to target if not already there
          if (!target.includes(url)) {
            target.push(url)
          }

          // If dragged from the other bucket within this component, remove from source
          if (sourceBucket && sourceBucket !== bucket) {
            const idx = source.indexOf(url)
            if (idx !== -1) source.splice(idx, 1)
          }
        }
      })
    })
  }

  setupDropZone(readZone,  'read')
  setupDropZone(writeZone, 'write')

  // ---- Input handlers ----

  textarea.addEventListener('input', () => {
    handle.change(doc => {
      updateText(doc, ['prompt'], textarea.value)
    })
  })

  modelSelect.addEventListener('change', () => {
    handle.change(doc => {
      doc.model = modelSelect.value
    })
  })

  playBtn.addEventListener('click', () => {
    console.log('[LLMlin] Run:', handle.doc()?.prompt)
  })

  eyeBtn.addEventListener('click', () => {
    eyeMode = !eyeMode
    render()
  })

  // ---- Subscribe to doc changes ----

  const onChange = () => render()
  handle.on('change', onChange)

  render()

  // ---- Cleanup ----

  return () => {
    handle.off('change', onChange)
    document.removeEventListener('mousemove', onMouseMove)
    root.remove()
  }
}

// ============================================================================
// Plugin exports
// ============================================================================

export const llmlinPlugins = [
  {
    type: 'patchwork:datatype' as const,
    id: 'llmlin',
    name: 'LLMlin',
    icon: 'Cpu',
    async load() {
      return LLMlinDatatype
    },
  },
  {
    type: 'patchwork:tool' as const,
    id: 'llmlin',
    name: 'LLMlin',
    icon: 'Cpu',
    supportedDatatypes: ['llmlin'],
    async load() {
      return LLMlinTool
    },
  },
]
