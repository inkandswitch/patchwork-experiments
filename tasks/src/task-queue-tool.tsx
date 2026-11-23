import React, { Suspense, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { useRepo, useDocument, useDocHandle } from '@automerge/automerge-repo-react-hooks';
import type { AutomergeUrl, DocHandle } from '@automerge/automerge-repo/slim';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';
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

export const TaskQueueTool = (handle: DocHandle<unknown>, element: HTMLElement) => {
  const repo = (element as any).repo; // TODO: better way to get the repo
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <Suspense fallback={<div className="tq tq-loading">Loading queue…</div>}>
        <ITaskQueueBrowserTool docUrl={handle.url} />
      </Suspense>
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};

const ITaskQueueBrowserTool: React.FC<any> = ({ docUrl }) => {
  const repo = useRepo();
  const handle = useDocHandle<TaskQueueDoc>(docUrl, { suspense: true });
  const { title, activeRouter, pending, done } = handle.doc();

  // `useDocHandle` doesn't render again when the doc changes, so do that here.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    handle.on('change', rerender);
    return () => {
      handle.off('change', rerender);
    };
  }, [handle]);

  const [workers, setWorkers] = useState<AutomergeUrl[]>([]);
  // Workers whose hosts have asked not to be given work just now.
  const [paused, setPaused] = useState<AutomergeUrl[]>([]);
  const lastHeartbeatAt = useRef<number | null>(null);
  const deliveryReports = useDeliveryReports();

  // What each worker says it's running, so a pending task can say "running".
  const [runningBy, setRunningBy] = useState<Record<string, AutomergeUrl | null>>({});
  const reportCurrentTask = useCallback((workerUrl: AutomergeUrl, taskUrl: AutomergeUrl | null) => {
    setRunningBy((runningBy) =>
      (runningBy[workerUrl] ?? null) === taskUrl
        ? runningBy
        : { ...runningBy, [workerUrl]: taskUrl },
    );
  }, []);
  const running = new Set(workers.map((url) => runningBy[url]).filter((url) => !!url));

  useEffect(() => {
    const messageHandler = (m: any) => {
      const msg = m.message as MessageToTaskQueueChannel;
      // Other tools broadcast on this doc too (presence, for one).
      if (msg?.type !== 'router heartbeat') {
        return;
      }
      // Read the active router now, not when this effect ran: it changes on
      // every takeover, and a stale one makes every heartbeat look foreign.
      if (msg.routerUrl !== handle.doc().activeRouter) {
        return;
      }
      lastHeartbeatAt.current = Date.now();
      // A heartbeat a second mostly says the same thing; only a change is news.
      setWorkers((workers) => unlessSame(workers, [...msg.workerUrls].sort()));
      setPaused((paused) => unlessSame(paused, [...(msg.pausedWorkerUrls ?? [])].sort()));
    };
    handle.on('ephemeral-message', messageHandler);
    return () => {
      handle.off('ephemeral-message', messageHandler);
    };
  }, [handle]);

  const myContactUrl: AutomergeUrl | undefined = (window as any).patchwork?.account?.doc()
    ?.contactUrl;

  return (
    <div className="tq">
      <div className="tq-page">
        <header className="tq-header">
          <h1 className="tq-title">{title ?? 'Task queue'}</h1>
          <div className="tq-stats">
            <Stat value={pending.length} label="pending" />
            <Stat value={done.length} label="done" />
            <Stat value={workers.length} label={workers.length === 1 ? 'worker' : 'workers'} />
          </div>
          <RouterStatus
            key={activeRouter ?? 'none'}
            activeRouter={activeRouter}
            lastHeartbeatAt={lastHeartbeatAt}
          />
        </header>

        <section className="tq-section">
          <h2 className="tq-section-title">
            Workers <span className="tq-count">{workers.length}</span>
          </h2>
          {workers.length === 0 ? (
            <p className="tq-empty">
              {activeRouter
                ? 'No workers have reported to the router yet.'
                : 'Workers appear here once a router is in charge of this queue.'}
            </p>
          ) : (
            <div className="tq-workers">
              {workers.map((url) => (
                <Worker
                  key={url}
                  docUrl={url}
                  myContactUrl={myContactUrl}
                  paused={paused.includes(url)}
                  onCurrentTask={reportCurrentTask}
                />
              ))}
            </div>
          )}
        </section>

        <HostManners />

        <NewTaskForm onAdd={addTask} />

        <TaskList
          label="Pending"
          urls={pending}
          shownNote="next"
          running={running}
          emptyText="Nothing is waiting to run."
        />
        <TaskList
          label="Done"
          urls={done.toReversed()}
          shownNote="latest"
          emptyText="Nothing has finished yet."
        />

        <DeliveryFooter reports={deliveryReports} />
      </div>
    </div>
  );

  function addTask(inputExpr: string, code: string) {
    const input = eval(inputExpr);
    const importUrl = `data:application/javascript;base64,${btoa(code)}`;
    const taskDoc = repo.create<TaskDoc<any, any>>({ input, importUrl, runs: [] });
    handle.change((doc) => doc.pending.push(taskDoc.url));
  }
};

const Stat: React.FC<{ value: number; label: string }> = ({ value, label }) => (
  <div className="tq-stat">
    <span className="tq-stat-value">{value.toLocaleString()}</span>
    <span className="tq-stat-label">{label}</span>
  </div>
);

/**
 * Who is routing this queue, and whether they can be heard. It keeps its own
 * clock so that "last heard 7s ago" counts up without the task lists rendering
 * again every second.
 */
const RouterStatus: React.FC<{
  activeRouter: AutomergeUrl | null;
  lastHeartbeatAt: React.RefObject<number | null>;
}> = ({ activeRouter, lastHeartbeatAt }) => {
  const [now, setNow] = useState(Date.now());
  const [since] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  if (!activeRouter) {
    return (
      <div className="tq-router tq-router--none">
        <span className="tq-dot" />
        <span>No router yet. One of the browsers contributing to this queue will pick it up.</span>
      </div>
    );
  }

  const heardAt = lastHeartbeatAt.current;
  const quietFor = now - (heardAt ?? since);
  const quiet = quietFor > ROUTER_QUIET_AFTER_MS;
  return (
    <div className={`tq-router ${quiet ? 'tq-router--quiet' : 'tq-router--live'}`}>
      <span className="tq-dot" />
      <span className="tq-router-body">
        <span className="tq-router-who">
          Routed by <Router docUrl={activeRouter} />
        </span>
        {quiet ? (
          <span className="tq-router-note">
            {heardAt ? `last heard ${Math.round(quietFor / 1_000)}s ago` : 'not heard from yet'}
            ; another router takes over if this goes on
          </span>
        ) : null}
      </span>
    </div>
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
    explanation:
      "Waits until you've left the computer alone for a minute, or locked the screen.",
  },
];

/**
 * When this browser's workers take on tasks (see availability.ts), and what
 * they've decided just now. The choice is this browser's alone: it isn't in
 * the queue or the account, because a computer's manners are its own.
 */
const HostManners: React.FC = () => {
  const [mode, setMode] = useState(getAvailabilityMode);
  useEffect(() => onAvailabilityModeChange(() => setMode(getAvailabilityMode())), []);
  const status = useAvailabilityStatus();
  const [refused, setRefused] = useState(false);
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
    <section className="tq-section">
      <h2 className="tq-section-title">This browser's workers take tasks</h2>
      <div className="tq-choice" role="radiogroup" aria-label="When this browser takes tasks">
        {AVAILABILITY_MODES.map(({ mode: option, label }) => (
          <button
            key={option}
            role="radio"
            aria-checked={mode === option}
            className={`tq-choice-option ${mode === option ? 'tq-choice-option--chosen' : ''}`}
            disabled={option === 'away' && !canTellAway}
            title={
              option === 'away' && !canTellAway
                ? "This browser can't tell when you're away"
                : undefined
            }
            onClick={() => choose(option)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="tq-choice-note">
        {AVAILABILITY_MODES.find((option) => option.mode === mode)?.explanation}
        {canTellAway ? null : " “Only when I'm away” needs Chrome or Edge."}
      </p>
      {refused ? (
        <p className="tq-error">
          The browser didn't allow this site to know when you're away, so nothing changed.
        </p>
      ) : null}
      <div
        className={`tq-router ${
          !status ? 'tq-router--none' : status.available ? 'tq-router--live' : 'tq-router--quiet'
        }`}
      >
        <span className="tq-dot" />
        <span>
          {!status
            ? "Haven't heard from this browser's task workers yet."
            : status.available
              ? `Taking tasks ${status.mode === 'always' ? '' : 'because '}${status.reason}.`
              : `Paused because ${pausedBecause(status.reason)}. A task already running is left to finish.`}
        </span>
      </div>
    </section>
  );
};

/** "can't tell…" reads as a sentence after "because" only with a subject. */
function pausedBecause(reason: string) {
  return reason.startsWith("can't") ? `this browser ${reason}` : reason;
}

/** What this browser's worker pool last decided, once it has said. */
function useAvailabilityStatus() {
  const [status, setStatus] = useState<AvailabilityStatus | null>(null);
  useEffect(() => {
    const channel = new BroadcastChannel(AVAILABILITY_CHANNEL);
    channel.onmessage = ({ data }: MessageEvent<AvailabilityStatus>) => {
      setStatus((status) =>
        status &&
        status.available === data.available &&
        status.reason === data.reason &&
        status.mode === data.mode
          ? status
          : data,
      );
    };
    return () => channel.close();
  }, []);
  return status;
}

const NewTaskForm: React.FC<{ onAdd: (inputExpr: string, code: string) => void }> = ({
  onAdd,
}) => {
  const [inputExpr, setInputExpr] = useState(DEFAULT_INPUT_EXPR);
  const [code, setCode] = useState(DEFAULT_CODE);
  const [error, setError] = useState<string | null>(null);

  function add() {
    try {
      onAdd(inputExpr, code);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  return (
    <details className="tq-section tq-new">
      <summary className="tq-new-summary">New task</summary>
      <div className="tq-new-fields">
        <label className="tq-field">
          <span className="tq-field-label">Input</span>
          <span className="tq-field-hint">a JavaScript expression, evaluated here</span>
          <textarea
            className="tq-textarea"
            rows={4}
            spellCheck={false}
            value={inputExpr}
            onChange={(e) => setInputExpr(e.target.value)}
          />
        </label>
        <label className="tq-field">
          <span className="tq-field-label">Code</span>
          <span className="tq-field-hint">a module whose default export takes the input</span>
          <textarea
            className="tq-textarea"
            rows={9}
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
      </div>
      <div className="tq-new-actions">
        <button className="tq-button" onClick={add}>
          Add task
        </button>
        {error ? <span className="tq-error">Couldn't read the input: {error}</span> : null}
      </div>
    </details>
  );
};

/** The first few of `urls`, which the caller has put in the order worth reading. */
const TaskList: React.FC<{
  label: string;
  urls: AutomergeUrl[];
  /** What the ones shown are, when there are more: the "next" 20, the "latest" 20. */
  shownNote: string;
  running?: Set<AutomergeUrl | null>;
  emptyText: string;
}> = ({ label, urls, shownNote, running, emptyText }) => {
  const shown = [...new Set(urls)].slice(0, MAX_TASKS_SHOWN);
  return (
    <section className="tq-section">
      <h2 className="tq-section-title">
        {label} <span className="tq-count">{urls.length.toLocaleString()}</span>
        {urls.length > shown.length ? (
          <span className="tq-section-note">
            {shownNote} {shown.length} shown
          </span>
        ) : null}
      </h2>
      {shown.length === 0 ? (
        <p className="tq-empty">{emptyText}</p>
      ) : (
        <div className="tq-tasks">
          {shown.map((url) => (
            <Task key={url} docUrl={url} running={running?.has(url)} />
          ))}
        </div>
      )}
    </section>
  );
};

const DeliveryFooter: React.FC<{ reports: DeliveryReport[] }> = ({ reports }) => {
  if (reports.length === 0) {
    return null;
  }
  const missed = reports.reduce((n, { totals }) => n + totals.missed, 0);
  const duplicates = reports.reduce((n, { totals }) => n + totals.duplicates, 0);
  const received = reports.reduce((n, { totals }) => n + totals.received, 0);
  const trouble = missed + duplicates > 0;
  return (
    <details className={`tq-delivery ${trouble ? 'tq-delivery--trouble' : ''}`}>
      <summary>
        Messages to this browser's workers: {received.toLocaleString()} received,{' '}
        {trouble ? `${missed} missed, ${duplicates} duplicated` : 'none missed'}
      </summary>
      <table className="tq-delivery-table">
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
          {reports.map(({ label, totals }) => (
            <tr key={label}>
              <td>{label}</td>
              <td>{totals.received.toLocaleString()}</td>
              <td>{totals.missed}</td>
              <td>{totals.late}</td>
              <td>{totals.duplicates}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
};

/**
 * Shows `children`, which read a doc that may not have arrived yet. A queue
 * names its tasks, workers and router by url, and a url can get here before the
 * doc it names does; `useDocument` then throws "unavailable". Left uncaught,
 * that one missing doc takes the whole tool off the screen, so each of them
 * gets one of these, which shows a placeholder and tries again shortly.
 */
class WhenAvailable extends React.Component<
  { children: React.ReactNode; placeholder?: React.ReactNode },
  { failed: boolean; attempt: number }
> {
  state = { failed: false, attempt: 0 };
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.retryTimer = setTimeout(() => {
      this.setState(({ attempt }) => ({ failed: false, attempt: attempt + 1 }));
    }, 2_000);
  }

  componentWillUnmount() {
    clearTimeout(this.retryTimer);
  }

  render() {
    const placeholder = this.props.placeholder ?? <span className="tq-placeholder">…</span>;
    if (this.state.failed) {
      return placeholder;
    }
    return (
      <Suspense key={this.state.attempt} fallback={placeholder}>
        {this.props.children}
      </Suspense>
    );
  }
}

/** The latest delivery report from each of this browser's task shared workers. */
function useDeliveryReports() {
  const [reports, setReports] = useState<Record<string, DeliveryReport>>({});
  useEffect(() => {
    const channel = new BroadcastChannel(DELIVERY_STATS_CHANNEL);
    channel.onmessage = ({ data }: MessageEvent<DeliveryReport>) => {
      setReports((reports) => ({ ...reports, [data.label]: data }));
    };
    return () => channel.close();
  }, []);
  return Object.values(reports).sort((a, b) => a.label.localeCompare(b.label));
}

/** Whose worker or router it is, then its own name: "Ada / wet-animal". */
const Identity: React.FC<{ contactUrl?: AutomergeUrl | null; name: string }> = ({
  contactUrl,
  name,
}) => (
  <span className="tq-identity">
    {contactUrl ? <patchwork-view doc-url={contactUrl} tool-id="contact-inline" /> : null}
    <span className="tq-identity-name">{name}</span>
  </span>
);

export const Router: React.FC<{ docUrl: AutomergeUrl }> = (props) => (
  <WhenAvailable>
    <IRouter {...props} />
  </WhenAvailable>
);

const IRouter: React.FC<{ docUrl: AutomergeUrl }> = ({ docUrl }) => {
  const [{ name, contactUrl }] = useDocument<RouterDoc>(docUrl, { suspense: true });
  return <Identity contactUrl={contactUrl} name={name} />;
};

interface WorkerProps {
  docUrl: AutomergeUrl;
  myContactUrl?: AutomergeUrl;
  /** Its host has asked that it not be given work just now. */
  paused?: boolean;
  onCurrentTask: (workerUrl: AutomergeUrl, taskUrl: AutomergeUrl | null) => void;
}

export const Worker: React.FC<WorkerProps> = (props) => (
  <WhenAvailable placeholder={<div className="tq-worker tq-worker--loading">…</div>}>
    <IWorker {...props} />
  </WhenAvailable>
);

const IWorker: React.FC<WorkerProps> = ({ docUrl, myContactUrl, paused, onCurrentTask }) => {
  const [{ name, contactUrl, currentTask }] = useDocument<WorkerDoc>(docUrl, { suspense: true });
  const currentTaskUrl = currentTask?.taskUrl ?? null;
  useEffect(() => {
    onCurrentTask(docUrl, currentTaskUrl);
    return () => onCurrentTask(docUrl, null);
  }, [docUrl, currentTaskUrl, onCurrentTask]);
  return (
    <div
      className={`tq-worker ${
        currentTask ? 'tq-worker--busy' : paused ? 'tq-worker--paused' : 'tq-worker--idle'
      }`}
    >
      <span className="tq-dot" />
      <Identity contactUrl={contactUrl} name={name} />
      {myContactUrl && contactUrl === myContactUrl ? <span className="tq-tag">yours</span> : null}
      <span className="tq-worker-state">
        {currentTask ? <TaskInput docUrl={currentTask.taskUrl} /> : paused ? 'paused' : 'idle'}
      </span>
    </div>
  );
};

/** Just a task's input, for where there isn't room for the task: `[3, 7]`. */
const TaskInput: React.FC<{ docUrl: AutomergeUrl }> = (props) => (
  <WhenAvailable>
    <ITaskInput {...props} />
  </WhenAvailable>
);

const ITaskInput: React.FC<{ docUrl: AutomergeUrl }> = ({ docUrl }) => {
  const [{ input }] = useDocument<TaskDoc<any, any>>(docUrl, { suspense: true });
  return <code className="tq-code">{show(input)}</code>;
};

interface TaskProps {
  docUrl: AutomergeUrl;
  /** A worker says it's on this one right now. */
  running?: boolean;
}

const Task: React.FC<TaskProps> = (props) => (
  <WhenAvailable
    placeholder={<div className="tq-task tq-task--loading">Waiting for this task to arrive…</div>}
  >
    <ITask {...props} />
  </WhenAvailable>
);

const ITask: React.FC<TaskProps> = ({ docUrl, running }) => {
  const [{ importUrl, runs, input }] = useDocument<TaskDoc<any, any>>(docUrl, { suspense: true });
  const lastRun = runs.at(-1);
  const failures = runs.filter((run) => run.status === 'failed').length;
  const state = running
    ? 'running'
    : !lastRun
      ? 'queued'
      : lastRun.status === 'succeeded'
        ? 'ok'
        : 'failed';

  // Only read the code when someone opens the task: most rows never are.
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    if (!open || code !== null) {
      return;
    }
    let cancelled = false;
    fetch(importUrl)
      .then((res) => res.text())
      .catch(() => importUrl)
      .then((text) => {
        if (!cancelled) setCode(text);
      });
    return () => {
      cancelled = true;
    };
  }, [open, code, importUrl]);

  return (
    <details
      className={`tq-task tq-task--${state}`}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="tq-task-row">
        <span className="tq-task-mark" aria-label={state}>
          {state === 'ok' ? '✓' : state === 'failed' ? '✕' : state === 'running' ? '●' : '·'}
        </span>
        <code className="tq-code tq-task-input">{show(input)}</code>
        <span className="tq-task-outcome">
          {running ? (
            <span className="tq-busy">running</span>
          ) : !lastRun ? (
            <span className="tq-muted">waiting</span>
          ) : lastRun.status === 'succeeded' ? (
            <>
              <span className="tq-muted">→</span> <code className="tq-code">{show(lastRun.result)}</code>
            </>
          ) : (
            <span className="tq-bad">{lastLog(lastRun) ?? 'failed'}</span>
          )}
        </span>
        {failures > 0 ? (
          <span className="tq-tag tq-tag--warn">
            {failures} failed {failures === 1 ? 'try' : 'tries'}
          </span>
        ) : null}
        {lastRun && !running ? (
          <span className="tq-task-time">
            {duration(lastRun.endTimeMillis - lastRun.startTimeMillis)}
          </span>
        ) : null}
      </summary>
      <div className="tq-task-detail">
        {runs.length > 0 ? (
          <ol className="tq-runs">
            {runs.map((run: RunInfo<any>, idx) => (
              <li key={idx}>
                <WhenAvailable>
                  <Run run={run} />
                </WhenAvailable>
              </li>
            ))}
          </ol>
        ) : null}
        <pre className="tq-source">{code ?? 'Loading code…'}</pre>
      </div>
    </details>
  );
};

const Run: React.FC<{ run: RunInfo<any> }> = ({ run }) => {
  const [{ contactUrl, name }] = useDocument<WorkerDoc>(run.workerUrl as AutomergeUrl, {
    suspense: true,
  });
  return (
    <div className={`tq-run tq-run--${run.status}`}>
      <div className="tq-run-line">
        <span className="tq-task-mark">{run.status === 'succeeded' ? '✓' : '✕'}</span>
        <Identity contactUrl={contactUrl} name={name} />
        <span className="tq-muted">
          {new Date(run.startTimeMillis).toLocaleTimeString()},{' '}
          {duration(run.endTimeMillis - run.startTimeMillis)}
        </span>
      </div>
      {run.logs && run.logs.length > 0 ? (
        <ul className="tq-logs">
          {run.logs.map(({ timestampMillis, message }, idx) => (
            <li key={idx}>
              <span className="tq-muted">{new Date(timestampMillis).toLocaleTimeString()}</span>{' '}
              {message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

// helpers

/** `next`, or `previous` itself when they hold the same things, so state doesn't change. */
function unlessSame<T>(previous: T[], next: T[]) {
  return previous.length === next.length && previous.every((item, idx) => item === next[idx])
    ? previous
    : next;
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
