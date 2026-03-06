/// <reference types="vite/client" />

declare module '*.css?inline' {
  const content: string
  export default content
}

// Provided by the patchwork runtime; externalized in vite.config.ts
declare module '@inkandswitch/patchwork-plugins' {
  interface PluginRegistry {
    load(id: string): Promise<unknown>
    get(id: string): unknown
    all(): unknown[]
    on(event: 'changed', cb: () => void): () => void
  }
  export function getRegistry(type: string): PluginRegistry
}

// Provided by the patchwork runtime; externalized in vite.config.ts
declare module '@automerge/automerge' {
  export function updateText(
    doc: unknown,
    path: string[],
    value: string
  ): void
}
