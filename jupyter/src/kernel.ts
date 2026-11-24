import type { Repo } from "@automerge/automerge-repo"
import type { KernelBridge } from "../extension/src/bridge"

const DEFAULT_STORAGE_PREFIX = "patchwork"
const DEFAULT_SYNC_SERVER = "wss://subduction.sync.inkandswitch.com"
const MODULE_URL = new URL(/* @vite-ignore */ "./pyfs/pyfs.js", import.meta.url).href

/**
 * Patchwork bakes its storage prefix and sync server into the site build
 * rather than exposing them, so recover them from what the page does show:
 * tab peer ids are `<prefix>-tab-<uuid>` and the sync server is preconnected.
 */
export function kernelConfig(repo: Repo): KernelBridge {
  return { moduleUrl: MODULE_URL, storagePrefix: storagePrefix(repo), syncServer: syncServer() }
}

function storagePrefix(repo: Repo): string {
  const match = /^(.+)-tab-[0-9a-f-]{36}$/.exec(String(repo.peerId))
  return match?.[1] ?? DEFAULT_STORAGE_PREFIX
}

function syncServer(): string {
  const link = document.querySelector<HTMLLinkElement>('link[rel="preconnect"]')
  return link ? link.href.replace(/^http/, "ws").replace(/\/$/, "") : DEFAULT_SYNC_SERVER
}
