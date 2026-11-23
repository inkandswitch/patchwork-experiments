import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import { render } from 'solid-js/web';
import './index.css';
import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo/slim';
import type { OpenDocumentEventDetail } from '@inkandswitch/patchwork-elements';
import type { TaskQueueDoc } from './datatype';
import { ensureWorkers, needsReload, NEEDS_RELOAD_EVENT } from './worker-handover';
import { getAccountDocUrl, getTaskQueues } from './helpers';
import { QUEUE_TOOL_ID } from './ids';
import { useDoc, WithTasksRepo } from './use-doc';
import { AVAILABILITY_CHANNEL, type AvailabilityStatus } from './availability';

// A shared worker's script has to come from the page's own origin. Installed by
// its automerge url this package is served from there; installed from a web
// bundle on another host it isn't, and its workers could never start.
const SAME_ORIGIN = new URL(import.meta.url).origin === location.origin;

// The badge for each queue this user contributes to, and the thing that starts
// this browser's task workers: wherever it's on screen, the workers are running.
// It's offered two ways because frames differ in where they put such things.
// Threepane has a title bar it fills from a list on the account; the tiling
// frame has no title bar slots but shows every system-tray component there is.

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
  // queues come from this tab's tasks Repo, like everything else of the
  // framework's (see tasks-repo.ts).
  const account = useDoc<any>(getAccountDocUrl, props.hostRepo);
  const contactUrl = (): AutomergeUrl | undefined => account()?.contactUrl;
  const queueUrls = () =>
    account() ? (Object.keys(getTaskQueues(account())) as AutomergeUrl[]) : [];

  createEffect(() => {
    const mine = contactUrl();
    if (!mine) {
      return;
    }
    if (SAME_ORIGIN) {
      ensureWorkers(mine);
    } else {
      console.error(
        `tasks: loaded from ${new URL(import.meta.url).origin}, so its shared workers can't start on ${location.origin}. Install it by its automerge: url instead.`,
      );
    }
  });

  // A newer build of this package is running in another tab, and this one is
  // too old to join it (see worker-handover.ts).
  const [stale, setStale] = createSignal(needsReload());
  const onStale = () => setStale(true);
  window.addEventListener(NEEDS_RELOAD_EVENT, onStale);
  onCleanup(() => window.removeEventListener(NEEDS_RELOAD_EVENT, onStale));

  // Or a queue has moved to a protocol this browser's workers don't speak, and
  // they have stood down (see `outdated` in availability.ts).
  const [outdated, setOutdated] = createSignal(false);
  const statusChannel = new BroadcastChannel(AVAILABILITY_CHANNEL);
  statusChannel.onmessage = ({ data }: MessageEvent<AvailabilityStatus>) =>
    setOutdated(!!data?.outdated);
  onCleanup(() => statusChannel.close());

  return (
    <Show
      when={SAME_ORIGIN}
      fallback={
        <span
          class="task-titlebar task-titlebar--broken"
          title="The task workers can't start: this package was installed from another website. Install it by its automerge: url instead."
        >
          Tasks: not running
        </span>
      }
    >
      <div class="task-titlebar-list">
        <Show when={stale() || outdated()}>
          <button
            class="task-titlebar task-titlebar--broken"
            title={
              stale()
                ? 'A newer version of the task workers is running in another tab. Reload this one to join it.'
                : "This browser's task workers are too old for a queue they work for. Reload to update them."
            }
            onClick={() => location.reload()}
          >
            Tasks: reload to update
          </button>
        </Show>
        <WithTasksRepo>
          <For each={queueUrls()}>
            {(taskQueueUrl) => <QueueBadge element={props.element} taskQueueUrl={taskQueueUrl} />}
          </For>
        </WithTasksRepo>
      </div>
    </Show>
  );
};

const QueueBadge = (props: { element: HTMLElement; taskQueueUrl: AutomergeUrl }) => {
  const queue = useDoc<TaskQueueDoc>(() => props.taskQueueUrl);
  return (
    <Show when={queue()}>
      {(doc) => {
        const name = () => doc().title ?? 'Tasks';
        const busy = () => doc().pending.length > 0;
        return (
          <button
            class="task-titlebar"
            classList={{ 'task-titlebar--busy': busy() }}
            title={`${name()}: ${doc().pending.length} pending, ${doc().done.length} done`}
            // Name the tool: a queue made by the older copy, or by tasklib, would
            // otherwise open in the older browser or in nothing.
            onClick={() =>
              props.element.dispatchEvent(
                createOpenEvent({ url: props.taskQueueUrl, toolId: QUEUE_TOOL_ID }),
              )
            }
          >
            <span class="task-titlebar-dot" />
            <span class="task-titlebar-name">{name()}</span>
            <span class="task-titlebar-count">
              {busy()
                ? `${doc().pending.length} pending`
                : `${doc().done.length.toLocaleString()} done`}
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
