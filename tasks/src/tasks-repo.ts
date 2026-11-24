import { Repo } from '@automerge/automerge-repo/slim';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import { TASKS_DATABASE, TASKS_HEADS_CHANNEL } from './ids';
import { getRepoConfig } from './repo-config';

/**
 * This tab's member of the tasks Repo family (see ids.ts): an ordinary Repo on
 * the same database and save channel as the task workers' Repos.
 *
 * The queue browser reads and writes through it rather than through the site's
 * own Repo, and that is what makes the framework work with no network. A task
 * added here is in the shared database a moment later, where the router and
 * the workers find it; what they write back shows up here the same way. Going
 * through the site's Repo, every one of those steps would be a round trip to
 * the sync server.
 *
 * One a tab, made the first time it's asked for. It's on `window` as
 * `patchworkTasks.repo` so that other code that hands work to the framework
 * can use it too, and get the same offline behaviour.
 */
export function getTasksRepo(): Promise<Repo> {
  const tab = window as any;
  tab.patchworkTasks ??= {};
  tab.patchworkTasks.repo ??= Promise.resolve().then(createTasksRepo);
  return tab.patchworkTasks.repo;
}

function createTasksRepo() {
  // The site has already started automerge and subduction on this page. Like
  // the workers' Repos this one has no `signer`, so it is a peer of its own.
  return new Repo({
    storage: new IndexedDBStorageAdapter(TASKS_DATABASE),
    peerId: `task-tab-${Math.round(Math.random() * 1_000_000)}`,
    subductionWebsocketEndpoints: [getRepoConfig().syncServerUrl],
    headsChannel: TASKS_HEADS_CHANNEL,
    enableRemoteHeadsGossiping: true,
  } as any);
}
