/// <reference types="vite/client" />

interface Window {
  accountDocHandle?: { doc(): { contactUrl: string } | undefined }
}

declare module '*.css?inline' {
  const content: string
  export default content
}

declare module '@inkandswitch/patchwork-plugins' {
  export interface PluginDescription {
    id: string
    type: string
    name: string
    icon?: string
    tags?: string[]
    [key: string]: unknown
  }

  export interface LoadedPlugin<D extends PluginDescription, I> extends PluginDescription {
    module: I
  }

  export interface PluginRegistry<D extends PluginDescription, I = any> {
    all(): D[]
    filter(fn: (plugin: D) => boolean): D[]
    load(id: string): Promise<LoadedPlugin<D, I> | undefined>
    on(event: string, callback: (...args: any[]) => void): () => void
    off(event: string, callback: (...args: any[]) => void): void
  }

  export function getRegistry<D extends PluginDescription>(type: string): PluginRegistry<D>
  export function registerPlugins(plugins: PluginDescription[], importUrl: string): void
}
