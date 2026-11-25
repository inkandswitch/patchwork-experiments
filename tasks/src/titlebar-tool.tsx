import { For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import './index.css';
import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo/slim';
import type { OpenDocumentEventDetail } from '@inkandswitch/patchwork-elements';
import type { Queue } from './datatype';
import { getAccountDocUrl, getTaskQueues } from './helpers';
import { QUEUE_TOOL_ID } from './ids';
import { useDoc, WithTasksRepo } from './use-doc';
import { waitingWork } from './task-rules.js';

// The badge for each queue this account's browsers serve. It's offered two
// ways because frames differ in where they put such things. Threepane has a
// title bar it fills from a list on the account; the tiling frame has no
// title bar slots but shows every system-tray component there is.
// It starts no pool for now: the browser's pool comes with the next step.

/** The badge as a title bar tool: threepane, once it's on the account's list. */
export const TitlebarTool = (_handle: DocHandle<unknown>, element: HTMLElement) =>
  mountTaskStatus(element, (element as any).repo);

/** The badge as a system-tray component: any frame with a tray. */
export const TaskTray = (element: HTMLElement, repo?: Repo) =>
  mountTaskStatus(element, repo ?? (element as any).repo ?? (window as any).repo);

function mountTaskStatus(element: HTMLElement, hostRepo: Repo) {
  return render(() => <TaskStatus element={element} hostRepo={hostRepo} />, element);
}

const TaskStatus = (props: { element: HTMLElement; hostRepo: Repo }) => {
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
          {(taskQueueUrl) => <QueueBadge element={props.element} taskQueueUrl={taskQueueUrl} />}
        </For>
      </WithTasksRepo>
    </div>
  );
};

const QueueBadge = (props: { element: HTMLElement; taskQueueUrl: AutomergeUrl }) => {
  const queue = useDoc<Queue>(() => props.taskQueueUrl);
  return (
    <Show when={queue()}>
      {(doc) => {
        const name = () => doc().title ?? 'Tasks';
        // what the queue lists: tasks that have not ended
        const listed = () => waitingWork(doc()).length;
        return (
          <button
            class="task-titlebar"
            classList={{ 'task-titlebar--busy': listed() > 0 }}
            title={`${name()}: ${listed()} listed`}
            // Name the tool: a queue made by the older copy would otherwise open in the older browser.
            onClick={() =>
              props.element.dispatchEvent(
                createOpenEvent({ url: props.taskQueueUrl, toolId: QUEUE_TOOL_ID }),
              )
            }
          >
            <span class="task-titlebar-dot" />
            <span class="task-titlebar-name">{name()}</span>
            <span class="task-titlebar-count">{listed()} listed</span>
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
