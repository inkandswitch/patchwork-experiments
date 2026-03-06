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

// Dual-state eye SVG.
// ViewBox: -12,-10 to 12,10 (24×20 units, center at origin).
// Open group: outline + iris + pupil (pupil cx/cy animated by JS).
// Closed group: eyelid arcs + lashes.
const EYE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" class="ll-eye-svg"
  viewBox="-12 -10 24 20" width="40" height="32">
  <g class="ll-eye-open-group">
    <path d="M-10 0 C-5 -7 5 -7 10 0 C5 7 -5 7 -10 0Z"
      fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    <circle class="ll-eye-iris" cx="0" cy="0" r="4.5"/>
    <circle class="ll-eye-pupil" cx="0" cy="0" r="2.2"/>
    <circle class="ll-eye-highlight" cx="-1.3" cy="-1.3" r="0.8"/>
  </g>
  <g class="ll-eye-closed-group">
    <path d="M-10 0 C-5 -7 5 -7 10 0"
      fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M-10 0 C-5 3 5 3 10 0"
      fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.45"/>
    <line x1="-4" y1="2.5" x2="-5" y2="5.5" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.4"/>
    <line x1="0"  y1="3"   x2="0"  y2="6"   stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.4"/>
    <line x1="4"  y1="2.5" x2="5"  y2="5.5" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.4"/>
  </g>
</svg>`

// ============================================================================
// Token pill helpers
// ============================================================================

function makeTokenPill(
  docUrl: AutomergeUrl,
  repo: Repo | undefined,
  watched: boolean,
  eyeMode: boolean,
  onToggleWatch: (url: AutomergeUrl) => void
): HTMLElement {
  const pill = document.createElement('div')
  const classes = ['ll-token']
  if (watched)          classes.push('ll-token-watched')
  if (eyeMode && !watched) classes.push('ll-token-dim')
  pill.className = classes.join(' ')
  pill.dataset.docUrl = docUrl
  pill.textContent = 'Untitled Doc'

  if (repo) {
    repo.find<Record<string, unknown>>(docUrl)
      .then(h => resolveDocTitle(h))
      .then(title => { pill.textContent = title })
      .catch(() => {})
  }

  if (eyeMode) {
    pill.addEventListener('click', () => onToggleWatch(docUrl))
  }

  return pill
}

function renderTokens(
  container: HTMLElement,
  urls: AutomergeUrl[],
  watchedSet: Set<AutomergeUrl>,
  eyeMode: boolean,
  onToggleWatch: (url: AutomergeUrl) => void,
  repo: Repo | undefined
) {
  container.innerHTML = ''
  for (const url of urls) {
    container.appendChild(makeTokenPill(url, repo, watchedSet.has(url), eyeMode, onToggleWatch))
  }
}

// ============================================================================
// Trapezoid overlay
// ============================================================================

/**
 * Draws trapezoids from the eye button (above) down to each watched token pill.
 * The shape fans out — narrow at the eye, full-pill-width at the token.
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

  // Source: bottom edge of the eye button, narrow spread
  const srcCX  = (eyeRect.left + eyeRect.right) / 2 - rootRect.left
  const srcY   = eyeRect.bottom - rootRect.top
  const halfSrc = Math.max(eyeRect.width * 0.18, 4)

  for (const url of watchedUrls) {
    const pill = root.querySelector<HTMLElement>(`.ll-token[data-doc-url="${url}"]`)
    if (!pill) continue

    const pillRect = pill.getBoundingClientRect()
    const tgtY  = pillRect.top   - rootRect.top
    const tgtX1 = pillRect.left  - rootRect.left
    const tgtX2 = pillRect.right - rootRect.left

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

  // Eye bar — sits above the drop-zone header, eye right-aligned
  const eyebar = document.createElement('div')
  eyebar.className = 'll-eyebar'

  const eyeBtn = document.createElement('div')
  eyeBtn.className = 'll-eye-btn'
  eyeBtn.innerHTML = EYE_SVG
  eyeBtn.setAttribute('title', 'Toggle eye mode')
  eyebar.appendChild(eyeBtn)

  // Header — drop zones only (eye has moved to eyebar)
  const header = document.createElement('div')
  header.className = 'll-header'

  const readZone = document.createElement('div')
  readZone.className = 'll-zone'
  readZone.dataset.bucket = 'read'

  const readLabel = document.createElement('div')
  readLabel.className = 'll-zone-label'
  readLabel.textContent = 'Read'

  const readTokens = document.createElement('div')
  readTokens.className = 'll-tokens'

  readZone.appendChild(readLabel)
  readZone.appendChild(readTokens)

  const writeZone = document.createElement('div')
  writeZone.className = 'll-zone'
  writeZone.dataset.bucket = 'write'

  const writeLabel = document.createElement('div')
  writeLabel.className = 'll-zone-label'
  writeLabel.textContent = 'Write'

  const writeTokens = document.createElement('div')
  writeTokens.className = 'll-tokens'

  writeZone.appendChild(writeLabel)
  writeZone.appendChild(writeTokens)

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

  // ---- Pupil mouse tracking ----

  const onMouseMove = (e: MouseEvent) => {
    if (!eyeMode) return
    const pupil     = eyeBtn.querySelector<SVGCircleElement>('.ll-eye-pupil')
    const highlight = eyeBtn.querySelector<SVGCircleElement>('.ll-eye-highlight')
    if (!pupil) return

    const eyeRect = eyeBtn.getBoundingClientRect()
    const eyeCx   = eyeRect.left + eyeRect.width  / 2
    const eyeCy   = eyeRect.top  + eyeRect.height / 2

    const dx   = e.clientX - eyeCx
    const dy   = e.clientY - eyeCy
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist < 1) {
      pupil.setAttribute('cx', '0')
      pupil.setAttribute('cy', '0')
      highlight?.setAttribute('cx', '-1.3')
      highlight?.setAttribute('cy', '-1.3')
      return
    }

    // ViewBox is 24 units wide rendered at eyeRect.width px.
    // Max travel: iris_radius - pupil_radius = 4.5 - 2.2 = 2.3 SVG units.
    const svgUnitsPerPx = 24 / eyeRect.width
    const MAX_TRAVEL    = 2.3

    const normX  = dx / dist
    const normY  = dy / dist
    const travel = Math.min(dist * svgUnitsPerPx, MAX_TRAVEL)

    const px = normX * travel
    const py = normY * travel

    pupil.setAttribute('cx', String(px))
    pupil.setAttribute('cy', String(py))
    highlight?.setAttribute('cx', String(px - 1.3))
    highlight?.setAttribute('cy', String(py - 1.3))
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

    renderTokens(readTokens,  doc.readDocUrls,  watchedSet, eyeMode, onToggleWatch, repo)
    renderTokens(writeTokens, doc.writeDocUrls, watchedSet, eyeMode, onToggleWatch, repo)

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
      if (e.dataTransfer?.types.includes('text/x-patchwork-urls')) {
        e.preventDefault()
        zone.classList.add('ll-drag-over')
      }
    })

    zone.addEventListener('dragleave', () => {
      zone.classList.remove('ll-drag-over')
    })

    zone.addEventListener('drop', e => {
      e.preventDefault()
      zone.classList.remove('ll-drag-over')

      const raw = e.dataTransfer?.getData('text/x-patchwork-urls')
      if (!raw) return

      let urls: AutomergeUrl[]
      try {
        urls = JSON.parse(raw) as AutomergeUrl[]
      } catch {
        return
      }

      handle.change(doc => {
        const target = bucket === 'read' ? doc.readDocUrls : doc.writeDocUrls
        for (const url of urls) {
          if (!target.includes(url)) {
            target.push(url)
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
