import type { Repo, DocHandle } from '@automerge/automerge-repo'

declare module '@inkandswitch/patchwork-plugins' {
  type DatatypeModule = {
    init(doc: unknown, repo: Repo): void
    getTitle(doc: unknown): string
    setTitle?(doc: unknown, title: string): void
  }

  type LoadedDatatypePlugin = {
    id: string
    name: string
    importUrl?: string
    module: DatatypeModule
  }

  function createDocOfDatatype2(
    datatype: LoadedDatatypePlugin,
    repo: Repo,
    change?: (doc: unknown) => void
  ): Promise<DocHandle<unknown>>
}
