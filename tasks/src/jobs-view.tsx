// The queue browser's view of what a queue lists: how each task stands (and,
// for one that waits because no pool heard serving the queue has what it
// needs, what that is), its runs (which pool, this browser's marked, and how
// each went), and a way to ask for one or stop one. Everything a tool can do
// through task-client.js a person can do here.

import { createSignal, For, onCleanup, Show } from 'solid-js';
import type { AutomergeUrl, DocHandle } from '@automerge/automerge-repo/slim';
import type { Queue, Run, TaskState } from './datatype';
import { isFinished, satisfies, waitingWork } from './task-rules.js';
import { ask, cancel, watch, type Ask, type Serving, type TaskView } from './task-client.js';
import { inSamePackage } from './import-url';
import { WAIT_TASK_PATH } from './ids';
import { useRepo } from './use-doc';
import { MAX_SOURCE_CHARS, showValue, TaskCode } from './task-code';

/** How many listed tasks to show. */
const MAX_JOBS_SHOWN = 20;

const MARKS: Record<TaskState, string> = {
  waiting: '·',
  running: '●',
  stalled: '○',
  stopping: '●',
  succeeded: '✓',
  failed: '✕',
  cancelled: '–',
};

/** The task-row look each state borrows: there are four. */
const LOOKS: Record<TaskState, string> = {
  waiting: 'queued',
  running: 'running',
  stalled: 'queued',
  stopping: 'running',
  succeeded: 'ok',
  failed: 'failed',
  cancelled: 'queued',
};

/** The task this package brings along, as an import URL for whatever site this is; a `data:` stand-in where the package wasn't loaded from automerge. */
const WAIT_TASK_URL =
  inSamePackage(import.meta.url, WAIT_TASK_PATH) ??
  `data:text/javascript,${encodeURIComponent('export default async function (input) { return input?.value ?? null; }')}`;

/** How a view names the pool with this id: as it is heard naming itself, else by the start of its id. */
export type PoolNames = { name(id: string): string; mine(id: string): boolean };

export const JobsSection = (props: {
  handle: DocHandle<Queue>;
  queue: Queue;
  /** The pools heard serving the queue, for their names. */
  pools?: Serving[];
  /** This browser's pool id, if it has one. */
  mine?: string | null;
}) => {
  const repo = useRepo();
  const names: PoolNames = {
    name: (id) => props.pools?.find((pool) => pool.pool === id)?.name || id.slice(0, 8),
    mine: (id) => !!props.mine && id === props.mine,
  };
  // newest first
  const listed = () => waitingWork(props.queue).toReversed();
  const shown = () => listed().slice(0, MAX_JOBS_SHOWN);
  // Rows are kept by key, which is a string and so the same from one reading
  // of the queue to the next: each change to the queue makes new entries,
  // and rows kept by those would be made again, closing what a person had
  // opened and starting every row's watcher afresh.
  const shownKeys = () => shown().map((work) => work.key);
  const taskUrlOf = (key: string) => shown().find((work) => work.key === key)?.taskUrl as AutomergeUrl;
  // read from the entry, which carries the task's needs, against the pools heard now
  const waitsFor = (key: string) => unmetNeeds(shown().find((work) => work.key === key)?.needs, props.pools ?? [], names);

  return (
    <>
      <NewJobForm onAsk={(request) => ask(repo, props.handle.url, request)} />
      <section class="tq-section">
        <h2 class="tq-section-title">
          Listed <span class="tq-count">{listed().length.toLocaleString()}</span>
          <Show when={listed().length > shown().length}>
            <span class="tq-section-note">latest {shown().length} shown</span>
          </Show>
        </h2>
        <Show when={shown().length > 0} fallback={<p class="tq-empty">Nothing is waiting or running.</p>}>
          <div class="tq-tasks">
            <For each={shownKeys()}>
              {(key) => (
                <Job
                  jobKey={key}
                  taskUrl={taskUrlOf(key)}
                  queueUrl={props.handle.url}
                  names={names}
                  waitsFor={waitsFor(key)}
                  onCancel={() => cancel(repo, props.handle.url, key)}
                />
              )}
            </For>
          </div>
        </Show>
      </section>
    </>
  );
};

/**
 * The task under a key, kept current: its document as it changes, and its
 * runs as they are heard. Also since when it has read `stalled`, on this
 * view's clock: since this view first saw it so.
 */
function useTask(queueUrl: AutomergeUrl, key: string, taskUrl: AutomergeUrl) {
  const repo = useRepo();
  const [view, setView] = createSignal<TaskView | null>(null);
  const [stalledSince, setStalledSince] = createSignal<number | null>(null);
  onCleanup(
    watch(
      repo,
      queueUrl,
      key,
      (next) => {
        setStalledSince((since) => (next.state === 'stalled' ? (since ?? Date.now()) : null));
        setView(() => next);
      },
      { from: taskUrl },
    ),
  );
  return { view, stalledSince };
}

const Job = (props: {
  jobKey: string;
  taskUrl: AutomergeUrl;
  queueUrl: AutomergeUrl;
  names: PoolNames;
  /** Why it waits, when no pool heard serving the queue has what it needs. */
  waitsFor: string | null;
  onCancel: () => void;
}) => {
  const { view, stalledSince } = useTask(props.queueUrl, props.jobKey, props.taskUrl);
  return (
    <Show when={view()?.state !== 'missing' ? view() : null}>
      {(job) => {
        const state = () => job().state as TaskState;
        // What is in the details is made while they are open and let go as
        // they close, so a task's code is loaded at most once per opening.
        const [open, setOpen] = createSignal(false);
        return (
          <details class={`tq-task tq-task--${LOOKS[state()]}`} onToggle={(event) => setOpen(event.currentTarget.open)}>
            <summary class="tq-task-row">
              <span class="tq-task-mark" aria-label={state()}>
                {MARKS[state()]}
              </span>
              <code class="tq-code tq-task-input">
                {codeName(job().importUrl)}({show(job().input)})
              </code>
              <span class="tq-task-outcome">
                <Outcome job={job()} stalledSince={stalledSince()} waitsFor={props.waitsFor} />
              </span>
              <Show when={!isFinished(state())}>
                <button
                  class="tq-link"
                  disabled={state() === 'stopping'}
                  onClick={(event) => {
                    event.preventDefault();
                    props.onCancel();
                  }}
                >
                  Stop
                </button>
              </Show>
            </summary>
            <Show when={open()}>
              <div class="tq-task-detail">
                <p class="tq-choice-note">
                  Asked for as <code class="tq-code">{props.jobKey}</code>
                </p>
                <Show when={job().runs.length > 0}>
                  <ul class="tq-runs">
                    <For each={job().runs}>{(run) => <RunLine run={run} names={props.names} />}</For>
                  </ul>
                </Show>
                <Show when={job().logs.length > 0}>
                  <ul class="tq-logs">
                    <For each={job().logs}>
                      {(line) => (
                        <li>
                          <span class="tq-muted">{new Date(line.timestampMillis).toLocaleTimeString()}</span>{' '}
                          {line.message}
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
                <div class="tq-input">
                  <p class="tq-choice-note">Input</p>
                  <pre class="tq-source tq-input-value">{showAll(job().input)}</pre>
                </div>
                <Show when={job().importUrl} keyed fallback={<pre class="tq-source">…</pre>}>
                  {(importUrl) => <TaskCode importUrl={importUrl} />}
                </Show>
              </div>
            </Show>
          </details>
        );
      }}
    </Show>
  );
};

/** One record of a task's list: a run (which pool took it, when, how it went or that it is open), or a stop someone asked for. */
const RunLine = (props: { run: Run; names: PoolNames }) => (
  <li class="tq-run-line">
    <span class="tq-muted">{new Date(props.run.start).toLocaleTimeString()}</span>
    <Show when={props.run.pool} fallback="stopped by request">
      {(pool) => (
        <>
          <span>
            run by {props.names.name(pool())}: {props.run.status ?? 'open'}
          </span>
          <Show when={props.names.mine(pool())}>
            <span class="tq-tag">this browser</span>
          </Show>
        </>
      )}
    </Show>
  </li>
);

/** How a task stands, in a few words: its progress while it runs, its result or what went wrong after. */
const Outcome = (props: { job: TaskView; stalledSince: number | null; waitsFor: string | null }) => {
  const state = () => props.job.state;
  return (
    <>
      <Show when={state() === 'waiting'}>
        <span class="tq-muted tq-waits">{props.waitsFor ?? 'waiting'}</span>
      </Show>
      <Show when={state() === 'running'}>
        <span class="tq-busy">running {showProgress(props.job.progress)}</span>
      </Show>
      <Show when={state() === 'stalled'}>
        <span class="tq-muted">
          stalled
          {props.stalledSince ? ` since ${new Date(props.stalledSince).toLocaleTimeString()}` : ''}: its pool is
          not heard
        </span>
      </Show>
      <Show when={state() === 'stopping'}>
        <span class="tq-busy">stopping</span>
      </Show>
      <Show when={state() === 'succeeded'}>
        <span class="tq-muted">→</span> <code class="tq-code">{show(props.job.result)}</code>
      </Show>
      <Show when={state() === 'failed'}>
        <span class="tq-bad">{props.job.error ?? 'failed'}</span>
      </Show>
      <Show when={state() === 'cancelled'}>
        <span class="tq-muted">stopped</span>
      </Show>
    </>
  );
};

const NewJobForm = (props: { onAsk: (request: Ask) => Promise<unknown> }) => {
  const [importUrl, setImportUrl] = createSignal(WAIT_TASK_URL);
  const [input, setInput] = createSignal('{ "ms": 5000, "value": "done" }');
  const [key, setKey] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);

  async function add() {
    let parsed: unknown;
    try {
      parsed = input().trim() ? JSON.parse(input()) : null;
    } catch (e: any) {
      setError(`Couldn't read the input as JSON: ${e?.message ?? e}`);
      return;
    }
    if (!importUrl().trim()) {
      setError('Say where the code to run is.');
      return;
    }
    try {
      await props.onAsk({ importUrl: importUrl().trim(), input: parsed, key: key().trim() || undefined });
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  return (
    <details class="tq-section tq-new">
      <summary class="tq-new-summary">New task, by key</summary>
      <div class="tq-new-fields">
        <label class="tq-field">
          <span class="tq-field-label">Code</span>
          <span class="tq-field-hint">
            the URL of a module whose default export takes the input: a file in a package, or a
            data: URL
          </span>
          <textarea
            class="tq-textarea"
            rows={2}
            spellcheck={false}
            value={importUrl()}
            onInput={(e) => setImportUrl(e.currentTarget.value)}
          />
        </label>
        <label class="tq-field">
          <span class="tq-field-label">Input</span>
          <span class="tq-field-hint">JSON</span>
          <textarea
            class="tq-textarea"
            rows={3}
            spellcheck={false}
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
          />
        </label>
        <label class="tq-field">
          <span class="tq-field-label">Key</span>
          <span class="tq-field-hint">
            optional: asking twice under one key, while its task has not ended, is asking once
          </span>
          <input
            class="tq-textarea"
            spellcheck={false}
            value={key()}
            onInput={(e) => setKey(e.currentTarget.value)}
          />
        </label>
      </div>
      <div class="tq-new-actions">
        <button class="tq-button" onClick={add}>
          Ask for it
        </button>
        <Show when={error()}>
          <span class="tq-error">{error()}</span>
        </Show>
      </div>
    </details>
  );
};

/**
 * Why a task waits, as its row says it, when no pool heard
 * serving its queue has every one of its needs; null when it needs nothing,
 * or a pool heard has them all. A need for one pool names that pool as the
 * queue's view names it; needs that are not a list of labels are said to be
 * something no device can have, since no pool will ever take such a task.
 */
export function unmetNeeds(needs: unknown, pools: Serving[], names: PoolNames): string | null {
  if (needs === undefined || needs === null || (Array.isArray(needs) && needs.length === 0)) {
    return null;
  }
  if (!Array.isArray(needs) || !needs.every((need) => typeof need === 'string' && need !== '')) {
    return 'waiting: what it needs is not something any device can have';
  }
  if (pools.some((pool) => satisfies(pool.has, needs))) {
    return null;
  }
  const labels = (needs as string[]).filter((need) => !need.startsWith('pool:'));
  const devices = (needs as string[]).filter((need) => need.startsWith('pool:')).map((need) => names.name(need.slice('pool:'.length)));
  if (devices.length > 0) {
    return `waiting for ${listed(devices)} to serve this queue${labels.length > 0 ? `, with ${listed(labels)}` : ''}`;
  }
  return `waiting: it needs ${listed(labels)}, and no device serving this queue has ${labels.length === 1 ? 'it' : 'them all'}`;
}

/** Words joined as a person lists them: "a", "a and b", "a, b and c". */
function listed(words: string[]) {
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** A value as it would be typed, cut short, with what it keeps under `keys` hidden. */
function show(value: unknown) {
  const text = showValue(value);
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

/** A value as it would be typed, laid out, with what it keeps under `keys` hidden, cut only where it is very long. */
function showAll(value: unknown) {
  const text = showValue(value, 2);
  return text.length > MAX_SOURCE_CHARS ? `${text.slice(0, MAX_SOURCE_CHARS - 1)}…` : text;
}

/** A short name for where a task's code is: a file's name, or what kind of URL it is. */
function codeName(importUrl: string | null) {
  if (!importUrl) {
    return '…';
  }
  if (importUrl.startsWith('data:')) {
    return 'data:';
  }
  const file = importUrl.split(/[?#]/)[0].split('/').at(-1) ?? importUrl;
  return file.replace(/\.[cm]?[jt]s$/, '');
}

/** Progress as the task's code reported it: a fraction as a percentage, anything else as it is. */
function showProgress(progress: unknown) {
  if (progress === null || progress === undefined) {
    return '';
  }
  if (typeof progress === 'number' && progress >= 0 && progress <= 1) {
    return `${Math.round(progress * 100)}%`;
  }
  return typeof progress === 'string' ? progress : show(progress);
}
