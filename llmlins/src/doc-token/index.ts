import type { AutomergeUrl, DocumentTokenDoc, DocHandle, Disposer } from '../llmlin/types.js'
import type { Repo } from '@automerge/automerge-repo'
import { PwDocToken } from './pw-doc-token.js'

type ToolElement = HTMLElement & { repo: Repo }

// ============================================================================
// Datatype
// ============================================================================

export const DocumentTokenDatatype = {
  init(doc: DocumentTokenDoc) {
    doc.docUrl = '' as AutomergeUrl
    doc.toolId = ''
  },

  getTitle(_doc: DocumentTokenDoc): string {
    return 'Document Token'
  },

  markCopy(_doc: DocumentTokenDoc) {},
}

// ============================================================================
// Tool — renders the referenced document as a centred pw-doc-token pill
// ============================================================================

export function DocumentTokenTool(
  handle: DocHandle<DocumentTokenDoc>,
  element: ToolElement
): Disposer {
  const wrapper = document.createElement('div')
  wrapper.className = 'pw-doc-token-tool'

  const token = document.createElement('pw-doc-token') as PwDocToken
  token.repo = element.repo
  wrapper.appendChild(token)
  element.appendChild(wrapper)

  function applyDoc(doc: DocumentTokenDoc) {
    if (doc.docUrl) {
      token.setAttribute('doc-url', doc.docUrl)
    } else {
      token.removeAttribute('doc-url')
      token.textContent = 'Untitled Doc'
    }
  }

  const doc = handle.doc()
  if (doc) applyDoc(doc)

  const onChange = ({ doc }: { doc: DocumentTokenDoc }) => applyDoc(doc)
  handle.on('change', onChange)

  return () => {
    handle.off('change', onChange)
    wrapper.remove()
  }
}

// ============================================================================
// Plugin exports
// ============================================================================

export { PwDocToken } from './pw-doc-token.js'

export const documentTokenPlugins = [
  {
    type: 'patchwork:datatype' as const,
    id: 'document-token',
    name: 'Document Token',
    icon: 'Tag',
    async load() {
      return DocumentTokenDatatype
    },
  },
  {
    type: 'patchwork:tool' as const,
    id: 'document-token',
    name: 'Document Token',
    icon: 'Tag',
    supportedDatatypes: ['document-token'],
    async load() {
      return DocumentTokenTool
    },
  },
]
