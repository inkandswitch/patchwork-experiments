import type { RepoConfig } from './protocol';

// Patchwork doesn't say at runtime which sync server a site was built for, so
// this is the one its bootloader falls back to. A site on another server sets
// `localStorage.tasksSyncServerUrl`.
const DEFAULT_SYNC_SERVER_URL = 'wss://subduction.sync.inkandswitch.com';
const SYNC_SERVER_URL_KEY = 'tasksSyncServerUrl';

/** What a member of the tasks Repo family needs to be built: see webworker-lib.ts and tasks-repo.ts. */
export function getRepoConfig(): RepoConfig {
  return {
    syncServerUrl: localStorage.getItem(SYNC_SERVER_URL_KEY) || DEFAULT_SYNC_SERVER_URL,
  };
}
