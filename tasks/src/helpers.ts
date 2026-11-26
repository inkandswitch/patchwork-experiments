import { getConflicts } from '@automerge/automerge/slim';
import type { AutomergeUrl } from '@automerge/automerge-repo/slim';
import { acceptanceOf, type Acceptance, type QueueSetting } from './acceptance';
import {
  TASKS_STORAGE_ID,
  findWhenThere,
  markOf,
  marksOf,
  ownQueueOf,
  servedOf,
  setServed,
  storageUrlOf,
  type TasksStorage,
} from './task-client.js';

// The queues this person's browsers serve live in the task system's tool
// storage on their account (see `tasksStorage` in task-client.js, which also
// says how that document is shaped and why). These read and write it only
// through task-client.js's `servedOf` and `setServed`. Reading takes whatever
// the account names, or nothing; the first write goes through `tasksStorage`,
// which asks the frame to make the document.

/**
 * The url of the account open on this page. The frame's tool-storage
 * provider writes to the account whose handle the site sets on the page, so
 * that one comes first; the others are where a site without it says which
 * account is open.
 */
export function getAccountDocUrl(): AutomergeUrl {
  return (
    (globalThis as any).accountDocHandle?.url ??
    (window as any).patchwork?.account?.url ??
    (localStorage.getItem('tinyPatchworkAccountUrl') as AutomergeUrl)
  );
}

export type TaskQueues = { [taskQueueUrl: AutomergeUrl]: QueueSetting };

/** The queues this person's browsers lend their workers to, from the task storage document, each with a setting that serves it. No document serves none. */
export function getTaskQueues(storage: unknown): TaskQueues {
  const queues: TaskQueues = {};
  for (const [url, setting] of Object.entries(servedOf(storage))) {
    if (acceptanceOf(setting) !== undefined) {
      queues[url as AutomergeUrl] = setting as QueueSetting;
    }
  }
  return queues;
}

export function isOnTaskQueue(storage: unknown, taskQueueUrl: AutomergeUrl) {
  return getAcceptance(storage, taskQueueUrl) !== undefined;
}

/** Serves a queue for any code, unless it is served already (when its setting stands). Call it inside a change to the storage document. */
export function joinTaskQueue(storage: TasksStorage, taskQueueUrl: AutomergeUrl) {
  if (!isOnTaskQueue(storage, taskQueueUrl)) {
    setServed(storage, taskQueueUrl, true);
  }
}

/** Whose code this person's browsers run from a queue they serve (see acceptance.ts). */
export function getAcceptance(storage: unknown, taskQueueUrl: AutomergeUrl): Acceptance | undefined {
  const served = servedOf(storage);
  return Object.hasOwn(served, taskQueueUrl) ? acceptanceOf(served[taskQueueUrl]) : undefined;
}

/**
 * Says whose code this person's browsers run from a queue: any, or only
 * what is in these packages. Call it inside a change to the storage document.
 */
export function setAcceptance(storage: TasksStorage, taskQueueUrl: AutomergeUrl, acceptance: Acceptance) {
  setServed(storage, taskQueueUrl, acceptance === 'any' ? true : { packages: [...acceptance] });
}

/** Stops serving a queue. Call it inside a change to the storage document. */
export function leaveTaskQueue(storage: TasksStorage, taskQueueUrl: AutomergeUrl) {
  setServed(storage, taskQueueUrl, null);
}

// Two storage documents
//
// The frame's provider makes the task storage the first time a tool asks for
// it, and links it into the account. Two pages that both found none make two,
// and the account keeps one: two links written into `toolStorage` at once, or
// two `toolStorage` maps written at once, each with a link of its own. The
// links that lost are still there, as conflicts, on every replica that has
// both changes. What a losing document lists is moved into the winner.

/**
 * The values written at once under `key` of an Automerge object, as
 * Automerge keeps them: none where there was only one (Automerge reports no
 * conflict then; the one is the object's own value), or where the object is
 * no Automerge object.
 */
function conflictsOf(object: unknown, key: string): unknown[] {
  try {
    return Object.values((getConflicts(object as any, key) as Record<string, unknown> | undefined) ?? {});
  } catch {
    return [];
  }
}

/**
 * The task storage documents an account linked that lost to the one it
 * names (`storageUrlOf`), in the order of their urls: every link under
 * `toolStorage['tasks-next']` that conflicts with it, in every `toolStorage`
 * map that conflicts with the one that stands. A pure function of the account.
 */
export function storageLosersOf(account: unknown): AutomergeUrl[] {
  const winner = storageUrlOf(account);
  if (!winner) {
    return [];
  }
  const found = new Set<string>();
  for (const map of [(account as any)?.toolStorage, ...conflictsOf(account, 'toolStorage')]) {
    for (const url of [...conflictsOf(map, TASKS_STORAGE_ID), (map as any)?.[TASKS_STORAGE_ID]]) {
      if (typeof url === 'string' && url.startsWith('automerge:') && url !== winner) {
        found.add(url);
      }
    }
  }
  return [...found].sort() as AutomergeUrl[];
}

/**
 * Moves what each losing storage document lists into the winner, once each
 * is had (see `storageLosersOf`). For each loser, in one change to the
 * winner: each mark the winner lacks, `own` only if the winner has none
 * (a write by a replica that sees none, as `ownQueue`'s), and each served
 * queue the winner lacks, with its setting. Then, in one change to the loser,
 * every served queue the winner now has is deleted from it, so a queue left
 * in the winner later is not served again by the next merge. Marks and `own`
 * stay in the loser, for replicas that still read it. The loser's own is a
 * spare in the winner from then on, and is folded like any other. A second
 * merge changes nothing. `repo` is the Repo the account is in.
 */
export async function mergeStorages(repo: any, account: unknown): Promise<void> {
  const winnerUrl = storageUrlOf(account);
  const losers = storageLosersOf(account);
  if (!winnerUrl || losers.length === 0) {
    return;
  }
  const winner = await findWhenThere(repo, winnerUrl);
  for (const url of losers) {
    const loser = await findWhenThere(repo, url).catch(() => null);
    const from = loser?.doc();
    if (!from) {
      continue; // a later merge tries again
    }
    const served = getTaskQueues(from);
    const marks = marksOf(from);
    const own = ownQueueOf(from);
    const lacking = (doc: unknown, key: string) => !Object.hasOwn(doc as object, key);
    const into = winner.doc();
    if (marks.some((queue) => lacking(into, markOf(queue))) || (own && !ownQueueOf(into)) || Object.keys(served).some((queue) => lacking(into, queue))) {
      winner.change((doc: TasksStorage) => {
        for (const queue of marks) {
          if (lacking(doc, markOf(queue))) {
            doc[markOf(queue)] = true;
          }
        }
        if (own && !ownQueueOf(doc)) {
          doc.own = own;
        }
        for (const [queue, setting] of Object.entries(served)) {
          if (lacking(doc, queue)) {
            setServed(doc, queue, setting === true ? true : { packages: [...(setting as { packages: string[] }).packages] });
          }
        }
      });
    }
    const moved = Object.keys(servedOf(from)).filter((queue) => !lacking(winner.doc(), queue));
    if (moved.length > 0) {
      loser.change((doc: TasksStorage) => {
        for (const queue of moved) {
          setServed(doc, queue, null);
        }
      });
    }
  }
}
