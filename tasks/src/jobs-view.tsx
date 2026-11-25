// The queue browser's view of what a queue lists: how each task stands, its
// runs, and a way to ask for one or stop one. Everything a tool can do
// through task-client.js a person can do here. Also where an account says
// whose code its browsers run from a queue (see acceptance.ts).

import { createSignal, For, onCleanup, Show } from 'solid-js';
import type { AutomergeUrl, DocHandle } from '@automerge/automerge-repo/slim';
import type { Queue, Run, TaskState } from './datatype';
import { isFinished, waitingWork } from './task-rules.js';
import { ask, cancel, watch, type Ask, type TaskView } from './task-client.js';
import type { Acceptance } from './acceptance';
import { inSamePackage } from './import-url';
import { WAIT_TASK_PATH } from './ids';
import { useRepo } from './use-doc';

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

export const JobsSection = (props: { handle: DocHandle<Queue>; queue: Queue }) => {
  const repo = useRepo();
  // newest first
  const listed = () => waitingWork(props.queue).toReversed();
  const shown = () => listed().slice(0, MAX_JOBS_SHOWN);

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
            <For each={shown()}>
              {(work) => (
                <Job
                  jobKey={work.key}
                  taskUrl={work.taskUrl as AutomergeUrl}
                  queueUrl={props.handle.url}
                  onCancel={() => cancel(repo, props.handle.url, work.key)}
                />
              )}
            </For>
          </div>
        </Show>
      </section>
    </>
  );
};

/** The task under a key, kept current: its document as it changes, and its runs as they are heard. */
function useTask(queueUrl: AutomergeUrl, key: string, taskUrl: AutomergeUrl) {
  const repo = useRepo();
  const [view, setView] = createSignal<TaskView | null>(null);
  onCleanup(watch(repo, queueUrl, key, (next) => setView(() => next), { from: taskUrl }));
  return view;
}

const Job = (props: { jobKey: string; taskUrl: AutomergeUrl; queueUrl: AutomergeUrl; onCancel: () => void }) => {
  const view = useTask(props.queueUrl, props.jobKey, props.taskUrl);
  return (
    <Show when={view()?.state !== 'missing' ? view() : null}>
      {(job) => {
        const state = () => job().state as TaskState;
        return (
          <details class={`tq-task tq-task--${LOOKS[state()]}`}>
            <summary class="tq-task-row">
              <span class="tq-task-mark" aria-label={state()}>
                {MARKS[state()]}
              </span>
              <code class="tq-code tq-task-input">
                {codeName(job().importUrl)}({show(job().input)})
              </code>
              <span class="tq-task-outcome">
                <Outcome job={job()} />
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
            <div class="tq-task-detail">
              <p class="tq-choice-note">
                Asked for as <code class="tq-code">{props.jobKey}</code>
              </p>
              <Show when={job().runs.length > 0}>
                <ul class="tq-logs">
                  <For each={job().runs}>{(run) => <RunLine run={run} />}</For>
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
              <pre class="tq-source">{job().importUrl ?? '…'}</pre>
            </div>
          </details>
        );
      }}
    </Show>
  );
};

/** One run: which pool took it, when, and how it went (or that it is open). */
const RunLine = (props: { run: Run }) => (
  <li>
    <span class="tq-muted">{new Date(props.run.start).toLocaleTimeString()}</span> run by pool{' '}
    <code class="tq-code">{props.run.pool.slice(0, 8)}</code>: {props.run.status ?? 'open'}
  </li>
);

/** How a task stands, in a few words: its progress while it runs, its result or what went wrong after. */
const Outcome = (props: { job: TaskView }) => {
  const state = () => props.job.state;
  return (
    <>
      <Show when={state() === 'waiting'}>
        <span class="tq-muted">waiting</span>
      </Show>
      <Show when={state() === 'running'}>
        <span class="tq-busy">running {showProgress(props.job.progress)}</span>
      </Show>
      <Show when={state() === 'stalled'}>
        <span class="tq-muted">stalled: its pool is not heard</span>
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
 * Whose code this account's browsers run from this queue (see acceptance.ts),
 * and a way to change it. Shown to someone whose browsers work on the queue.
 */
export const AcceptanceChoice = (props: {
  acceptance: Acceptance | undefined;
  onChange: (acceptance: Acceptance) => void;
}) => {
  const packages = () => (Array.isArray(props.acceptance) ? (props.acceptance as string[]) : []);
  const [editing, setEditing] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  function save() {
    const wanted = (editing() ?? '')
      .split(/\s+/)
      .map((url) => url.trim())
      .filter(Boolean);
    const bad = wanted.find((url) => !/^automerge:[1-9A-HJ-NP-Za-km-z]{16,64}$/.test(url));
    if (bad) {
      setError(`${bad} isn't a package's automerge: url`);
      return;
    }
    setError(null);
    setEditing(null);
    props.onChange(wanted);
  }

  return (
    <div class="tq-accept">
      <Show
        when={editing() === null}
        fallback={
          <>
            <label class="tq-field">
              <span class="tq-field-label">Run only code from these packages</span>
              <span class="tq-field-hint">
                one automerge: url a line; a task whose code is anywhere else, a data: URL
                included, is left for other pools
              </span>
              <textarea
                class="tq-textarea"
                rows={3}
                spellcheck={false}
                value={editing() ?? ''}
                onInput={(e) => setEditing(e.currentTarget.value)}
              />
            </label>
            <div class="tq-new-actions">
              <button class="tq-button" onClick={save}>
                Save
              </button>
              <button class="tq-link" onClick={() => (setEditing(null), setError(null))}>
                Cancel
              </button>
              <Show when={error()}>
                <span class="tq-error">{error()}</span>
              </Show>
            </div>
          </>
        }
      >
        <p class="tq-choice-note">
          <Show
            when={props.acceptance === 'any'}
            fallback={
              <>
                From this queue your browsers run only code from{' '}
                {packages().length === 0
                  ? 'no package at all'
                  : `${packages().length} package${packages().length === 1 ? '' : 's'}`}
                .{' '}
                <button class="tq-link" onClick={() => setEditing(packages().join('\n'))}>
                  Change
                </button>{' '}
                <button class="tq-link" onClick={() => props.onChange('any')}>
                  Run any code
                </button>
              </>
            }
          >
            From this queue your browsers run any code its tasks bring: whatever anyone who can
            write the queue puts in it.{' '}
            <button class="tq-link" onClick={() => setEditing('')}>
              Only named packages…
            </button>
          </Show>
        </p>
      </Show>
    </div>
  );
};

/** A value as it would be typed, cut short. */
function show(value: unknown) {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
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
