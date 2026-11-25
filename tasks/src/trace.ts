// Where a task's time goes: each step it passes through, in whichever tab or
// worker that happens, timestamped on one clock, for whoever asks to be told.
//
// Off unless something turns it on (the probes' latency mode does), and when
// off a step costs a comparison. Turning it on in one place turns it on in
// every tab and worker of this origin, or every thread of a Node process:
// they all listen on one BroadcastChannel, and report on it.

const TRACE_CHANNEL = 'patchwork-tasks-trace';

/** One step one task passed through. */
export interface Trace {
  /** What happened: "listed", "handed out", "code ran". */
  step: string;
  /** The task: its doc's url. */
  id: string;
  /** When, in milliseconds since 1970, to a fraction of one. */
  at: number;
  /** Where it happened: a shared worker's name, or `tab`. */
  who: string;
}

type Said = { type: 'on' } | { type: 'off' } | ({ type: 'trace' } & Trace);

/** This context: a shared worker (or a thread standing in for one) has a name, a tab hasn't. */
const WHO: string =
  typeof document === 'undefined' ? String((globalThis as any).name || 'worker') : 'tab';

let on = false;
let listener: ((trace: Trace) => void) | null = null;
let channel: BroadcastChannel | null = null;

if (typeof BroadcastChannel !== 'undefined') {
  channel = new BroadcastChannel(TRACE_CHANNEL);
  channel.onmessage = ({ data }: MessageEvent<Said>) => {
    if (data?.type === 'on') {
      on = true;
    } else if (data?.type === 'off') {
      on = false;
    } else if (data?.type === 'trace') {
      listener?.(data);
    }
  };
  // a Node process shouldn't stay up for this alone
  (channel as any).unref?.();
}

/** Notes that the task `id` has reached `step`, if anyone has asked to be told. */
export function trace(step: string, id: string) {
  if (!on) {
    return;
  }
  const noted: Trace = { step, id, at: performance.timeOrigin + performance.now(), who: WHO };
  listener?.(noted);
  channel?.postMessage({ type: 'trace', ...noted } satisfies Said);
}

/**
 * Starts telling `onTrace` every step every task takes, here and in every
 * other tab and worker. Returns how to stop.
 */
export function tracing(onTrace: (trace: Trace) => void) {
  on = true;
  listener = onTrace;
  channel?.postMessage({ type: 'on' } satisfies Said);
  return () => {
    on = false;
    listener = null;
    channel?.postMessage({ type: 'off' } satisfies Said);
  };
}
