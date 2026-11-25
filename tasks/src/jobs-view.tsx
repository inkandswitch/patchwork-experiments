// The queue browser's view of the tasks a queue has been asked for by key
// (see jobs.ts): how each is going, and a way to ask for one, stop one, or
// forget one. Everything a tool can do through job-client.ts a person can do
// here. Also where an account says whose code its browsers run from a queue
// (see acceptance.ts).

import { createSignal, For, onCleanup, Show } from 'solid-js';
import type { AutomergeUrl, DocHandle } from '@automerge/automerge-repo/slim';
import type { JobEntry, TaskQueueDoc, WorkerDoc, TaskDoc } from './datatype';
import { isFinished, isJobEntry, type TaskState } from './jobs';
import { ask, cancel, forget, viewOf, watch, type Ask, type JobView } from './job-client';
import type { Acceptance } from './acceptance';
import { inSamePackage } from './import-url';
import { WAIT_TASK_PATH } from './ids';
import { useDoc, useRepo } from './use-doc';

/** How many keyed tasks to show; a queue that keeps its answers can hold thousands. */
const MAX_JOBS_SHOWN = 20;

const MARKS: Record<TaskState, string> = {
  waiting: '·',
  running: '●',
  stopping: '●',
  succeeded: '✓',
  failed: '✕',
  cancelled: '–',
};

/** The task-row look each state borrows: there are four, made for tasks. */
const LOOKS: Record<TaskState, string> = {
  waiting: 'queued',
  running: 'running',
  stopping: 'running',
  succeeded: 'ok',
  failed: 'failed',
  cancelled: 'queued',
};

/** The task this package brings along, as an import URL for whatever site this is; a `data:` stand-in where the package wasn't loaded from automerge. */
const WAIT_TASK_URL =
  inSamePackage(import.meta.url, WAIT_TASK_PATH) ??
  `data:text/javascript,${encodeURIComponent('export default async function (input) { return input?.value ?? null; }')}`;

export const JobsSection = (props: { handle: DocHandle<TaskQueueDoc>; queue: TaskQueueDoc }) => {
  const repo = useRepo();
  const jobs = () =>
    Object.entries(props.queue.jobs ?? {})
      .filter((pair): pair is [string, JobEntry] => isJobEntry(pair[1]))
      .sort(([, a], [, b]) => (b.askedAt || 0) - (a.askedAt || 0));
  const shown = () => jobs().slice(0, MAX_JOBS_SHOWN);
  const unfinished = () => jobs().filter(([, job]) => !job.done).length;

  return (
    <>
      <NewJobForm onAsk={(request) => ask(repo, props.handle.url, request)} />
      <section class="tq-section">
        <h2 class="tq-section-title">
          Asked for by key <span class="tq-count">{jobs().length.toLocaleString()}</span>
          <Show when={unfinished() > 0}>
            <span class="tq-section-note">{unfinished()} not finished</span>
          </Show>
          <Show when={jobs().length > shown().length}>
            <span class="tq-section-note">latest {shown().length} shown</span>
          </Show>
        </h2>
        <Show
          when={shown().length > 0}
          fallback={<p class="tq-empty">Nothing has been asked for by key yet.</p>}
        >
          <div class="tq-tasks">
            <For each={shown().map(([key]) => key)}>
              {(key) => (
                <Job
                  jobKey={key}
                  queueUrl={props.handle.url}
                  onCancel={() => cancel(repo, props.handle.url, key)}
                  onForget={() => forget(repo, props.handle.url, key)}
                />
              )}
            </For>
          </div>
        </Show>
      </section>
    </>
  );
};

/** The task under a key, kept current: its docs as they change, and its run as it's heard. */
function useJob(queueUrl: AutomergeUrl, key: string) {
  const repo = useRepo();
  const [job, setJob] = createSignal<JobView>(viewOf(key, undefined, undefined));
  onCleanup(watch(repo, queueUrl, key, (view) => setJob(() => view)));
  return job;
}

const Job = (props: {
  jobKey: string;
  queueUrl: AutomergeUrl;
  onCancel: () => void;
  onForget: () => void;
}) => {
  const job = useJob(props.queueUrl, props.jobKey);
  const task = useDoc<TaskDoc<any, any>>(() => job().taskUrl);
  const state = () => job().state as TaskState;
  const failures = () => job().runs.filter((run) => run.status === 'failed').length;

  return (
    <Show when={job().state !== 'missing'}>
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
          <Show when={failures() > 0 && state() !== 'failed'}>
            <span class="tq-tag tq-tag--warn">
              {failures()} failed {failures() === 1 ? 'try' : 'tries'}
            </span>
          </Show>
          <Show
            when={isFinished(state())}
            fallback={
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
            }
          >
            <button
              class="tq-link"
              title="Take this off the list, so that asking for it again runs it again"
              onClick={(event) => {
                event.preventDefault();
                props.onForget();
              }}
            >
              Forget
            </button>
          </Show>
        </summary>
        <div class="tq-task-detail">
          <p class="tq-choice-note">
            Asked for as <code class="tq-code">{props.jobKey}</code>
            <Show when={task()?.current}>
              {(current) => (
                <>
                  {' '}
                  · running on <WorkerName docUrl={current().workerUrl} />
                </>
              )}
            </Show>
          </p>
          <Show when={job().logs.length > 0}>
            <ul class="tq-logs">
              <For each={job().logs}>
                {(line) => (
                  <li>
                    <span class="tq-muted">
                      {new Date(line.timestampMillis).toLocaleTimeString()}
                    </span>{' '}
                    {line.message}
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <Show when={job().runs.length > 1}>
            <p class="tq-choice-note">{job().runs.length} runs so far.</p>
          </Show>
          <pre class="tq-source">{job().importUrl ?? '…'}</pre>
        </div>
      </details>
    </Show>
  );
};

/** How a task stands, in a few words: its progress while it runs, its result or what went wrong after. */
const Outcome = (props: { job: JobView }) => {
  const state = () => props.job.state;
  return (
    <>
      <Show when={state() === 'waiting'}>
        <span class="tq-muted">waiting</span>
      </Show>
      <Show when={state() === 'running'}>
        <span class="tq-busy">running {showProgress(props.job.progress)}</span>
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

const WorkerName = (props: { docUrl: AutomergeUrl }) => {
  const worker = useDoc<WorkerDoc>(() => props.docUrl);
  return <span>{worker()?.name ?? '…'}</span>;
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
            optional: asking twice under one key is asking once, and a finished task answers for
            its key until it's forgotten
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
                included, is left for other workers
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
