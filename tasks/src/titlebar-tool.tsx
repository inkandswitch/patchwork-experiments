import { createSignal, ErrorBoundary, For, onCleanup, Show } from 'solid-js';
import { render } from 'solid-js/web';
import './index.css';
import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo/slim';
import type { OpenDocumentEventDetail } from '@inkandswitch/patchwork-elements';
import type { Queue } from './datatype';
import { getAccountDocUrl, getTaskQueues } from './helpers';
import { ownQueue, ownQueueOf, storageUrlOf, type TasksStorage } from './task-client.js';
import { QUEUE_TOOL_ID } from './ids';
import { useDocSignal } from '@automerge/automerge-repo-solid-primitives';
import { waitingWork } from './task-rules.js';
import { watchPoolHost, NOT_STARTED, type PoolHostStatus } from './browser/pool-host';
import { poolWords } from './pool-words';

// The badge for each queue this person's browsers serve: how many tasks it
// lists, and what this browser's pool is doing (read from this page's pool
// host, browser/pool-host.ts, which the badge watches and never starts: the
// frame's background component starts it). Mounted, it asks for the person's
// own queue (`ownQueue`), which makes it if there is none: nobody presses
// anything. While that is being made it says so, and where the page has
// nowhere to keep it, it says that. A person who left their own queue is
// offered to open it, where it can be joined again. It's offered two ways
// because frames differ in where they put such things. Threepane has a title
// bar it fills from a list on the account; the tiling frame has no title bar
// slots but shows every system-tray component there is.

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
    // A document not yet found is asked for again every 2 s, as it was before.
    return (
      <ErrorBoundary fallback={(_, reset) => (setTimeout(reset, 2000), null)}>
        <TaskStatus element={element} hostRepo={hostRepo} pool={pool()} />
      </ErrorBoundary>
    );
  }, element);
}

const TaskStatus = (props: { element: HTMLElement; hostRepo: Repo; pool: PoolHostStatus }) => {
  const [account] = useDocSignal<object>(getAccountDocUrl, { repo: props.hostRepo });
  const storageUrl = () => (storageUrlOf(account()) as AutomergeUrl | null) ?? undefined;
  const [storage] = useDocSignal<TasksStorage>(storageUrl, { repo: props.hostRepo });
  /** Whether what is served is known: the account has loaded, and the storage it names, if any. */
  const known = () => !!account() && (!storageUrl() || !!storage());
  const queueUrls = () => Object.keys(getTaskQueues(storage())) as AutomergeUrl[];
  const own = () => ownQueueOf(storage()) as AutomergeUrl | null;

  const [making, setMaking] = createSignal(true);
  const [problem, setProblem] = createSignal<string | null>(null);
  ownQueue(props.hostRepo, props.element).then(
    () => setMaking(false),
    (error: Error) => {
      setMaking(false);
      setProblem(error.message);
    },
  );
  const open = (url: AutomergeUrl) =>
    props.element.dispatchEvent(createOpenEvent({ url, toolId: QUEUE_TOOL_ID }));

  return (
    <div class="task-titlebar-list">
      <For
        each={queueUrls()}
        fallback={
          <Show when={making()}>
            <span class="task-titlebar task-titlebar--none">Making your queue…</span>
          </Show>
        }
      >
        {(taskQueueUrl) => (
          <QueueBadge element={props.element} hostRepo={props.hostRepo} taskQueueUrl={taskQueueUrl} pool={props.pool} />
        )}
      </For>
      <Show when={known() && own() && !queueUrls().includes(own()!)}>
        <button
          class="task-titlebar task-titlebar--offer"
          data-offer="open"
          title="Your own task queue is not served here. Open it to join it again."
          onClick={() => open(own()!)}
        >
          My queue
        </button>
      </Show>
      <Show when={problem()}>
        <span class="task-titlebar task-titlebar--problem" role="alert">
          {problem()}
        </span>
      </Show>
    </div>
  );
};

const QueueBadge = (props: { element: HTMLElement; hostRepo: Repo; taskQueueUrl: AutomergeUrl; pool: PoolHostStatus }) => {
  const [queue] = useDocSignal<Queue>(() => props.taskQueueUrl, { repo: props.hostRepo });
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
