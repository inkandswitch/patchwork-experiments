import { createSignal, For, onCleanup, Show } from 'solid-js';
import { render } from 'solid-js/web';
import './index.css';
import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo/slim';
import type { OpenDocumentEventDetail } from '@inkandswitch/patchwork-elements';
import type { Queue } from './datatype';
import { getAccountDocUrl, getTaskQueues } from './helpers';
import { ownQueue, ownQueueOf, storageUrlOf, type TasksStorage } from './task-client.js';
import { QUEUE_TOOL_ID } from './ids';
import { useDoc, WithTasksRepo } from './use-doc';
import { waitingWork } from './task-rules.js';
import { watchPoolHost, NOT_STARTED, type PoolHostStatus } from './browser/pool-host';
import { poolWords } from './pool-words';

// The badge for each queue this person's browsers serve: how many tasks it
// lists, and what this browser's pool is doing (read from this page's pool
// host, browser/pool-host.ts, which the badge watches and never starts: the
// frame's background component starts it). Where the person has no queue of
// their own being served, it offers one: to make it, or, if they left it, to
// open it, where it can be joined again. It's offered two ways because
// frames differ in where they put such things. Threepane has a title bar it
// fills from a list on the account; the tiling frame has no title bar slots
// but shows every system-tray component there is.

/** The badge as a title bar tool: threepane, once it's on the account's list. */
export const TitlebarTool = (_handle: DocHandle<unknown>, element: HTMLElement) =>
  mountTaskStatus(element, (element as any).repo);

/** The badge as a system-tray component: any frame with a tray. */
export const TaskTray = (element: HTMLElement, repo?: Repo) =>
  mountTaskStatus(element, repo ?? (element as any).repo ?? (window as any).repo);

function mountTaskStatus(element: HTMLElement, hostRepo: Repo) {
  return render(() => {
    const [pool, setPool] = createSignal<PoolHostStatus>(NOT_STARTED);
    onCleanup(watchPoolHost(setPool));
    return <TaskStatus element={element} hostRepo={hostRepo} pool={pool()} />;
  }, element);
}

const TaskStatus = (props: { element: HTMLElement; hostRepo: Repo; pool: PoolHostStatus }) => {
  // The account and the task storage it names are the site's documents, so
  // they come from the site's Repo. The queues come from this tab's tasks
  // Repo (see tasks-repo.ts).
  const account = useDoc<unknown>(getAccountDocUrl, props.hostRepo);
  const storageUrl = () => storageUrlOf(account()) as AutomergeUrl | null;
  const storage = useDoc<TasksStorage>(storageUrl, props.hostRepo);
  /** Whether what is served is known: the account has loaded, and the storage it names, if any. */
  const known = () => !!account() && (!storageUrl() || !!storage());
  const queueUrls = () => Object.keys(getTaskQueues(storage())) as AutomergeUrl[];
  const own = () => ownQueueOf(storage()) as AutomergeUrl | null;

  const [making, setMaking] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const makeOwn = () => {
    setMaking(true);
    setProblem(null);
    ownQueue(props.hostRepo, props.element).then(
      () => setMaking(false),
      (error: Error) => {
        setMaking(false);
        setProblem(error.message);
      },
    );
  };
  const open = (url: AutomergeUrl) =>
    props.element.dispatchEvent(createOpenEvent({ url, toolId: QUEUE_TOOL_ID }));

  return (
    <div class="task-titlebar-list">
      <WithTasksRepo>
        <For
          each={queueUrls()}
          fallback={
            // On no queue: say so, or the badge would just vanish.
            <Show when={known()}>
              <span
                class="task-titlebar task-titlebar--none"
                title="This browser serves no task queue. Make one of your own, or open a queue and choose Join queue."
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
      <Show when={known() && !(own() && queueUrls().includes(own()!))}>
        <Show
          when={own()}
          fallback={
            <button
              class="task-titlebar task-titlebar--offer"
              data-offer="make"
              disabled={making()}
              title="Make a task queue of your own, which this browser serves for any code"
              onClick={makeOwn}
            >
              {making() ? 'Making your queue…' : 'Make my queue'}
            </button>
          }
        >
          {(url) => (
            <button
              class="task-titlebar task-titlebar--offer"
              data-offer="open"
              title="Your own task queue is not served here. Open it to join it again."
              onClick={() => open(url())}
            >
              My queue
            </button>
          )}
        </Show>
      </Show>
      <Show when={problem()}>
        <span class="task-titlebar task-titlebar--problem" role="alert">
          {problem()}
        </span>
      </Show>
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
            title={`${name()}: ${listed()} listed. ${words().long}`}
            onClick={() =>
              props.element.dispatchEvent(
                createOpenEvent({ url: props.taskQueueUrl, toolId: QUEUE_TOOL_ID }),
              )
            }
          >
            <span class="task-titlebar-dot" />
            <span class="task-titlebar-name">{name()}</span>
            <span class="task-titlebar-count">
              {listed()} listed · {words().short}
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
