import { createSignal, For, onCleanup, Show } from 'solid-js';
import { render } from 'solid-js/web';
import './index.css';
import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo/slim';
import type { Queue } from './datatype';
import { served, type Serving } from './task-client.js';
import {
  getAccountDocUrl,
  getAcceptance,
  isOnTaskQueue,
  joinTaskQueue,
  leaveTaskQueue,
  setAcceptance,
} from './helpers';
import type { Acceptance } from './acceptance';
import { useHandle, useHandleDoc, useHandleDocWhenThere, useRepo, WithTasksRepo } from './use-doc';
import { AcceptanceChoice, JobsSection } from './jobs-view';

// A queue, as a person sees it: what it lists, how each task stands, which
// pools are heard serving it, and whether this account's browsers serve it.
//
// The site hands this tool a handle from its own Repo. Only the url is used:
// everything here goes through this tab's tasks Repo instead (see
// tasks-repo.ts), which is what lets it keep working without a network.
export const TaskQueueTool = (handle: DocHandle<unknown>, element: HTMLElement) =>
  render(
    () => (
      <WithTasksRepo fallback={<div class="tq tq-loading">Starting…</div>}>
        <TaskQueue url={handle.url} hostRepo={(element as any).repo} />
      </WithTasksRepo>
    ),
    element,
  );

const TaskQueue = (props: { url: AutomergeUrl; hostRepo: Repo }) => {
  const handle = useHandle<Queue>(() => props.url);
  return (
    <Show when={handle()} fallback={<div class="tq tq-loading">Waiting for this queue…</div>}>
      {(ready) => <TaskQueueBrowser handle={ready()} hostRepo={props.hostRepo} />}
    </Show>
  );
};

/**
 * Whether this account's browsers serve a queue, and how to change that.
 *
 * The list of queues is on the account, which is the site's document, so it's
 * read and written through the site's Repo and not the tasks one.
 */
function useMembership(queueUrl: AutomergeUrl, hostRepo: Repo) {
  const accountHandle = useHandle<any>(getAccountDocUrl, hostRepo);
  const account = useHandleDocWhenThere(accountHandle);
  return {
    /** False until the account has loaded; before that there's nothing to say. */
    known: () => !!account(),
    joined: () => isOnTaskQueue(account(), queueUrl),
    join: () => accountHandle()?.change((doc: any) => joinTaskQueue(doc, queueUrl)),
    leave: () => accountHandle()?.change((doc: any) => leaveTaskQueue(doc, queueUrl)),
    /** Whose code this account's browsers run from the queue (see acceptance.ts). */
    acceptance: () => getAcceptance(account(), queueUrl),
    accept: (acceptance: Acceptance) =>
      accountHandle()?.change((doc: any) => setAcceptance(doc, queueUrl, acceptance)),
  };
}

const TaskQueueBrowser = (props: { handle: DocHandle<Queue>; hostRepo: Repo }) => {
  const repo = useRepo();
  const queue = useHandleDoc(props.handle);
  const membership = useMembership(props.handle.url, props.hostRepo);
  const [pools, setPools] = createSignal<Serving[]>([]);
  onCleanup(served(repo, props.handle.url, setPools));

  return (
    <div class="tq">
      <div class="tq-page">
        <header class="tq-header">
          <h1 class="tq-title">{queue().title ?? 'Task queue'}</h1>
          <div class="tq-stats">
            <Stat value={Object.keys(queue().jobs ?? {}).length} label="listed" />
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
            <ul class="tq-logs">
              <For each={pools()}>
                {(pool) => (
                  <li>
                    {pool.name || pool.pool.slice(0, 8)}{' '}
                    <span class="tq-muted">
                      {pool.busy} of {pool.slots} slot{pool.slots === 1 ? '' : 's'} busy
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>

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

        <JobsSection handle={props.handle} queue={queue()} />
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
