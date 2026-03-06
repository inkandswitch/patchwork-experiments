import type { DocumentTokenDoc, DocHandle, Disposer } from './types.js'
import { getRegistry } from '@inkandswitch/patchwork-plugins'

// ============================================================================
// Datatype
// ============================================================================

export const DocumentTokenDatatype = {
  init(doc: DocumentTokenDoc) {
    doc.docUrl = ''
    doc.toolId = ''
  },

  getTitle(_doc: DocumentTokenDoc): string {
    return 'Document Token'
  },

  markCopy(_doc: DocumentTokenDoc) {},
}

// ============================================================================
// Tool — renders a single doc reference as a styled pill
// ============================================================================

export function DocumentTokenTool(
  handle: DocHandle<DocumentTokenDoc>,
  element: HTMLElement
): Disposer {
  const root = document.createElement('div')
  root.className = 'dt-root'
  root.textContent = 'Loading…'
  element.appendChild(root)

  let unsubscribe: (() => void) | null = null

  async function loadTitle(doc: DocumentTokenDoc) {
    if (!doc.docUrl) {
      root.textContent = 'Untitled Doc'
      return
    }

    const registry = getRegistry('patchwork:datatype')

    const resolve = async () => {
      try {
        const datatype = await registry.load(doc.toolId) as { getTitle?: (d: unknown) => string } | null
        if (datatype?.getTitle) {
          const docHandle = await (registry as unknown as { repo?: { find(url: string): Promise<{ doc(): unknown }> } }).repo?.find(doc.docUrl)
          const innerDoc = docHandle?.doc()
          root.textContent = innerDoc ? datatype.getTitle(innerDoc) : 'Untitled Doc'
        } else {
          root.textContent = 'Untitled Doc'
        }
      } catch {
        root.textContent = 'Untitled Doc'
      }
    }

    unsubscribe = registry.on('changed', resolve)
    await resolve()
  }

  const doc = handle.doc()
  if (doc) loadTitle(doc)

  const onChange = ({ doc }: { doc: DocumentTokenDoc }) => loadTitle(doc)
  handle.on('change', onChange)

  return () => {
    handle.off('change', onChange)
    unsubscribe?.()
    root.remove()
  }
}

// ============================================================================
// Plugin exports
// ============================================================================

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
