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
    doc.readDocUrls  = []
    doc.writeDocUrls = []
    doc.prompt       = ''
    doc.model        = DEFAULT_MODEL
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

/** Inject the stylesheet once per document. */
let styleInjected = false
function injectStyles() {
  if (styleInjected) return
  styleInjected = true
  const style = document.createElement('style')
  style.textContent = llmlinCss
  document.head.appendChild(style)
}

// ============================================================================
// Eye icon SVG
// ============================================================================

const EYE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/>
  <circle cx="12" cy="12" r="3"/>
</svg>`

const PLAY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
  fill="currentColor">
  <polygon points="5,3 19,12 5,21"/>
</svg>`

// ============================================================================
// Token pill helpers
// ============================================================================

/** Build a single token pill element (async title loading). */
function makeTokenPill(
  docUrl: AutomergeUrl,
  repo: Repo | undefined,
  watched: boolean,
  eyeMode: boolean,
  onToggleWatch: (url: AutomergeUrl) => void
): HTMLElement {
  const pill = document.createElement('div')
  pill.className = 'll-token' + (watched ? ' ll-token-watched' : '')
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

/** Render token pills into a container, clearing existing ones. */
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

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Recompute and redraw all trapezoid sight-lines from the eye to watched tokens. */
function redrawOverlay(
  svg: SVGSVGElement,
  root: HTMLElement,
  eyeBtn: HTMLElement,
  watchedUrls: AutomergeUrl[]
) {
  // Clear existing polygons
  svg.innerHTML = ''

  if (watchedUrls.length === 0) return

  const rootRect = root.getBoundingClientRect()
  const eyeRect  = eyeBtn.getBoundingClientRect()

  // Source segment: right edge of the eye button
  const srcX  = eyeRect.right  - rootRect.left
  const srcY1 = eyeRect.top    - rootRect.top
  const srcY2 = eyeRect.bottom - rootRect.top

  for (const url of watchedUrls) {
    const pill = root.querySelector<HTMLElement>(`.ll-token[data-doc-url="${url}"]`)
    if (!pill) continue

    const pillRect = pill.getBoundingClientRect()

    // Target segment: left edge of the token pill
    const tgtX  = pillRect.left   - rootRect.left
    const tgtY1 = pillRect.top    - rootRect.top
    const tgtY2 = pillRect.bottom - rootRect.top

    const poly = document.createElementNS(SVG_NS, 'polygon')
    poly.setAttribute(
      'points',
      `${srcX},${srcY1} ${tgtX},${tgtY1} ${tgtX},${tgtY2} ${srcX},${srcY2}`
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

  // Header
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

  const eyeBtn = document.createElement('div')
  eyeBtn.className = 'll-eye-btn'
  eyeBtn.innerHTML = EYE_SVG
  eyeBtn.setAttribute('title', 'Toggle eye mode')

  header.appendChild(readZone)
  header.appendChild(writeZone)
  header.appendChild(eyeBtn)

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

  // SVG overlay
  const overlay = document.createElementNS(SVG_NS, 'svg')
  overlay.setAttribute('class', 'll-overlay')

  root.appendChild(header)
  root.appendChild(body)
  root.appendChild(footer)
  root.appendChild(overlay)
  element.appendChild(root)

  // ---- State ----

  let eyeMode = false

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

    // Sync textarea (avoid fighting the user while typing)
    if (document.activeElement !== textarea) {
      textarea.value = doc.prompt ?? ''
    }

    // Sync model picker
    modelSelect.value = doc.model ?? DEFAULT_MODEL

    // Sync eye mode class
    root.classList.toggle('ll-eye-mode', eyeMode)

    // Redraw trapezoids
    if (eyeMode) {
      // Defer to next frame so pills are laid out
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
    // Placeholder — prompt execution will be wired here
    console.log('[LLMlin] Run:', handle.doc()?.prompt)
  })

  eyeBtn.addEventListener('click', () => {
    eyeMode = !eyeMode
    render()
  })

  // ---- Subscribe to doc changes ----

  const onChange = () => render()
  handle.on('change', onChange)

  // Initial render
  render()

  // ---- Cleanup ----

  return () => {
    handle.off('change', onChange)
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
