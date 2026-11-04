/**
 * A Talk & Draw session: hotkey → record audio + disappearing-ink strokes + snapshots
 * → Esc → build the model message (M1: dump it to the console).
 *
 * Lives entirely in the host. The UI running in the LM canvas is never touched: the
 * overlay sits above it and takes the pointer while a session is active, the overlay
 * takes keyboard focus so the canvas's key listeners go quiet, and Esc is caught in
 * the capture phase on `window`. The UI keeps running underneath (no freeze).
 */
import { isEndHotkey, isStartHotkey } from './hotkey';
import type { InkPoint, Stroke } from './ink';
import { dumpToConsole, summarizeStroke, type AudioInfo, type TalkAndDrawMessage } from './message';
import { formatTimeline } from './message';
import { Agent, EFFORTS, MODELS, clearApiKey, getApiKey, getEffort, getMaxTurns, getModel, getSystemPrompt, hasApiKey, setEffort, setMaxTurns, setModel, setSystemPrompt, type Effort } from './agent';
import { forgetNote, readNotes, type Note } from './notes';
import { Executor, type PerformOptions, type PerformResult, type Step } from './executor';
import { InkOverlay } from './overlay';
import { compositeSnapshot, imageScale, type ImageScale, type Snapshot } from './snapshot';
import { loadWhisper, transcribe } from './transcribe';
import { ELEVEN_MODELS, clearElevenKey, elevenEnabled, elevenStatus, getElevenKey, getElevenModel, getVoiceName, setElevenEnabled, setElevenModel, setVoiceName } from './tts';
import { AssistUI } from './ui';

interface AudioCapture {
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  startedAtRel: number | null;
  error: string | null;
  /** Resolves with the final blob once the recorder has stopped. */
  stopped: Promise<Blob | null> | null;
}

interface Session {
  t0: number;
  startedAt: Date;
  image: ImageScale;
  strokes: Stroke[];
  active: Stroke | null;
  nextId: number;
  snapshots: Snapshot[];
  audio: AudioCapture;
  ending: boolean;
}

const STATUS_LISTENING = 'Talk & Draw — listening · Esc to finish';

export interface AssistHandle {
  dispose(): void;
  /** Programmatic start/end, handy from the console. */
  start(): void;
  end(): Promise<void>;
  isActive(): boolean;
  /** Run an AI script (M3). Coordinates are image px at `opts.scale` (default: the
   *  last session's scale, or 1 — i.e. canvas px — before any session). */
  perform(script: Step[], opts?: PerformOptions): Promise<PerformResult>;
  cancel(): void;
  readonly executor: Executor;
  readonly agent: Agent;
  /** When false, a session only logs its message (M1 behaviour). */
  agentEnabled: boolean;
  /** Re-send the last session's message to the model. */
  ask(): Promise<void>;
  clearApiKey(): void;
  setModel(model: string | null): void;
  getModel(): string;
  setSystemPrompt(prompt: string | null): void;
  getSystemPrompt(): string;
  /** Open or close the drawer (toggles when omitted). */
  drawer(open?: boolean): void;
  /** The shared notes (`aiNotes` in the document) as plain objects. */
  notes(): Note[];
  readonly ui: AssistUI;
}

export function startAssist(lmCanvas: HTMLCanvasElement): AssistHandle {
  const overlay = new InkOverlay(lmCanvas);
  const executor = new Executor(lmCanvas, overlay);
  let session: Session | null = null;
  let lastMessage: TalkAndDrawMessage | null = null;
  const ui = new AssistUI(lmCanvas.parentElement ?? document.body, {
    models: MODELS,
    getModel,
    setModel,
    getSystemPrompt,
    setSystemPrompt,
    hasApiKey,
    askApiKey: () => {
      clearApiKey();
      getApiKey(true);
    },
    clearApiKey,
    resend: () => void handle.ask().catch((e) => console.warn('Talk & Draw:', e.message)),
    cancel: () => handle.cancel(),
    fastForward: () => {
      executor.fastForward = true;
    },
    getMaxTurns,
    setMaxTurns,
    efforts: EFFORTS,
    getEffort,
    setEffort: (e) => setEffort(e as Effort | null),
    getNotes: readNotes,
    forgetNote: (topic) => void forgetNote(topic),
    voice: {
      enabled: elevenEnabled,
      setEnabled: setElevenEnabled,
      status: elevenStatus,
      getVoiceName,
      setVoiceName,
      models: ELEVEN_MODELS,
      getModel: getElevenModel,
      setModel: setElevenModel,
      askKey: () => {
        clearElevenKey();
        setElevenEnabled(true);
        getElevenKey(true);
      },
      clearKey: clearElevenKey,
    },
  });
  executor.onNotice = (text) => ui.logEvent({ kind: 'error', text });
  const agent = new Agent(executor, (t) => ui.setStatus(t, t ? 'working' : 'idle'));
  agent.addListener((e) => ui.logEvent(e));

  const now = () => performance.now();
  const rel = () => (session ? now() - session.t0 : 0);

  function canvasPoint(e: PointerEvent): InkPoint {
    const rect = overlay.el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, t: rel() };
  }

  function snapshot(label: string): void {
    if (!session) return;
    session.snapshots.push(compositeSnapshot(lmCanvas, session.strokes, session.image, label, rel()));
  }

  // ---- keyboard ------------------------------------------------------------

  function onKeyDown(e: KeyboardEvent): void {
    if (!session) {
      if (isStartHotkey(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        start();
      }
      return;
    }
    // Everything is ours while a session is active.
    e.preventDefault();
    e.stopImmediatePropagation();
    if (isEndHotkey(e) && !session.ending) void end();
  }

  function swallowWhileActive(e: KeyboardEvent): void {
    if (!session) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // ---- pointer -------------------------------------------------------------

  function onPointerDown(e: PointerEvent): void {
    if (!session || session.active) return;
    try {
      overlay.el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const p = canvasPoint(e);
    const stroke: Stroke = { id: session.nextId++, points: [p], t0: p.t, t1: null };
    session.active = stroke;
    session.strokes.push(stroke);
    overlay.beginStroke(stroke);
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!session || !session.active) return;
    const evts: PointerEvent[] =
      typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length > 0
        ? e.getCoalescedEvents()
        : [e];
    for (const ce of evts) session.active.points.push(canvasPoint(ce));
    overlay.strokeChanged();
    e.preventDefault();
  }

  function onPointerUp(e: PointerEvent): void {
    if (!session || !session.active) return;
    endActiveStroke(canvasPoint(e));
    try {
      overlay.el.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
  }

  function endActiveStroke(last?: InkPoint): void {
    if (!session || !session.active) return;
    const stroke = session.active;
    if (last) stroke.points.push(last);
    stroke.t1 = rel();
    session.active = null;
    overlay.endStroke(stroke);
    // Synchronous, between the UI's frames: the canvas holds a complete frame.
    snapshot(`after stroke ${stroke.id}`);
  }

  // ---- audio ---------------------------------------------------------------

  function startAudio(s: Session): void {
    const a = s.audio;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      a.error = 'MediaRecorder/getUserMedia unavailable';
      ui.setStatus(`${STATUS_LISTENING} (no mic)`, 'listening');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        if (session !== s || s.ending) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        a.stream = stream;
        const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) =>
          MediaRecorder.isTypeSupported(m),
        );
        const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        a.recorder = rec;
        rec.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) a.chunks.push(ev.data);
        };
        rec.onstart = () => {
          a.startedAtRel = now() - s.t0;
        };
        a.stopped = new Promise<Blob | null>((resolve) => {
          rec.onstop = () => resolve(a.chunks.length ? new Blob(a.chunks, { type: rec.mimeType }) : null);
          rec.onerror = () => resolve(null);
        });
        rec.start();
      })
      .catch((err) => {
        a.error = err && err.message ? String(err.message) : String(err);
        if (session === s) ui.setStatus(`${STATUS_LISTENING} (no mic: ${a.error})`, 'listening');
      });
  }

  async function stopAudio(s: Session): Promise<AudioInfo> {
    const a = s.audio;
    let blob: Blob | null = null;
    if (a.recorder && a.recorder.state !== 'inactive') {
      a.recorder.stop();
      blob = a.stopped ? await a.stopped : null;
    }
    a.stream?.getTracks().forEach((t) => t.stop());
    const stoppedAtRel = now() - s.t0;
    if (blob) {
      return {
        status: 'recorded',
        mimeType: blob.type,
        bytes: blob.size,
        offsetMs: a.startedAtRel ?? undefined,
        durationMs: a.startedAtRel != null ? stoppedAtRel - a.startedAtRel : undefined,
        blob,
      };
    }
    return { status: a.error ? 'unavailable' : 'none', error: a.error ?? undefined };
  }

  // ---- lifecycle -----------------------------------------------------------

  function start(): void {
    if (session) return;
    agent.cancel();
    executor.cancel();
    const s: Session = {
      t0: now(),
      startedAt: new Date(),
      image: imageScale(lmCanvas.width, lmCanvas.height),
      strokes: [],
      active: null,
      nextId: 1,
      snapshots: [],
      audio: { stream: null, recorder: null, chunks: [], startedAtRel: null, error: null, stopped: null },
      ending: false,
    };
    session = s;
    executor.scale = s.image.scale;
    overlay.setActive(true);
    ui.setStatus(STATUS_LISTENING, 'listening');
    overlay.el.focus({ preventScroll: true });
    snapshot('start');
    startAudio(s);
    // Warm up Whisper so it is (hopefully) loaded by the time the user presses Esc.
    // Progress shows in the badge; failures are reported at transcription time.
    loadWhisper((p) => {
      if (session === s && !s.ending) ui.setStatus(`${STATUS_LISTENING} · ${p}`, 'listening');
    }).catch(() => {});
  }

  async function end(): Promise<void> {
    const s = session;
    if (!s || s.ending) return;
    s.ending = true;
    endActiveStroke();
    snapshot('final');
    overlay.setActive(false);
    ui.setStatus('Talk & Draw — finishing…');
    const audio = await stopAudio(s);
    const durationMs = now() - s.t0;
    session = null;
    lmCanvas.focus({ preventScroll: true });

    // Transcribe after the session (M2). The badge keeps showing progress; a new
    // session may start meanwhile and simply takes the badge over.
    let transcript: TalkAndDrawMessage['transcript'] = [];
    let transcriptStatus: TalkAndDrawMessage['transcriptStatus'] = 'stubbed';
    let transcriptText: string | undefined;
    let transcriptInfo: string | undefined;
    if (audio.blob) {
      ui.setStatus('Talk & Draw — transcribing…');
      try {
        const r = await transcribe(audio.blob, audio.offsetMs ?? 0, (p) => {
          if (!session) ui.setStatus(`Talk & Draw — ${p}`);
        });
        transcript = r.words;
        transcriptText = r.text;
        transcriptStatus = 'whisper';
        transcriptInfo = `${r.model} on ${r.device}, ${r.ms.toFixed(0)}ms`;
      } catch (err) {
        transcriptStatus = 'failed';
        transcriptInfo = err instanceof Error ? err.message : String(err);
        console.error('Talk & Draw: transcription failed', err);
      }
    }
    if (!session) ui.setStatus(null);

    const strokes = s.strokes.map(summarizeStroke);
    const m: TalkAndDrawMessage = {
      version: 1,
      startedAt: s.startedAt.toISOString(),
      durationMs,
      canvas: { width: lmCanvas.width, height: lmCanvas.height },
      image: s.image,
      transcript,
      transcriptStatus,
      transcriptText,
      transcriptInfo,
      audio,
      strokes,
      images: s.snapshots,
      timeline: formatTimeline(transcript, strokes, s.snapshots, durationMs / 1000),
    };
    dumpToConsole(m);
    lastMessage = m;
    if (handle.agentEnabled) await agent.run(m);
  }

  function abort(): void {
    const s = session;
    if (!s) return;
    s.ending = true;
    session = null;
    if (s.audio.recorder && s.audio.recorder.state !== 'inactive') s.audio.recorder.stop();
    s.audio.stream?.getTracks().forEach((t) => t.stop());
    overlay.clear();
    overlay.setActive(false);
    ui.setStatus(null);
  }

  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('keyup', swallowWhileActive, { capture: true });
  window.addEventListener('keypress', swallowWhileActive, { capture: true });
  overlay.el.addEventListener('pointerdown', onPointerDown);
  overlay.el.addEventListener('pointermove', onPointerMove);
  overlay.el.addEventListener('pointerup', onPointerUp);
  overlay.el.addEventListener('pointercancel', onPointerUp);

  const handle: AssistHandle = {
    start,
    end,
    isActive: () => session != null,
    perform: (script, opts) => executor.perform(script, opts),
    cancel: () => {
      agent.cancel();
      executor.cancel();
    },
    executor,
    agent,
    agentEnabled: true,
    ask: () => (lastMessage ? agent.run(lastMessage) : Promise.reject(new Error('no session yet'))),
    clearApiKey,
    setModel,
    getModel,
    setSystemPrompt,
    getSystemPrompt,
    drawer: (open) => ui.toggleDrawer(open),
    notes: readNotes,
    ui,
    dispose() {
      ui.dispose();
      abort();
      agent.cancel();
      executor.cancel();
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', swallowWhileActive, { capture: true });
      window.removeEventListener('keypress', swallowWhileActive, { capture: true });
      overlay.dispose();
      if ((window as any).talkAndDraw === handle) delete (window as any).talkAndDraw;
    },
  };
  (window as any).talkAndDraw = handle;
  return handle;
}
