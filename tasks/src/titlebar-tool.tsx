import { createEffect, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import './index.css';
import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo/slim';
import type { OpenDocumentEventDetail } from '@inkandswitch/patchwork-elements';
import type { TaskQueueDoc } from './datatype';
import { WorkerPoolProxy } from './worker-pool-proxy';
import { getAccountDocUrl, getTaskQueues } from './helpers';
import { QUEUE_TOOL_ID } from './ids';
import { RepoContext, useDoc } from './use-doc';

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

function mountTaskStatus(element: HTMLElement, repo: Repo) {
  return render(
    () => (
      <RepoContext.Provider value={repo}>
        <TaskStatus element={element} />
      </RepoContext.Provider>
    ),
    element,
  );
}

/**
 * This tab's connection to the task workers. One a tab, kept for as long as the
 * tab lives: the badge comes and goes (a title bar tool is mounted afresh for
 * every document) and may be on screen twice, and neither should start the
 * workers twice or let go of them in between. It's kept on `window` so that a
 * newer copy of this package, loaded without a reload, finds it too.
 */
function ensureWorkerPool(contactUrl: AutomergeUrl) {
  const tab = window as any;
  const existing: WorkerPoolProxy | undefined = tab.__patchworkTaskWorkerPool;
  if (existing?.contactUrl === contactUrl) {
    return;
  }
  existing?.dispose();
  const proxy = new WorkerPoolProxy(contactUrl, getImportMap(), document.baseURI);
  console.log('tasks: created worker pool proxy', proxy);
  tab.__patchworkTaskWorkerPool = proxy;
}

const TaskStatus = (props: { element: HTMLElement }) => {
  const account = useDoc<any>(getAccountDocUrl);
  const contactUrl = (): AutomergeUrl | undefined => account()?.contactUrl;
  const queueUrls = () =>
    account() ? (Object.keys(getTaskQueues(account())) as AutomergeUrl[]) : [];

  createEffect(() => {
    const mine = contactUrl();
    if (!mine) {
      return;
    }
    if (SAME_ORIGIN) {
      ensureWorkerPool(mine);
    } else {
      console.error(
        `tasks: loaded from ${new URL(import.meta.url).origin}, so its shared workers can't start on ${location.origin}. Install it by its automerge: url instead.`,
      );
    }
  });

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
        <For each={queueUrls()}>
          {(taskQueueUrl) => <QueueBadge element={props.element} taskQueueUrl={taskQueueUrl} />}
        </For>
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

function getImportMap() {
  const importMapElement = document.querySelector('script[type="importmap"]');
  if (!importMapElement) {
    return {};
  }

  try {
    return JSON.parse(importMapElement.textContent || '{}');
  } catch (e) {
    console.warn('Failed to parse import map:', e);
    return {};
  }
}
