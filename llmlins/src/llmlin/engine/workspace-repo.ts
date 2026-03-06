import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo'

// ============================================================================
// Handle wrapper types
// ============================================================================

export type HandleWrapper = {
  readonly url: AutomergeUrl
  doc(): any
  change(fn: (doc: any) => void): void
  on(event: string, fn: (...args: any[]) => void): void
  off(event: string, fn: (...args: any[]) => void): void
  heads(): any
}

export type LLMlinRepo = {
  find(url: AutomergeUrl): Promise<HandleWrapper>
  create(): DocHandle<any>
}

// ============================================================================
// Wrappers
// ============================================================================

function createReadOnlyWrapper(handle: DocHandle<any>): HandleWrapper {
  return {
    get url() { return handle.url },
    doc() { return handle.doc() },
    change(_fn: (doc: any) => void) {
      throw new Error(`Document ${handle.url} is read-only`)
    },
    on(event: string, fn: (...args: any[]) => void) { handle.on(event as any, fn) },
    off(event: string, fn: (...args: any[]) => void) { handle.off(event as any, fn) },
    heads() { return handle.heads() },
  }
}

function createFullAccessWrapper(handle: DocHandle<any>): HandleWrapper {
  return {
    get url() { return handle.url },
    doc() { return handle.doc() },
    change(fn: (doc: any) => void) { handle.change(fn) },
    on(event: string, fn: (...args: any[]) => void) { handle.on(event as any, fn) },
    off(event: string, fn: (...args: any[]) => void) { handle.off(event as any, fn) },
    heads() { return handle.heads() },
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a policy-enforcing repo facade for an LLMlin run.
 *
 * - URLs in readUrls  → read-only (throws on .change())
 * - URLs in writeUrls → full access
 * - Unknown URLs      → read-only by default
 */
export function createLLMlinRepo(
  repo: Repo,
  readUrls: AutomergeUrl[],
  writeUrls: AutomergeUrl[],
): LLMlinRepo {
  const readSet  = new Set<AutomergeUrl>(readUrls)
  const writeSet = new Set<AutomergeUrl>(writeUrls)

  return {
    async find(url: AutomergeUrl): Promise<HandleWrapper> {
      const handle = await repo.find(url)
      if (writeSet.has(url)) {
        return createFullAccessWrapper(handle)
      }
      // read set or unknown → read-only
      return createReadOnlyWrapper(handle)
    },

    create(): DocHandle<any> {
      return repo.create()
    },
  }
}
