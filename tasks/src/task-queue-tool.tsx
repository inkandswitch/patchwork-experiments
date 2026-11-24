import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  Show,
  type Accessor,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import './index.css';
import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo/slim';
import type { RouterDoc, RunInfo, WorkerDoc, TaskDoc, TaskQueueDoc } from './datatype';
import type { MessageToTaskQueueChannel } from './protocol';
import { DELIVERY_STATS_CHANNEL, type DeliveryReport } from './delivery-stats';
import {
  AVAILABILITY_CHANNEL,
  type AvailabilityMode,
  type AvailabilityStatus,
} from './availability';
import {
  getAvailabilityMode,
  idleDetectionSupported,
  onAvailabilityModeChange,
  requestIdleDetection,
  setAvailabilityMode,
} from './host-activity';
import { listen } from './messages';
import { getAccountDocUrl, isOnTaskQueue, joinTaskQueue, leaveTaskQueue } from './helpers';
import {
  useDoc,
  useHandle,
  useHandleDoc,
  useHandleDocWhenThere,
  useRepo,
  WithTasksRepo,
} from './use-doc';

const DEFAULT_INPUT_EXPR = `[
  Math.floor(Math.random() * 10) + 1,
  Math.floor(Math.random() * 10) + 1
]`;

const DEFAULT_CODE = `export default async function ([x, y]) {
  await seconds(Math.random() * 3);
  if (Math.random() < 0.1) { throw new Error("Oh no!") }
  return x + y;
}

async function seconds(s) {
  return new Promise((resolve) => {
    setTimeout(resolve, s * 1000);
  });
}`;

/** How many tasks of each list to show; a queue's history can run to thousands. */
const MAX_TASKS_SHOWN = 20;

/** A router sends a heartbeat every second; this long without one is worth saying. */
const ROUTER_QUIET_AFTER_MS = 5_000;

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
  const handle = useHandle<TaskQueueDoc>(() => props.url);
  return (
    <Show
      when={handle()}
      fallback={
        <div class="tq tq-loading">Waiting for this queue to reach this browser's task workers…</div>
      }
    >
      {(ready) => <TaskQueueBrowser handle={ready()} hostRepo={props.hostRepo} />}
    </Show>
  );
};

/**
 * Whether this account's browsers work on a queue, and how to change that.
 *
 * The list of queues is on the account, which is the site's document, so it's
 * read and written through the site's Repo and not the tasks one. The worker
 * pool watches the same list (see worker-pool-proxy.ts), so joining or leaving
 * takes effect at once, in every tab, with nothing to reload.
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
  };
}

const TaskQueueBrowser = (props: { handle: DocHandle<TaskQueueDoc>; hostRepo: Repo }) => {
  const repo = useRepo();
  const queue = useHandleDoc(props.handle);
  const membership = useMembership(props.handle.url, props.hostRepo);

  // Who the router says is working for this queue, and which of them have asked
  // not to be given work just now. A heartbeat a second mostly repeats the last
  // one, so only a change counts as one.
  const [workers, setWorkers] = createSignal<AutomergeUrl[]>([], { equals: sameList });
  const [paused, setPaused] = createSignal<AutomergeUrl[]>([], { equals: sameList });
  const [lastHeartbeatAt, setLastHeartbeatAt] = createSignal<number | null>(null);

  // What build everyone is on, as far as the router can tell (see version.ts):
  // the workers that speak another protocol than the router and so get no work,
  // and the newest build among the router and its workers.
  const [incompatible, setIncompatible] = createSignal<AutomergeUrl[]>([], { equals: sameList });
  const [builds, setBuilds] = createStore<{ workers: Record<string, number>; newest: number }>({
    workers: {},
    newest: 0,
  });

  onCleanup(
    listen<MessageToTaskQueueChannel>(props.handle, (msg) => {
      if (msg.type !== 'router heartbeat') {
        return;
      }
      // Go by who the queue says its router is now: it changes on every takeover.
      if (msg.routerUrl !== props.handle.doc().activeRouter) {
        return;
      }
      setLastHeartbeatAt(Date.now());
      setWorkers([...msg.workerUrls].sort());
      setPaused([...(msg.pausedWorkerUrls ?? [])].sort());
      setIncompatible([...(msg.incompatibleWorkerUrls ?? [])].sort());
      setBuilds({
        workers: msg.workerBuilds ?? {},
        newest: Math.max(msg.build ?? 0, ...Object.values(msg.workerBuilds ?? {})),
      });
    }),
  );

  // What each worker says it's running, so a pending task can say "running".
  const [runningBy, setRunningBy] = createStore<Record<string, AutomergeUrl | null>>({});
  const isRunning = (taskUrl: AutomergeUrl) => workers().some((url) => runningBy[url] === taskUrl);

  const myContactUrl = (): AutomergeUrl | undefined =>
    (window as any).patchwork?.account?.doc()?.contactUrl;

  async function addTask(inputExpr: string, code: string) {
    const input = eval(inputExpr);
    const importUrl = `data:application/javascript;base64,${btoa(code)}`;
    const taskDoc = repo.create<TaskDoc<any, any>>({ input, importUrl, runs: [] });
    // Saved before the queue names it, so that a worker handed the task finds
    // it in the shared database rather than having to wait for it.
    await repo.flush([taskDoc.documentId]);
    props.handle.change((doc) => doc.pending.push(taskDoc.url));
  }

  return (
    <div class="tq">
      <div class="tq-page">
        <header class="tq-header">
          <h1 class="tq-title">{queue().title ?? 'Task queue'}</h1>
          <div class="tq-stats">
            <Stat value={queue().pending.length} label="pending" />
            <Stat value={queue().done.length} label="done" />
            <Stat value={workers().length} label={workers().length === 1 ? 'worker' : 'workers'} />
          </div>
          <RouterStatus activeRouter={queue().activeRouter} lastHeartbeatAt={lastHeartbeatAt} />
        </header>

        <Show when={membership.known() && !membership.joined()}>
          <div class="tq-callout">
            <div class="tq-callout-text">
              <strong>This browser isn't working on this queue.</strong>
              <span>
                Joining lends the queue this browser's task workers, and lets this browser take a
                turn at routing.
              </span>
            </div>
            <button class="tq-button" onClick={membership.join}>
              Join queue
            </button>
          </div>
        </Show>

        <section class="tq-section">
          <h2 class="tq-section-title">
            Workers <span class="tq-count">{workers().length}</span>
          </h2>
          <Show
            when={workers().length > 0}
            fallback={
              <p class="tq-empty">
                {queue().activeRouter
                  ? 'No workers have reported to the router yet.'
                  : 'Workers appear here once a router is in charge of this queue.'}
              </p>
            }
          >
            <div class="tq-workers">
              <For each={workers()}>
                {(url) => (
                  <Worker
                    docUrl={url}
                    mine={(contactUrl) => !!contactUrl && contactUrl === myContactUrl()}
                    paused={paused().includes(url)}
                    version={
                      incompatible().includes(url)
                        ? 'incompatible'
                        : builds.workers[url] !== undefined && builds.workers[url] < builds.newest
                          ? 'older'
                          : 'current'
                    }
                    onCurrentTask={(taskUrl) => setRunningBy(url, taskUrl)}
                  />
                )}
              </For>
            </div>
          </Show>
        </section>

        <HostManners
          newestBuild={builds.newest}
          joined={membership.known() && membership.joined()}
          onLeave={membership.leave}
        />

        <NewTaskForm onAdd={addTask} />

        <TaskList
          label="Pending"
          urls={queue().pending}
          shownNote="next"
          isRunning={isRunning}
          emptyText="Nothing is waiting to run."
        />
        <TaskList
          label="Done"
          urls={queue().done.toReversed()}
          shownNote="latest"
          emptyText="Nothing has finished yet."
        />

        <DeliveryFooter />
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

/** Who is routing this queue, and whether they can be heard. */
const RouterStatus = (props: {
  activeRouter: AutomergeUrl | null;
  lastHeartbeatAt: Accessor<number | null>;
}) => {
  // its own clock, so that "last heard 7s ago" counts up
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 1_000);
  onCleanup(() => clearInterval(timer));
  const since = Date.now();

  const quietFor = () => now() - (props.lastHeartbeatAt() ?? since);
  const quiet = () => quietFor() > ROUTER_QUIET_AFTER_MS;

  return (
    <Show
      when={props.activeRouter}
      fallback={
        <div class="tq-router tq-router--none">
          <span class="tq-dot" />
          <span>No router yet. One of the browsers contributing to this queue will pick it up.</span>
        </div>
      }
    >
      {(routerUrl) => (
        <div class="tq-router" classList={{ 'tq-router--quiet': quiet(), 'tq-router--live': !quiet() }}>
          <span class="tq-dot" />
          <span class="tq-router-body">
            <span class="tq-router-who">
              Routed by <RouterName docUrl={routerUrl()} />
            </span>
            <Show when={quiet()}>
              <span class="tq-router-note">
                {props.lastHeartbeatAt()
                  ? `last heard ${Math.round(quietFor() / 1_000)}s ago`
                  : 'not heard from yet'}
                ; another router takes over if this goes on
              </span>
            </Show>
          </span>
        </div>
      )}
    </Show>
  );
};

const AVAILABILITY_MODES: { mode: AvailabilityMode; label: string; explanation: string }[] = [
  {
    mode: 'always',
    label: 'Always',
    explanation: 'Takes tasks whenever there are any.',
  },
  {
    mode: 'polite',
    label: "When I'm not busy",
    explanation:
      "Pauses while you're using Patchwork and, in Chrome and Edge, while the computer is under load. It can't tell when you're busy in another app.",
  },
  {
    mode: 'away',
    label: "Only when I'm away",
    explanation: "Waits until you've left the computer alone for a minute, or locked the screen.",
  },
];

/**
 * When this browser's workers take on tasks (see availability.ts), and what
 * they've decided just now. The choice is this browser's alone: it isn't in
 * the queue or the account, because a computer's manners are its own.
 */
const HostManners = (props: {
  /** The newest build among this queue's router and workers, for comparison. */
  newestBuild: number;
  /** Whether this account's browsers work on the queue being shown. */
  joined: boolean;
  onLeave: () => void;
}) => {
  const [mode, setMode] = createSignal(getAvailabilityMode());
  onCleanup(onAvailabilityModeChange(() => setMode(getAvailabilityMode())));
  const status = useAvailabilityStatus();
  const [refused, setRefused] = createSignal(false);
  const canTellAway = idleDetectionSupported();

  async function choose(chosen: AvailabilityMode) {
    setRefused(false);
    // The browser asks the user's leave to know when they're away, and only
    // from a click: this one.
    if (chosen === 'away' && !(await requestIdleDetection())) {
      setRefused(true);
      return;
    }
    setAvailabilityMode(chosen);
  }

  return (
    <section class="tq-section">
      <h2 class="tq-section-title">This browser's workers take tasks</h2>
      <div class="tq-choice" role="radiogroup" aria-label="When this browser takes tasks">
        <For each={AVAILABILITY_MODES}>
          {(option) => (
            <button
              role="radio"
              aria-checked={mode() === option.mode}
              class="tq-choice-option"
              classList={{ 'tq-choice-option--chosen': mode() === option.mode }}
              disabled={option.mode === 'away' && !canTellAway}
              title={
                option.mode === 'away' && !canTellAway
                  ? "This browser can't tell when you're away"
                  : undefined
              }
              onClick={() => choose(option.mode)}
            >
              {option.label}
            </button>
          )}
        </For>
      </div>
      <p class="tq-choice-note">
        {AVAILABILITY_MODES.find((option) => option.mode === mode())?.explanation}
        {canTellAway ? null : " “Only when I'm away” needs Chrome or Edge."}
      </p>
      <Show when={refused()}>
        <p class="tq-error">
          The browser didn't allow this site to know when you're away, so nothing changed.
        </p>
      </Show>
      <div
        class="tq-router"
        classList={{
          'tq-router--none': !status(),
          'tq-router--live': !!status()?.available && !status()?.outdated,
          'tq-router--quiet': !!status() && (!status()!.available || !!status()!.outdated),
        }}
      >
        <span class="tq-dot" />
        <span>{describeAvailability(status())}</span>
      </div>
      <Show when={props.joined}>
        <p class="tq-choice-note">
          This browser is working on this queue.{' '}
          <button class="tq-link" onClick={props.onLeave}>
            Leave queue
          </button>
        </p>
      </Show>
      <Show when={status()?.build}>
        {(build) => (
          // which build this browser's workers are, to see an update arrive
          <p class="tq-choice-note">
            Workers built {new Date(build()).toLocaleString()}.
            <Show when={!status()?.outdated && build() < props.newestBuild}>
              {' '}
              Others on this queue are on a newer build; reload to get it.
            </Show>
          </p>
        )}
      </Show>
    </section>
  );
};

function describeAvailability(status: AvailabilityStatus | undefined) {
  if (!status) {
    return "Haven't heard from this browser's task workers yet.";
  }
  if (status.outdated) {
    return "Paused: this browser's task workers are too old for this queue's router. Reload to update them.";
  }
  if (status.available) {
    return `Taking tasks ${status.mode === 'always' ? '' : 'because '}${status.reason}.`;
  }
  // "can't tell…" reads as a sentence after "because" only with a subject
  const reason = status.reason.startsWith("can't") ? `this browser ${status.reason}` : status.reason;
  return `Paused because ${reason}. A task already running is left to finish.`;
}

/** What this browser's worker pool last decided, once it has said. */
function useAvailabilityStatus() {
  const [status, setStatus] = createSignal<AvailabilityStatus | undefined>(undefined, {
    equals: (a, b) =>
      a?.available === b?.available &&
      a?.reason === b?.reason &&
      a?.mode === b?.mode &&
      a?.build === b?.build &&
      a?.outdated === b?.outdated,
  });
  const channel = new BroadcastChannel(AVAILABILITY_CHANNEL);
  channel.onmessage = ({ data }: MessageEvent<AvailabilityStatus>) => setStatus(data);
  onCleanup(() => channel.close());
  return status;
}

const NewTaskForm = (props: {
  onAdd: (inputExpr: string, code: string) => Promise<void>;
}) => {
  const [inputExpr, setInputExpr] = createSignal(DEFAULT_INPUT_EXPR);
  const [code, setCode] = createSignal(DEFAULT_CODE);
  const [error, setError] = createSignal<string | null>(null);

  async function add() {
    try {
      await props.onAdd(inputExpr(), code());
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  return (
    <details class="tq-section tq-new">
      <summary class="tq-new-summary">New task</summary>
      <div class="tq-new-fields">
        <label class="tq-field">
          <span class="tq-field-label">Input</span>
          <span class="tq-field-hint">a JavaScript expression, evaluated here</span>
          <textarea
            class="tq-textarea"
            rows={4}
            spellcheck={false}
            value={inputExpr()}
            onInput={(e) => setInputExpr(e.currentTarget.value)}
          />
        </label>
        <label class="tq-field">
          <span class="tq-field-label">Code</span>
          <span class="tq-field-hint">a module whose default export takes the input</span>
          <textarea
            class="tq-textarea"
            rows={9}
            spellcheck={false}
            value={code()}
            onInput={(e) => setCode(e.currentTarget.value)}
          />
        </label>
      </div>
      <div class="tq-new-actions">
        <button class="tq-button" onClick={add}>
          Add task
        </button>
        <Show when={error()}>
          <span class="tq-error">Couldn't read the input: {error()}</span>
        </Show>
      </div>
    </details>
  );
};

/** The first few of `urls`, which the caller has put in the order worth reading. */
const TaskList = (props: {
  label: string;
  urls: AutomergeUrl[];
  /** What the ones shown are, when there are more: the "next" 20, the "latest" 20. */
  shownNote: string;
  isRunning?: (taskUrl: AutomergeUrl) => boolean;
  emptyText: string;
}) => {
  const shown = () => [...new Set(props.urls)].slice(0, MAX_TASKS_SHOWN);
  return (
    <section class="tq-section">
      <h2 class="tq-section-title">
        {props.label} <span class="tq-count">{props.urls.length.toLocaleString()}</span>
        <Show when={props.urls.length > shown().length}>
          <span class="tq-section-note">
            {props.shownNote} {shown().length} shown
          </span>
        </Show>
      </h2>
      <Show when={shown().length > 0} fallback={<p class="tq-empty">{props.emptyText}</p>}>
        <div class="tq-tasks">
          <For each={shown()}>
            {(url) => <Task docUrl={url} running={props.isRunning?.(url) ?? false} />}
          </For>
        </div>
      </Show>
    </section>
  );
};

/** How this browser's shared workers have fared at hearing their messages. */
const DeliveryFooter = () => {
  const [reports, setReports] = createStore<Record<string, DeliveryReport>>({});
  const channel = new BroadcastChannel(DELIVERY_STATS_CHANNEL);
  channel.onmessage = ({ data }: MessageEvent<DeliveryReport>) => setReports(data.label, data);
  onCleanup(() => channel.close());

  const list = () => Object.values(reports).sort((a, b) => a.label.localeCompare(b.label));
  const total = (count: keyof DeliveryReport['totals']) =>
    list().reduce((n, report) => n + report.totals[count], 0);
  const trouble = () => total('missed') + total('duplicates') > 0;

  return (
    <Show when={list().length > 0}>
      <details class="tq-delivery" classList={{ 'tq-delivery--trouble': trouble() }}>
        <summary>
          Messages to this browser's workers: {total('received').toLocaleString()} received,{' '}
          {trouble()
            ? `${total('missed')} missed, ${total('duplicates')} duplicated`
            : 'none missed'}
        </summary>
        <table class="tq-delivery-table">
          <thead>
            <tr>
              <th>Receiver</th>
              <th>Received</th>
              <th>Missed</th>
              <th>Out of order</th>
              <th>Duplicated</th>
            </tr>
          </thead>
          <tbody>
            <For each={list()}>
              {(report) => (
                <tr>
                  <td>{report.label}</td>
                  <td>{report.totals.received.toLocaleString()}</td>
                  <td>{report.totals.missed}</td>
                  <td>{report.totals.late}</td>
                  <td>{report.totals.duplicates}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </details>
    </Show>
  );
};

/** Whose worker or router it is, then its own name: "Ada / wet-animal". */
const Identity = (props: { contactUrl?: AutomergeUrl | null; name: string }) => (
  <span class="tq-identity">
    <Show when={props.contactUrl}>
      {(contactUrl) => <patchwork-view doc-url={contactUrl()} tool-id="contact-inline" />}
    </Show>
    <span class="tq-identity-name">{props.name}</span>
  </span>
);

const Placeholder = () => <span class="tq-placeholder">…</span>;

const RouterName = (props: { docUrl: AutomergeUrl }) => {
  const router = useDoc<RouterDoc>(() => props.docUrl);
  return (
    <Show when={router()} fallback={<Placeholder />}>
      {(doc) => <Identity contactUrl={doc().contactUrl} name={doc().name} />}
    </Show>
  );
};

const Worker = (props: {
  docUrl: AutomergeUrl;
  /** Whether a worker with this contact is this user's own. */
  mine: (contactUrl: AutomergeUrl | undefined) => boolean;
  /** Its host has asked that it not be given work just now. */
  paused: boolean;
  /**
   * How its build stands (see version.ts): `incompatible` speaks another
   * protocol than the router and gets no work; `older` works fine but isn't
   * the newest build around.
   */
  version: 'current' | 'older' | 'incompatible';
  onCurrentTask: (taskUrl: AutomergeUrl | null) => void;
}) => {
  const worker = useDoc<WorkerDoc>(() => props.docUrl);
  const currentTaskUrl = () => worker()?.currentTask?.taskUrl ?? null;

  // tell the browser what this worker is on, so the pending list can say so
  createEffect(() => props.onCurrentTask(currentTaskUrl()));
  onCleanup(() => props.onCurrentTask(null));

  return (
    <Show when={worker()} fallback={<div class="tq-worker tq-worker--loading">…</div>}>
      {(doc) => (
        <div
          class="tq-worker"
          classList={{
            'tq-worker--busy': !!currentTaskUrl(),
            'tq-worker--paused': !currentTaskUrl() && props.paused,
            'tq-worker--idle': !currentTaskUrl() && !props.paused,
          }}
        >
          <span class="tq-dot" />
          <Identity contactUrl={doc().contactUrl} name={doc().name} />
          <Show when={props.mine(doc().contactUrl)}>
            <span class="tq-tag">yours</span>
          </Show>
          <Show when={props.version === 'incompatible'}>
            <span
              class="tq-tag tq-tag--warn"
              title="On a build that can't work with this queue's router, so it's given no tasks until its browser is reloaded"
            >
              needs update
            </span>
          </Show>
          <Show when={props.version === 'older'}>
            <span class="tq-tag" title="Works fine, but a newer build is in use on this queue">
              older build
            </span>
          </Show>
          <span class="tq-worker-state">
            <Show when={currentTaskUrl()} fallback={props.paused ? 'paused' : 'idle'}>
              {(taskUrl) => <TaskInput docUrl={taskUrl()} />}
            </Show>
          </span>
        </div>
      )}
    </Show>
  );
};

/** Just a task's input, for where there isn't room for the task: `[3, 7]`. */
const TaskInput = (props: { docUrl: AutomergeUrl }) => {
  const task = useDoc<TaskDoc<any, any>>(() => props.docUrl);
  return (
    <Show when={task()} fallback={<Placeholder />}>
      {(doc) => <code class="tq-code">{show(doc().input)}</code>}
    </Show>
  );
};

const Task = (props: {
  docUrl: AutomergeUrl;
  /** A worker says it's on this one right now. */
  running: boolean;
}) => {
  const task = useDoc<TaskDoc<any, any>>(() => props.docUrl);
  return (
    <Show
      when={task()}
      fallback={<div class="tq-task tq-task--loading">Waiting for this task to arrive…</div>}
    >
      <LoadedTask task={task()!} running={props.running} />
    </Show>
  );
};

type TaskState = 'running' | 'queued' | 'ok' | 'failed';
const MARKS: Record<TaskState, string> = { ok: '✓', failed: '✕', running: '●', queued: '·' };

const LoadedTask = (props: { task: TaskDoc<any, any>; running: boolean }) => {
  const lastRun = () => props.task.runs.at(-1);
  const failures = () => props.task.runs.filter((run) => run.status === 'failed').length;
  const state = (): TaskState =>
    props.running
      ? 'running'
      : !lastRun()
        ? 'queued'
        : lastRun()!.status === 'succeeded'
          ? 'ok'
          : 'failed';

  // Only read the code when someone opens the task: most rows never are.
  const [code, setCode] = createSignal<string | null>(null);
  function onToggle(event: Event) {
    if (!(event.currentTarget as HTMLDetailsElement).open || code() !== null) {
      return;
    }
    const importUrl = props.task.importUrl;
    fetch(importUrl)
      .then((res) => res.text())
      .catch(() => importUrl)
      .then(setCode);
  }

  return (
    <details class={`tq-task tq-task--${state()}`} on:toggle={onToggle}>
      <summary class="tq-task-row">
        <span class="tq-task-mark" aria-label={state()}>
          {MARKS[state()]}
        </span>
        <code class="tq-code tq-task-input">{show(props.task.input)}</code>
        <span class="tq-task-outcome">
          <Show when={!props.running} fallback={<span class="tq-busy">running</span>}>
            <Show when={lastRun()} fallback={<span class="tq-muted">waiting</span>}>
              {(run) => (
                <Show
                  when={run().status === 'succeeded'}
                  fallback={<span class="tq-bad">{lastLog(run()) ?? 'failed'}</span>}
                >
                  <span class="tq-muted">→</span> <code class="tq-code">{show(run().result)}</code>
                </Show>
              )}
            </Show>
          </Show>
        </span>
        <Show when={failures() > 0}>
          <span class="tq-tag tq-tag--warn">
            {failures()} failed {failures() === 1 ? 'try' : 'tries'}
          </span>
        </Show>
        <Show when={!props.running && lastRun()}>
          {(run) => (
            <span class="tq-task-time">
              {duration(run().endTimeMillis - run().startTimeMillis)}
            </span>
          )}
        </Show>
      </summary>
      <div class="tq-task-detail">
        <Show when={props.task.runs.length > 0}>
          <ol class="tq-runs">
            <For each={props.task.runs}>
              {(run) => (
                <li>
                  <Run run={run} />
                </li>
              )}
            </For>
          </ol>
        </Show>
        <pre class="tq-source">{code() ?? 'Loading code…'}</pre>
      </div>
    </details>
  );
};

const Run = (props: { run: RunInfo<any> }) => {
  const worker = useDoc<WorkerDoc>(() => props.run.workerUrl);
  return (
    <div class={`tq-run tq-run--${props.run.status}`}>
      <div class="tq-run-line">
        <span class="tq-task-mark">{props.run.status === 'succeeded' ? '✓' : '✕'}</span>
        <Show when={worker()} fallback={<Placeholder />}>
          {(doc) => <Identity contactUrl={doc().contactUrl} name={doc().name} />}
        </Show>
        <span class="tq-muted">
          {new Date(props.run.startTimeMillis).toLocaleTimeString()},{' '}
          {duration(props.run.endTimeMillis - props.run.startTimeMillis)}
        </span>
      </div>
      <Show when={props.run.logs?.length}>
        <ul class="tq-logs">
          <For each={props.run.logs}>
            {(entry) => (
              <li>
                <span class="tq-muted">
                  {new Date(entry.timestampMillis).toLocaleTimeString()}
                </span>{' '}
                {entry.message}
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
};

// helpers

function sameList<T>(a: T[], b: T[]) {
  return a.length === b.length && a.every((item, idx) => item === b[idx]);
}

/** A value as it would be typed, cut short: task inputs and results can be anything. */
function show(value: unknown) {
  let text: string;
  try {
    // undefined for what JSON has no way to write: undefined itself, a function
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

function duration(millis: number) {
  return millis < 1_000 ? `${Math.round(millis)} ms` : `${(millis / 1_000).toFixed(1)} s`;
}

function lastLog(run: RunInfo<any>) {
  return run.logs?.at(-1)?.message;
}
