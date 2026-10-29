/**
 * Automerge repo plumbing: a repo connected to the Patchwork sync server, fetching documents and confirming that
 * changes reached the server. Same setup as pushwork's openRepo / waitForServerSync.
 */
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type AutomergeUrl,
  type DocHandle,
  initSubduction,
  Repo,
  setLoggerFactory,
  setSubductionLogLevel,
} from "@automerge/automerge-repo";
import { LMDBStorageAdapter } from "@automerge/automerge-repo-storage-lmdb";

const SYNC_SERVER = process.env.PATCHWORK_SYNC_SERVER ?? "wss://subduction.sync.inkandswitch.com";
const PATCHWORK_APP = process.env.PATCHWORK_APP ?? "https://patchwork.inkandswitch.com";
const STORAGE_DIR = path.join(os.homedir(), ".cache", "stock-flow-cli");

export function patchworkLink(url: string): string {
  return `${PATCHWORK_APP}/#doc=${url}`;
}

export async function openRepo(): Promise<Repo> {
  await mkdir(STORAGE_DIR, { recursive: true });
  quietLogs();
  await initSubduction();
  const repo = new Repo({
    storage: new LMDBStorageAdapter(path.join(STORAGE_DIR, "storage.lmdb")),
    network: [],
    subductionWebsocketEndpoints: [SYNC_SERVER],
  });
  if (!process.env.DEBUG) {
    try {
      setSubductionLogLevel("error");
    } catch {
      // older subduction builds have no setter
    }
  }
  return repo;
}

export async function findDoc<T>(repo: Repo, url: string, timeoutMs = 30_000): Promise<DocHandle<T>> {
  if (!url.startsWith("automerge:")) throw new Error(`Expected an automerge: URL, got "${url}"`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out fetching ${url} from ${SYNC_SERVER} after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    return await Promise.race([repo.find<T>(url as AutomergeUrl), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** True once the server has advertised our heads back and we hold everything it advertised. */
export async function waitForServerSync(repo: Repo, handle: DocHandle<unknown>, maxMs = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (repo.isSubductionConnected()) {
      const [serverPeerId] = await repo.connectedSubductionPeerIds();
      const info = serverPeerId ? handle.getSyncInfo(serverPeerId as never) : undefined;
      if (info && info.lastHeads.length > 0) {
        const advertised = new Set<string>(info.lastHeads);
        const frontier = [...(handle.heads() ?? [])] as string[];
        if (frontier.length > 0 && frontier.every((head) => advertised.has(head)) && handle.containsHeads(info.lastHeads as never)) {
          return true;
        }
      }
    }
    await sleep(250);
  }
  return false;
}

export async function closeRepo(repo: Repo): Promise<void> {
  await Promise.race([repo.shutdown().catch(() => {}), sleep(10_000)]);
}

function quietLogs(): void {
  if (process.env.DEBUG) return;
  const silent = () => {};
  setLoggerFactory(() => ({ debug: silent, info: silent, warn: silent, error: silent }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
