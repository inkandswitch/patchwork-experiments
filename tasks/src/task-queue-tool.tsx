import { createSignal, For, onCleanup, Show } from 'solid-js';
import { render } from 'solid-js/web';
import './index.css';
import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo/slim';
import type { Queue } from './datatype';
import { ownQueueOf, served, storageUrlOf, tasksStorage, type Serving, type TasksStorage } from './task-client.js';
import { waitingWork } from './task-rules.js';
import {
  getAccountDocUrl,
  getAcceptance,
  isOnTaskQueue,
  joinTaskQueue,
  leaveTaskQueue,
  setAcceptance,
} from './helpers';
import type { Acceptance } from './acceptance';
import { useDoc, useHandle, useHandleDoc, useRepo, WithTasksRepo } from './use-doc';
import { AcceptanceChoice, JobsSection } from './jobs-view';
import { readBrowserPoolId } from './browser/pool-id';

// A queue, as a person sees it: what it lists, how each task stands, which
// pools are heard serving it (this browser's marked), whether this
// person's browsers serve it, and whether it is their own queue.
//
// The site hands this tool a handle from its own Repo. Only the url is used:
// everything here goes through this tab's tasks Repo instead (see
// tasks-repo.ts), which is what lets it keep working without a network.
export const TaskQueueTool = (handle: DocHandle<unknown>, element: HTMLElement) =>
  render(
    () => (
      <WithTasksRepo fallback={<div class="tq tq-loading">Starting…</div>}>
        <TaskQueue url={handle.url} hostRepo={(element as any).repo} element={element} />
      </WithTasksRepo>
    ),
    element,
  );

const TaskQueue = (props: { url: AutomergeUrl; hostRepo: Repo; element: HTMLElement }) => {
  const handle = useHandle<Queue>(() => props.url);
  return (
    <Show when={handle()} fallback={<div class="tq tq-loading">Waiting for this queue…</div>}>
      {(ready) => <TaskQueueBrowser handle={ready()} hostRepo={props.hostRepo} element={props.element} />}
    </Show>
  );
};

/**
 * Whether this person's browsers serve a queue, and how to change that.
 *
 * The list of queues is in the task system's tool storage on the account
 * (see helpers.ts), which is the site's, so it's read and written through the
 * site's Repo and not the tasks one. Only looking makes nothing; the first
 * change asks the frame for the storage document, from `element`, and a
 * frame that has none to give is said so to the person.
 */
function useMembership(queueUrl: AutomergeUrl, hostRepo: Repo, element: HTMLElement) {
  const account = useDoc<unknown>(getAccountDocUrl, hostRepo);
  const storageUrl = () => storageUrlOf(account()) as AutomergeUrl | null;
  const storage = useDoc<TasksStorage>(storageUrl, hostRepo);
  const [problem, setProblem] = createSignal<string | null>(null);
  const change = (fn: (doc: TasksStorage) => void) => {
    setProblem(null);
    tasksStorage(hostRepo, element).then(
      (handle) => handle.change(fn),
      (error: Error) => setProblem(error.message),
    );
  };
  return {
    /** False until the account, and the storage document it names if any, have loaded: before that there's nothing to say. */
    known: () => !!account() && (!storageUrl() || !!storage()),
    joined: () => isOnTaskQueue(storage(), queueUrl),
    /** Whether this is the person's own queue (see `ownQueue` in task-client.js). */
    own: () => ownQueueOf(storage()) === queueUrl,
    join: () => change((doc) => joinTaskQueue(doc, queueUrl)),
    leave: () => change((doc) => leaveTaskQueue(doc, queueUrl)),
    /** Whose code this person's browsers run from the queue (see acceptance.ts). */
    acceptance: () => getAcceptance(storage(), queueUrl),
    accept: (acceptance: Acceptance) => change((doc) => setAcceptance(doc, queueUrl, acceptance)),
    /** Why the last change could not be made, for the person. */
    problem,
  };
}

const TaskQueueBrowser = (props: { handle: DocHandle<Queue>; hostRepo: Repo; element: HTMLElement }) => {
  const repo = useRepo();
  const queue = useHandleDoc(props.handle);
  const membership = useMembership(props.handle.url, props.hostRepo, props.element);
  const [pools, setPools] = createSignal<Serving[]>([]);
  onCleanup(served(repo, props.handle.url, setPools));
  const mine = readBrowserPoolId();

  return (
    <div class="tq">
      <div class="tq-page">
        <header class="tq-header">
          <h1 class="tq-title">
            {queue().title ?? 'Task queue'}
            <Show when={membership.own()}>
              {' '}
              <span class="tq-tag tq-own">your queue</span>
            </Show>
          </h1>
          <div class="tq-stats">
            <Stat value={waitingWork(queue()).length} label="listed" />
            <Stat value={pools().length} label={pools().length === 1 ? 'pool' : 'pools'} />
          </div>
        </header>

        <section class="tq-section">
          <h2 class="tq-section-title">
            Serving it <span class="tq-count">{pools().length}</span>
          </h2>
          <Show
            when={pools().length > 0}
            fallback={<p class="tq-empty">No pool is heard serving this queue: what is asked of it waits.</p>}
          >
            <ul class="tq-runs">
              <For each={pools()}>
                {(pool) => (
                  <li class="tq-run-line">
                    {pool.name || pool.pool.slice(0, 8)}
                    <Show when={pool.pool === mine}>
                      <span class="tq-tag">this browser</span>
                    </Show>
                    <span class="tq-muted">
                      {pool.busy} of {pool.slots} slot{pool.slots === 1 ? '' : 's'} busy
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>

        <Show when={membership.problem()}>
          <p class="tq-error">{membership.problem()}</p>
        </Show>

        <Show when={membership.known()}>
          <Show
            when={membership.joined()}
            fallback={
              <div class="tq-callout">
                <div class="tq-callout-text">
                  <strong>This browser doesn't serve this queue.</strong>
                  <span>Joining lends the queue this browser's pool.</span>
                </div>
                <button class="tq-button" onClick={membership.join}>
                  Join queue
                </button>
              </div>
            }
          >
            <AcceptanceChoice acceptance={membership.acceptance()} onChange={membership.accept} />
            <p class="tq-choice-note">
              <button class="tq-link" onClick={membership.leave}>
                Leave this queue
              </button>
            </p>
          </Show>
        </Show>

        <JobsSection handle={props.handle} queue={queue()} pools={pools()} mine={mine} />
      </div>
    </div>
  );
};

const Stat = (props: { value: number; label: string }) => (
  <div class="tq-stat">
    <span class="tq-stat-value">{props.value.toLocaleString()}</span>
    <span class="tq-stat-label">{props.label}</span>
  </div>
);
