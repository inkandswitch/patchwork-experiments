import { getRegistry } from '@inkandswitch/patchwork-plugins'

/**
 * Resolve a human-readable title for a patchwork document URL.
 *
 * Looks up the document via the repo attached to the patchwork datatype
 * registry, reads its `datatype` field, loads the matching datatype plugin,
 * and calls `getTitle()`. Falls back to `'Untitled Doc'` at any failure point.
 */
export async function resolveDocTitle(docUrl: string): Promise<string> {
  try {
    const registry = getRegistry('patchwork:datatype')
    const repo = (registry as unknown as {
      repo?: { find(url: string): Promise<{ doc(): Record<string, unknown> | undefined }> }
    }).repo
    if (!repo) return 'Untitled Doc'
    const docHandle = await repo.find(docUrl)
    const innerDoc = docHandle.doc()
    if (!innerDoc) return 'Untitled Doc'
    const datatypeId = innerDoc['datatype'] as string | undefined
    if (!datatypeId) return 'Untitled Doc'
    const datatype = await registry.load(datatypeId) as { getTitle?: (d: unknown) => string } | null
    return datatype?.getTitle?.(innerDoc) ?? 'Untitled Doc'
  } catch {
    return 'Untitled Doc'
  }
}
