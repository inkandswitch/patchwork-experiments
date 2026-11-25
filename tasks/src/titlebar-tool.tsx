import { createSignal, For, onCleanup, Show } from 'solid-js';
import { render } from 'solid-js/web';
import './index.css';
import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo/slim';
import type { OpenDocumentEventDetail } from '@inkandswitch/patchwork-elements';
import type { Queue } from './datatype';
import { getAccountDocUrl, getTaskQueues } from './helpers';
import { QUEUE_TOOL_ID } from './ids';
import { useDoc, WithTasksRepo } from './use-doc';
import { waitingWork } from './task-rules.js';
import { startPoolHost, type PoolHostStatus } from './browser/pool-host';

// The badge for each queue this account's browsers serve, and what starts
// this page's pool host (browser/pool-host.ts): wherever the badge is on
// screen, this browser serves its queues. It's offered two ways because
// frames differ in where they put such things. Threepane has a title bar it
// fills from a list on the account; the tiling frame has no title bar slots
// but shows every system-tray component there is. Both may be mounted in one
// page; there is still one pool host.

/** The badge as a title bar tool: threepane, once it's on the account's list. */
export const TitlebarTool = (_handle: DocHandle<unknown>, element: HTMLElement) =>
  mountTaskStatus(element, (element as any).repo);

/** The badge as a system-tray component: any frame with a tray. */
export const TaskTray = (element: HTMLElement, repo?: Repo) =>
  mountTaskStatus(element, repo ?? (element as any).repo ?? (window as any).repo);

function mountTaskStatus(element: HTMLElement, hostRepo: Repo) {
  const host = startPoolHost(hostRepo);
  return render(() => {
    const [pool, setPool] = createSignal(host.status());
    onCleanup(host.subscribe(setPool));
    return <TaskStatus element={element} hostRepo={hostRepo} pool={pool()} />;
  }, element);
}

/** What the badge says of this browser's pool, and the longer form for its tooltip. */
function poolWords(pool: PoolHostStatus): [string, string] {
  switch (pool.state) {
    case 'running':
    case 'starting':
      return [
        pool.busy > 0 ? `${pool.busy} running here` : 'served here',
        `This tab runs this browser's pool (${pool.name}): ${pool.busy} of ${pool.slots} slots busy.`,
      ];
    case 'waiting':
      return ['served by another tab', "Another tab of this browser runs its pool; this one takes over if that one closes."];
    case 'handing over':
      return ['finishing up', "A newer version of tasks is open in another tab: this tab's pool finishes what it is running and takes nothing new."];
    case 'stood down':
      return ['served by another tab', 'A newer version of tasks is open in another tab, and that tab serves the queues.'];
    case 'unavailable':
      return ['not served here', `This browser's pool is not running: ${pool.problem ?? 'it could not start'}.`];
  }
}

const TaskStatus = (props: { element: HTMLElement; hostRepo: Repo; pool: PoolHostStatus }) => {
  // The account is the site's document, so it comes from the site's Repo. The
  // queues come from this tab's tasks Repo (see tasks-repo.ts).
  const account = useDoc<any>(getAccountDocUrl, props.hostRepo);
  const queueUrls = () =>
    account() ? (Object.keys(getTaskQueues(account())) as AutomergeUrl[]) : [];

  return (
    <div class="task-titlebar-list">
      <WithTasksRepo>
        <For
          each={queueUrls()}
          fallback={
            // On no queue: say so, or the badge would just vanish.
            <Show when={account()}>
              <span
                class="task-titlebar task-titlebar--none"
                title="This browser serves no task queue. Open one and choose Join queue."
              >
                No task queues
              </span>
            </Show>
          }
        >
          {(taskQueueUrl) => (
            <QueueBadge element={props.element} taskQueueUrl={taskQueueUrl} pool={props.pool} />
          )}
        </For>
      </WithTasksRepo>
    </div>
  );
};

const QueueBadge = (props: { element: HTMLElement; taskQueueUrl: AutomergeUrl; pool: PoolHostStatus }) => {
  const queue = useDoc<Queue>(() => props.taskQueueUrl);
  return (
    <Show when={queue()}>
      {(doc) => {
        const name = () => doc().title ?? 'Tasks';
        // what the queue lists: tasks that have not ended
        const listed = () => waitingWork(doc()).length;
        const words = () => poolWords(props.pool);
        return (
          <button
            class="task-titlebar"
            classList={{ 'task-titlebar--busy': listed() > 0 }}
            data-pool-state={props.pool.state}
            title={`${name()}: ${listed()} listed. ${words()[1]}`}
            onClick={() =>
              props.element.dispatchEvent(
                createOpenEvent({ url: props.taskQueueUrl, toolId: QUEUE_TOOL_ID }),
              )
            }
          >
            <span class="task-titlebar-dot" />
            <span class="task-titlebar-name">{name()}</span>
            <span class="task-titlebar-count">
              {listed()} listed · {words()[0]}
            </span>
          </button>
        );
      }}
    </Show>
  );
};

function createOpenEvent(detail: OpenDocumentEventDetail) {
  const openEvent = new CustomEvent('patchwork:open-document', {
    detail,
    bubbles: true,
    composed: true,
  });
  return openEvent;
}
