import QRCode from 'qrcode';
import { createWasmDetector } from '../shared/qr-detector.ts';
import type { DetectedBarcodeLike, MultiDetector } from '../shared/qr-detector.ts';
import { listVideoDevices, buildVideoConstraints, waitForVideoReady, stopStream } from '../shared/camera.ts';
import { ensureAudioContext, createAudioLayer, createNoiseSource, type AudioLayer } from '../shared/audio.ts';
import { clamp, average, escapeHtml, polygonArea, computeOverlayGeometry, projectPoint } from '../shared/utils.ts';
import type { Point, NoteId, DrumId, SavedLoop, PatternColumn, StepEvent, InstrumentDoc } from '../types.ts';

type CardCategory = 'note' | 'drum' | 'rest';
type CardPayload = `note:${NoteId}` | `drum:${DrumId}` | 'rest';
type Lane = 'free';

type CardDefinition = {
  payload: CardPayload;
  category: CardCategory;
  id: NoteId | DrumId | 'rest';
  label: string;
  accent: string;
};

type VisibleCard = {
  trackingId: string;
  definition: CardDefinition;
  payload: CardPayload;
  rawValue: string;
  cornerPoints: Point[];
  x: number;
  y: number;
  area: number;
  lane: Lane;
  pitchIndex: number | null;
};

type TrackedCard = {
  id: string;
  card: VisibleCard;
  lastSeenAt: number;
  missedFrames: number;
};

type Pattern = {
  columns: PatternColumn[];
  stepCount: number;
  key: string;
};

const DEFAULT_BPM = 96;
const MIN_STEPS = 2;
const MAX_STEPS = 9;
const MAX_SCANS_PER_SECOND = 12;
const CARD_MEMORY_MS = 1800;
const TRACK_MATCH_DISTANCE_RATIO = 0.16;
const COLUMN_TOLERANCE_RATIO = 0.035;
const FRESH_OVERLAY_MS = 260;
const MAX_SAVED_LOOPS = 12;

const PITCHES = [
  { label: 'C4', frequency: 261.63 },
  { label: 'D4', frequency: 293.66 },
  { label: 'E4', frequency: 329.63 },
  { label: 'G4', frequency: 392.0 },
  { label: 'A4', frequency: 440.0 },
  { label: 'C5', frequency: 523.25 },
];

const CARD_DEFINITIONS: CardDefinition[] = [
  { payload: 'note:chime', category: 'note', id: 'chime', label: 'Chime', accent: '#71d6ff' },
  { payload: 'note:bell', category: 'note', id: 'bell', label: 'Bell', accent: '#ffdc7b' },
  { payload: 'note:pluck', category: 'note', id: 'pluck', label: 'Pluck', accent: '#9cffba' },
  { payload: 'drum:kick', category: 'drum', id: 'kick', label: 'Kick', accent: '#ff6b4a' },
  { payload: 'drum:snare', category: 'drum', id: 'snare', label: 'Snare', accent: '#f5f1e8' },
  { payload: 'drum:hat', category: 'drum', id: 'hat', label: 'Hat', accent: '#c7f0ff' },
  { payload: 'drum:shaker', category: 'drum', id: 'shaker', label: 'Shaker', accent: '#d6c3ff' },
  { payload: 'rest', category: 'rest', id: 'rest', label: 'Rest', accent: '#7d8794' },
];

const PRINTABLE_DECK: CardPayload[] = [
  'note:chime', 'note:chime', 'note:chime',
  'note:bell', 'note:bell',
  'note:pluck', 'note:pluck',
  'drum:kick', 'drum:kick',
  'drum:snare', 'drum:snare',
  'drum:hat', 'drum:hat', 'drum:hat',
  'drum:shaker', 'drum:shaker',
  'rest', 'rest', 'rest', 'rest',
];

const CARD_LIBRARY = new Map<CardPayload, CardDefinition>(
  CARD_DEFINITIONS.map((card) => [card.payload, card]),
);

const EMPTY_PATTERN: Pattern = {
  columns: [],
  stepCount: 0,
  key: 'empty',
};

const STYLE = `
.instrument-shell {
  --ink: #f7f3e9;
  --muted: rgba(247, 243, 233, 0.66);
  --panel: rgba(13, 15, 18, 0.72);
  --panel-strong: rgba(7, 9, 12, 0.88);
  --line: rgba(247, 243, 233, 0.16);
  --blue: #71d6ff;
  --green: #9cffba;
  --gold: #ffdc7b;
  --red: #ff6b4a;
  --violet: #d6c3ff;
  font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
  color: var(--ink);
  background: #101318;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.instrument-shell * {
  box-sizing: border-box;
}

.instrument-shell button,
.instrument-shell select {
  border: 0;
  font: inherit;
}

.instrument-shell button,
.instrument-shell a,
.instrument-shell select {
  color: inherit;
}

.instrument-canvas {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.performance-console {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 12px;
  padding: 14px;
}

.control-strip {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(7, 9, 12, 0.58);
  backdrop-filter: blur(18px);
}

.primary-action,
.secondary-action,
.camera-select {
  min-height: 38px;
  border-radius: 6px;
  border: 1px solid var(--line);
  padding: 0 12px;
  background: rgba(12, 14, 18, 0.7);
  text-decoration: none;
  white-space: nowrap;
}

.primary-action {
  cursor: pointer;
  color: #101318;
  background: var(--gold);
}

.secondary-action,
.camera-select {
  cursor: pointer;
  color: var(--ink);
}

.loop-lock-action.is-locked {
  color: #101318;
  border-color: color-mix(in srgb, var(--green) 70%, white);
  background: linear-gradient(135deg, var(--green), var(--gold));
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.12) inset,
    0 0 24px rgba(156, 255, 186, 0.22);
}

.primary-action:disabled,
.secondary-action:disabled,
.camera-select:disabled {
  opacity: 0.56;
  cursor: default;
}

.camera-select {
  min-width: 150px;
  max-width: 220px;
}

.status-pill {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: rgba(12, 14, 18, 0.56);
  white-space: nowrap;
}

.status-pill span {
  color: var(--muted);
  font-size: 0.78rem;
}

.status-pill strong {
  font-size: 0.9rem;
}

.tempo-control {
  min-height: 38px;
  min-width: 210px;
  display: grid;
  grid-template-columns: auto minmax(88px, 1fr) 34px;
  align-items: center;
  gap: 9px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: rgba(12, 14, 18, 0.56);
}

.tempo-control span {
  color: var(--muted);
  font-size: 0.78rem;
}

.tempo-control strong {
  text-align: right;
  font-size: 0.9rem;
}

.tempo-control input {
  width: 100%;
  accent-color: var(--gold);
}

.workbench {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.8fr);
  gap: 12px;
}

.music-panel,
.camera-shell,
.pattern-strip {
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  box-shadow: 0 18px 70px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(18px);
}

.music-panel {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  padding: 18px;
}

.meter-readout {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}

.meter-readout strong {
  font-size: clamp(2.4rem, 6.5vw, 6rem);
  line-height: 0.85;
  letter-spacing: 0;
}

.meter-readout span {
  color: var(--muted);
  font-size: 1rem;
}

.sequencer-grid {
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(var(--step-count, 4), minmax(54px, 1fr));
  gap: 8px;
}

.step-column {
  min-height: 0;
  display: grid;
  grid-template-rows: 1fr 1fr;
  border: 1px solid rgba(247, 243, 233, 0.13);
  background: rgba(10, 12, 15, 0.42);
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    background 160ms ease,
    box-shadow 160ms ease;
}

.step-column.is-active {
  transform: translateY(-5px);
  border-color: rgba(255, 255, 255, 0.58);
  background: rgba(255, 255, 255, 0.08);
  box-shadow:
    0 0 30px rgba(113, 214, 255, 0.2),
    0 20px 48px rgba(0, 0, 0, 0.3);
}

.lane-cell {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
  gap: 5px;
  padding: 8px 5px;
}

.melody-cell {
  border-bottom: 1px solid rgba(247, 243, 233, 0.12);
  background: linear-gradient(180deg, rgba(113, 214, 255, 0.12), transparent);
}

.drum-cell {
  background: linear-gradient(0deg, rgba(255, 107, 74, 0.14), transparent);
}

.event-chip {
  min-width: 0;
  width: 100%;
  display: grid;
  gap: 3px;
  place-items: center;
  padding: 8px 5px;
  border-radius: 5px;
  border: 1px solid color-mix(in srgb, var(--event-color) 60%, transparent);
  color: white;
  background: color-mix(in srgb, var(--event-color) 22%, rgba(0, 0, 0, 0.3));
  box-shadow: 0 0 22px color-mix(in srgb, var(--event-color) 20%, transparent);
  font-size: clamp(0.68rem, 1.15vw, 0.88rem);
  text-align: center;
  overflow-wrap: anywhere;
}

.event-chip small {
  color: rgba(255, 255, 255, 0.72);
  font-size: 0.78em;
}

.rest-mark {
  color: rgba(255, 255, 255, 0.26);
  font-size: 1.5rem;
}

.camera-shell {
  position: relative;
  overflow: hidden;
  min-height: 0;
  display: grid;
  place-items: center;
  padding: 8px;
}

.camera-frame {
  position: relative;
  width: 100%;
  max-width: 100%;
  max-height: 100%;
  background: #07090c;
}

.camera-frame video,
.scanner-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.camera-frame video {
  object-fit: contain;
  background: #07090c;
}

.scanner-overlay {
  pointer-events: none;
}

.qr-outline {
  fill: rgba(255, 255, 255, 0.08);
  stroke-width: 3;
}

.qr-outline.held {
  opacity: 0.45;
  stroke-dasharray: 8 6;
}

.qr-outline.note {
  stroke: var(--blue);
}

.qr-outline.drum {
  stroke: var(--red);
}

.qr-outline.rest {
  stroke: var(--muted);
}

.qr-label {
  fill: white;
  stroke: rgba(0, 0, 0, 0.72);
  stroke-width: 3px;
  paint-order: stroke;
  font: 700 13px "Segoe UI", sans-serif;
}

.pattern-strip {
  min-height: 106px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) minmax(280px, 0.58fr);
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
}

.pattern-strip h2 {
  margin: 0;
  min-width: 130px;
  font-size: 1rem;
  font-weight: 700;
}

.step-list {
  min-width: 0;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(120px, 1fr);
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.step-row {
  min-width: 0;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  grid-template-rows: auto auto;
  gap: 3px 7px;
  align-items: center;
  padding: 8px;
  border: 1px solid rgba(247, 243, 233, 0.1);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
}

.step-row span {
  grid-row: 1 / span 2;
  color: var(--muted);
}

.step-row strong {
  min-width: 0;
  font-size: 0.82rem;
  overflow-wrap: anywhere;
}

.empty-state {
  margin: 0;
  color: var(--muted);
}

.loop-bank {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.loop-bank-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.loop-bank-heading strong {
  font-size: 0.88rem;
}

.loop-bank-heading span {
  color: var(--muted);
  font-size: 0.74rem;
}

.loop-list {
  min-width: 0;
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.loop-chip {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: minmax(92px, 1fr) auto auto;
  align-items: stretch;
  overflow: hidden;
  border: 1px solid rgba(247, 243, 233, 0.12);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
}

.loop-chip button {
  min-height: 44px;
  padding: 6px 8px;
  border-left: 1px solid rgba(247, 243, 233, 0.1);
  color: var(--ink);
  background: transparent;
  cursor: pointer;
}

.loop-chip button:first-child {
  border-left: 0;
  text-align: left;
}

.loop-chip strong,
.loop-chip span {
  display: block;
  white-space: nowrap;
}

.loop-chip span {
  color: var(--muted);
  font-size: 0.74rem;
}

@media (max-width: 900px) {
  .instrument-shell {
    overflow: auto;
  }

  .performance-console {
    min-height: 100%;
    height: auto;
  }

  .control-strip {
    flex-wrap: wrap;
  }

  .workbench {
    grid-template-columns: 1fr;
  }

  .camera-shell {
    min-height: 280px;
    aspect-ratio: 16 / 9;
  }

  .music-panel {
    min-height: 380px;
  }

  .pattern-strip {
    grid-template-columns: 1fr;
  }
}
`;

export default function InstrumentTool(handle: any, element: HTMLElement) {
  // ── DOM ──────────────────────────────────────────────────────────────────────

  element.style.position = 'relative';
  element.style.overflow = 'hidden';

  element.innerHTML = `
    <main class="instrument-shell">
      <canvas class="instrument-canvas" aria-hidden="true"></canvas>

      <section class="performance-console" aria-label="QR instrument">
        <header class="control-strip">
          <button class="primary-action js-start-camera" type="button">Start Camera + Audio</button>
          <button class="secondary-action js-print-cards" type="button">Cards</button>
          <button class="secondary-action loop-lock-action js-loop-lock" type="button" title="Freeze or release the current loop (L)">Lock Loop</button>
          <button class="secondary-action js-save-loop" type="button" title="Save the current loop to the loop bank">Save Loop</button>
          <select class="camera-select js-camera-select" aria-label="Camera"></select>
          <div class="status-pill">
            <span>Scanner</span>
            <strong class="js-scanner-status">Standby</strong>
          </div>
          <div class="status-pill">
            <span>Visible</span>
            <strong class="js-visible-status">0 cards</strong>
          </div>
          <label class="tempo-control">
            <span>Tempo</span>
            <input class="js-tempo-slider" type="range" min="48" max="180" step="1" value="${DEFAULT_BPM}" />
            <strong class="js-tempo-control-label">${DEFAULT_BPM}</strong>
          </label>
          <button class="secondary-action js-toggle-fullscreen" type="button">Fullscreen</button>
        </header>

        <section class="workbench">
          <section class="music-panel">
            <div class="meter-readout">
              <strong class="js-meter-label">0-step</strong>
              <span class="js-tempo-label">96 BPM</span>
            </div>
            <div class="sequencer-grid js-sequencer-grid" aria-label="Current pattern"></div>
          </section>
          <div class="camera-shell">
            <div class="camera-frame js-camera-frame">
              <video class="js-camera" autoplay muted playsinline></video>
              <div class="scanner-overlay js-scanner-overlay"></div>
            </div>
          </div>
        </section>

        <footer class="pattern-strip">
          <h2 class="js-pattern-title">QR Instrument</h2>
          <div class="step-list js-step-list"></div>
          <section class="loop-bank" aria-label="Saved loops">
            <div class="loop-bank-heading">
              <strong>Saved Loops</strong>
              <span class="js-loop-bank-status">none yet</span>
            </div>
            <div class="loop-list js-loop-list"></div>
          </section>
        </footer>
      </section>
    </main>
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  element.appendChild(styleEl);

  // ── Local queries ───────────────────────────────────────────────────────────

  function q<T extends Element>(selector: string): T {
    const el = element.querySelector<T>(selector);
    if (!el) throw new Error(`Required element not found: ${selector}`);
    return el;
  }

  const canvas = q<HTMLCanvasElement>('.instrument-canvas');
  const ctx = canvas.getContext('2d')!;
  const sequencerGrid = q<HTMLDivElement>('.js-sequencer-grid');
  const meterLabel = q<HTMLElement>('.js-meter-label');
  const tempoLabel = q<HTMLElement>('.js-tempo-label');
  const startCameraButton = q<HTMLButtonElement>('.js-start-camera');
  const printCardsButton = q<HTMLButtonElement>('.js-print-cards');
  const loopLockButton = q<HTMLButtonElement>('.js-loop-lock');
  const saveLoopButton = q<HTMLButtonElement>('.js-save-loop');
  const cameraSelect = q<HTMLSelectElement>('.js-camera-select');
  const scannerStatus = q<HTMLElement>('.js-scanner-status');
  const visibleStatus = q<HTMLElement>('.js-visible-status');
  const tempoSlider = q<HTMLInputElement>('.js-tempo-slider');
  const tempoControlLabel = q<HTMLElement>('.js-tempo-control-label');
  const cameraFrame = q<HTMLDivElement>('.js-camera-frame');
  const video = q<HTMLVideoElement>('.js-camera');
  const overlay = q<HTMLDivElement>('.js-scanner-overlay');
  const stepList = q<HTMLDivElement>('.js-step-list');
  const patternTitle = q<HTMLHeadingElement>('.js-pattern-title');
  const fullscreenButton = q<HTMLButtonElement>('.js-toggle-fullscreen');
  const loopList = q<HTMLDivElement>('.js-loop-list');
  const loopBankStatus = q<HTMLElement>('.js-loop-bank-status');

  // ── State ───────────────────────────────────────────────────────────────────

  let detector: MultiDetector = createWasmDetector();
  let currentStream: MediaStream | null = null;
  let cameraReady = false;
  let cameraStarting = false;
  let selectedCameraId: string | null = null;
  let scanLoopHandle = 0;
  let scanInFlight = false;
  let lastScanAt = 0;
  let visibleCards: VisibleCard[] = [];
  let trackedCards = new Map<string, TrackedCard>();
  let nextTrackingId = 1;
  let lastSeenCount = 0;
  let pendingPattern: Pattern = EMPTY_PATTERN;
  let activePattern: Pattern = EMPTY_PATTERN;
  let loopLocked = false;
  let savedLoops: SavedLoop[] = loadSavedLoops();
  let currentStep = 0;
  let bpm = loadTempo();
  let nextStepAt = performance.now() + getStepMs();
  let audioLayer: AudioLayer | null = null;
  let destroyed = false;
  let visualsHandle = 0;
  let clockHandle = 0;

  // Sync slider with persisted tempo
  tempoSlider.value = String(bpm);

  // ── Persistence helpers ─────────────────────────────────────────────────────

  function loadTempo(): number {
    try {
      const doc = handle.doc();
      return doc?.tempo ?? DEFAULT_BPM;
    } catch {
      return DEFAULT_BPM;
    }
  }

  function loadSavedLoops(): SavedLoop[] {
    try {
      const doc = handle.doc();
      const rawLoops = doc?.savedLoops;
      if (!Array.isArray(rawLoops)) return [];
      return rawLoops
        .map(normalizeSavedLoop)
        .filter((loop: SavedLoop | null): loop is SavedLoop => Boolean(loop))
        .slice(0, MAX_SAVED_LOOPS);
    } catch {
      return [];
    }
  }

  function persistSavedLoops() {
    handle.change((doc: InstrumentDoc) => {
      doc.savedLoops = savedLoops.map((loop) => ({
        id: loop.id,
        name: loop.name,
        createdAt: loop.createdAt,
        columns: loop.columns.map(cloneColumn),
        stepCount: loop.stepCount,
        key: loop.key,
      }));
    });
  }

  function persistTempo() {
    handle.change((doc: InstrumentDoc) => {
      doc.tempo = bpm;
    });
  }

  // ── Pattern helpers ─────────────────────────────────────────────────────────

  function createPattern(columns: PatternColumn[]): Pattern {
    const normalizedColumns = columns.slice(0, MAX_STEPS).map(cloneColumn);
    const key = normalizedColumns.map(columnKey).join('/');
    return { columns: normalizedColumns, stepCount: normalizedColumns.length, key: key || 'empty' };
  }

  function columnKey(column: PatternColumn) {
    return `${column.rest ? 'rest' : '-'}|${column.melodies.map(eventKey).join('+') || '-'}|${column.drums.map(eventKey).join('+') || '-'}`;
  }

  function eventKey(event: StepEvent) {
    return `${event.payload}:${event.pitchIndex ?? '-'}`;
  }

  function clonePattern(pattern: Pattern): Pattern {
    return createPattern(pattern.columns);
  }

  function cloneColumn(column: PatternColumn): PatternColumn {
    return {
      x: column.x,
      melodies: column.melodies.map(cloneStepEvent),
      drums: column.drums.map(cloneStepEvent),
      rest: column.rest,
    };
  }

  function cloneStepEvent(event: StepEvent): StepEvent {
    return { ...event };
  }

  function patternToSavedLoop(pattern: Pattern, name: string): SavedLoop {
    return {
      id: createLoopId(),
      name,
      createdAt: Date.now(),
      columns: pattern.columns.map(cloneColumn),
      stepCount: pattern.stepCount,
      key: pattern.key,
    };
  }

  function savedLoopToPattern(loop: SavedLoop): Pattern {
    return createPattern(loop.columns);
  }

  function normalizeSavedLoop(loop: Partial<SavedLoop> | null): SavedLoop | null {
    if (!loop?.id || !loop.columns?.length) {
      // Try legacy shape with nested pattern
      const legacy = loop as any;
      if (legacy?.pattern?.columns?.length) {
        return normalizeSavedLoop({
          id: legacy.id,
          name: legacy.name,
          createdAt: legacy.createdAt,
          columns: legacy.pattern.columns,
          stepCount: legacy.pattern.stepCount ?? legacy.pattern.columns.length,
          key: legacy.pattern.key ?? '',
        });
      }
      return null;
    }
    const normalized = loop.columns.map(normalizePatternColumn);
    const pat = createPattern(normalized);
    return {
      id: String(loop.id),
      name: loop.name ? String(loop.name) : `${pat.stepCount}-step loop`,
      createdAt: Number(loop.createdAt) || Date.now(),
      columns: pat.columns,
      stepCount: pat.stepCount,
      key: pat.key,
    };
  }

  function normalizePatternColumn(column: PatternColumn): PatternColumn {
    const legacyColumn = column as Omit<PatternColumn, 'drums'> & {
      melody?: StepEvent | null;
      drums?: StepEvent[] | StepEvent | null;
    };
    const melodies = Array.isArray(column.melodies)
      ? column.melodies
      : legacyColumn.melody
        ? [legacyColumn.melody]
        : [];
    const rawDrums = legacyColumn.drums;
    const drums = Array.isArray(rawDrums) ? rawDrums : rawDrums ? [rawDrums] : [];
    return {
      x: Number(column.x) || 0,
      melodies: melodies.map(cloneStepEvent),
      drums: drums.map(cloneStepEvent),
      rest: Boolean(column.rest),
    };
  }

  function createLoopId() {
    return globalThis.crypto?.randomUUID?.() ?? `loop-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function mergePatterns(base: Pattern, addition: Pattern): Pattern {
    const columns: PatternColumn[] = [];
    const count = Math.min(MAX_STEPS, Math.max(base.stepCount, addition.stepCount));
    for (let index = 0; index < count; index += 1) {
      const baseColumn = base.columns[index];
      const addColumn = addition.columns[index];
      if (baseColumn && addColumn) {
        columns.push(mergeColumns(baseColumn, addColumn));
      } else if (baseColumn) {
        columns.push(cloneColumn(baseColumn));
      } else if (addColumn) {
        columns.push(cloneColumn(addColumn));
      }
    }
    return createPattern(columns);
  }

  function mergeColumns(base: PatternColumn, addition: PatternColumn): PatternColumn {
    if (addition.rest) return { x: base.x, melodies: [], drums: [], rest: true };
    if (base.rest) return cloneColumn(addition);
    return {
      x: base.x,
      melodies: mergeEvents(base.melodies, addition.melodies),
      drums: mergeEvents(base.drums, addition.drums),
      rest: false,
    };
  }

  function mergeEvents(base: StepEvent[], addition: StepEvent[]) {
    const merged = [...base.map(cloneStepEvent)];
    const existingKeys = new Set(merged.map(eventKey));
    for (const event of addition) {
      const key = eventKey(event);
      if (!existingKeys.has(key)) {
        merged.push(cloneStepEvent(event));
        existingKeys.add(key);
      }
    }
    return merged;
  }

  // ── Camera ──────────────────────────────────────────────────────────────────

  async function probeCameraAvailability() {
    if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices.enumerateDevices) {
      scannerStatus.textContent = 'Unavailable';
      startCameraButton.disabled = true;
      return;
    }
    const devices = await listVideoDevices().catch(() => [] as MediaDeviceInfo[]);
    if (!devices.length) {
      scannerStatus.textContent = 'No camera';
      startCameraButton.disabled = true;
    }
  }

  async function startCamera(nextDeviceId?: string) {
    if (cameraStarting) return;
    cameraStarting = true;
    startCameraButton.disabled = true;
    startCameraButton.textContent = cameraReady ? 'Switching...' : 'Starting...';
    scannerStatus.textContent = 'Requesting';

    try {
      await ensureAudio();
      stopDetectionLoop();
      stopCurrentStream();
      visibleCards = [];
      trackedCards.clear();
      nextTrackingId = 1;
      pendingPattern = EMPTY_PATTERN;
      activePattern = EMPTY_PATTERN;
      loopLocked = false;
      currentStep = 0;
      detector = createWasmDetector();
      renderOverlay([]);
      renderPattern();
      syncLoopLockButton();

      selectedCameraId = nextDeviceId ?? selectedCameraId;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: buildVideoConstraints(selectedCameraId),
      });

      currentStream = stream;
      video.srcObject = stream;
      await waitForVideoReady(video);
      await video.play();

      const track = stream.getVideoTracks()[0];
      selectedCameraId = track?.getSettings().deviceId ?? selectedCameraId;
      cameraReady = true;
      syncCameraFrame();
      await populateCameraSelect();
      startDetectionLoop();

      scannerStatus.textContent = 'Watching';
      startCameraButton.textContent = 'Camera + Audio Ready';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      cameraReady = false;
      scannerStatus.textContent = message.slice(0, 28);
      startCameraButton.textContent = 'Retry Camera + Audio';
      stopCurrentStream();
    } finally {
      startCameraButton.disabled = false;
      cameraStarting = false;
    }
  }

  function startDetectionLoop() {
    stopDetectionLoop();
    scanLoopHandle = window.requestAnimationFrame(scanFrame);
  }

  function stopDetectionLoop() {
    if (scanLoopHandle) {
      window.cancelAnimationFrame(scanLoopHandle);
      scanLoopHandle = 0;
    }
  }

  async function scanFrame(timestamp: number) {
    if (!cameraReady || destroyed) return;

    if (scanInFlight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      scanLoopHandle = window.requestAnimationFrame(scanFrame);
      return;
    }

    const minInterval = 1000 / MAX_SCANS_PER_SECOND;
    if (timestamp - lastScanAt < minInterval) {
      scanLoopHandle = window.requestAnimationFrame(scanFrame);
      return;
    }

    lastScanAt = timestamp;
    scanInFlight = true;

    try {
      const detections = await detector.detect(video);
      const detectedCards = detections
        .map(toVisibleCard)
        .filter((card): card is VisibleCard => Boolean(card))
        .sort((left, right) => left.x - right.x);

      lastSeenCount = detectedCards.length;
      visibleCards = updateTrackedCards(detectedCards, performance.now());
      pendingPattern = resolvePattern(visibleCards);
      syncVisibleStatus();
      renderOverlay(visibleCards);
    } catch {
      lastSeenCount = 0;
      visibleCards = updateTrackedCards([], performance.now());
      pendingPattern = resolvePattern(visibleCards);
      syncVisibleStatus();
      renderOverlay(visibleCards);
    } finally {
      scanInFlight = false;
      if (cameraReady && !destroyed) {
        scanLoopHandle = window.requestAnimationFrame(scanFrame);
      }
    }
  }

  function stopCurrentStream() {
    if (!currentStream) return;
    stopStream(currentStream);
    currentStream = null;
    video.srcObject = null;
    cameraReady = false;
  }

  function syncCameraFrame() {
    if (!video.videoWidth || !video.videoHeight) return;
    cameraFrame.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  }

  async function populateCameraSelect() {
    const cameras = await listVideoDevices().catch(() => [] as MediaDeviceInfo[]);
    cameraSelect.innerHTML = cameras.map((camera) =>
      `<option value="${camera.deviceId}">${escapeHtml(camera.label || 'Camera')}</option>`,
    ).join('');
    cameraSelect.disabled = cameras.length <= 1;
    if (selectedCameraId) {
      const matching = cameras.find((camera) => camera.deviceId === selectedCameraId);
      if (matching) cameraSelect.value = matching.deviceId;
    }
  }

  // ── Card tracking ───────────────────────────────────────────────────────────

  function updateTrackedCards(detectedCards: VisibleCard[], now: number) {
    const matchedTrackedIds = new Set<string>();
    const matchDistance = Math.max(video.videoWidth, video.videoHeight) * TRACK_MATCH_DISTANCE_RATIO;

    for (const detectedCard of detectedCards.sort((left, right) => right.area - left.area)) {
      const match = findMatchingTrackedCard(detectedCard, matchedTrackedIds, matchDistance);
      const id = match?.id ?? `card-${nextTrackingId}`;
      if (!match) nextTrackingId += 1;

      const card = { ...detectedCard, trackingId: id };
      trackedCards.set(id, {
        id,
        card: match ? smoothVisibleCard(match.card, card) : card,
        lastSeenAt: now,
        missedFrames: 0,
      });
      matchedTrackedIds.add(id);
    }

    for (const [id, tracked] of trackedCards) {
      if (matchedTrackedIds.has(id)) continue;
      tracked.missedFrames += 1;
      if (now - tracked.lastSeenAt > CARD_MEMORY_MS) trackedCards.delete(id);
    }

    return [...trackedCards.values()]
      .map((tracked) => tracked.card)
      .sort((left, right) => left.x - right.x);
  }

  function findMatchingTrackedCard(card: VisibleCard, usedIds: Set<string>, maxDistance: number) {
    let bestMatch: TrackedCard | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const tracked of trackedCards.values()) {
      if (usedIds.has(tracked.id) || tracked.card.payload !== card.payload) continue;
      const distance = Math.hypot(tracked.card.x - card.x, tracked.card.y - card.y);
      if (distance < maxDistance && distance < bestDistance) {
        bestMatch = tracked;
        bestDistance = distance;
      }
    }
    return bestMatch;
  }

  function smoothVisibleCard(previous: VisibleCard, next: VisibleCard) {
    const positionBlend = 0.78;
    const cornerBlend = 0.58;
    const x = previous.x + (next.x - previous.x) * positionBlend;
    const y = previous.y + (next.y - previous.y) * positionBlend;
    const cornerPoints = previous.cornerPoints.length === next.cornerPoints.length
      ? previous.cornerPoints.map((point, index) => ({
          x: point.x + (next.cornerPoints[index].x - point.x) * cornerBlend,
          y: point.y + (next.cornerPoints[index].y - point.y) * cornerBlend,
        }))
      : next.cornerPoints;
    return {
      ...next,
      trackingId: next.trackingId,
      x,
      y,
      cornerPoints,
      area: previous.area + (next.area - previous.area) * positionBlend,
      lane: stableLane(previous.lane, next.lane, y),
      pitchIndex: next.pitchIndex,
    } satisfies VisibleCard;
  }

  function stableLane(previousLane: Lane, nextLane: Lane, _y: number) {
    return previousLane === nextLane ? nextLane : 'free';
  }

  // ── Pattern resolution ──────────────────────────────────────────────────────

  function resolvePattern(cards: VisibleCard[]): Pattern {
    if (!cards.length || !video.videoWidth) return EMPTY_PATTERN;

    const tolerance = video.videoWidth * COLUMN_TOLERANCE_RATIO;
    const clusters: VisibleCard[][] = [];

    for (const card of cards) {
      const cluster = clusters.find((candidate) => {
        const center = average(candidate.map((item) => item.x));
        return Math.abs(center - card.x) <= tolerance;
      });
      if (cluster) {
        cluster.push(card);
      } else {
        clusters.push([card]);
      }
    }

    const sortedClusters = clusters
      .map((cluster) => ({ x: average(cluster.map((c) => c.x)), cards: cluster }))
      .sort((left, right) => left.x - right.x)
      .slice(0, MAX_STEPS);

    const columns = sortedClusters.map((cluster) => {
      const restCard = chooseCategoryCard(cluster.cards, 'rest');
      const melodies = restCard ? [] : chooseCategoryCards(cluster.cards, 'note').map(toStepEvent);
      const drums = restCard ? [] : chooseCategoryCards(cluster.cards, 'drum').map(toStepEvent);
      return { x: cluster.x, melodies, drums, rest: Boolean(restCard) } satisfies PatternColumn;
    });

    return createPattern(columns);
  }

  function chooseCategoryCard(cards: VisibleCard[], category: CardCategory) {
    return chooseCategoryCards(cards, category)[0] ?? null;
  }

  function chooseCategoryCards(cards: VisibleCard[], category: CardCategory) {
    return cards
      .filter((card) => card.definition.category === category)
      .sort((left, right) => left.y - right.y || right.area - left.area);
  }

  function toStepEvent(card: VisibleCard): StepEvent {
    return {
      payload: card.payload,
      label: card.definition.label,
      category: card.definition.category,
      pitchIndex: card.definition.category === 'note' ? card.pitchIndex : null,
      velocity: card.definition.category === 'drum'
        ? clamp(1 - card.y / Math.max(1, video.videoHeight), 0.35, 1)
        : 0.85,
    };
  }

  function toVisibleCard(detection: DetectedBarcodeLike): VisibleCard | null {
    const rawValue = detection.rawValue?.trim().toLowerCase();
    const payload = normalizePayload(rawValue);
    const definition = payload ? CARD_LIBRARY.get(payload) : null;
    const cornerPoints = detection.cornerPoints ?? [];

    if (!rawValue || !payload || !definition || cornerPoints.length < 3 || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    const centroid = cornerPoints.reduce(
      (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
      { x: 0, y: 0 },
    );
    const x = centroid.x / cornerPoints.length;
    const y = centroid.y / cornerPoints.length;
    const normalizedY = y / video.videoHeight;

    return {
      definition,
      trackingId: '',
      payload,
      rawValue,
      cornerPoints,
      x,
      y,
      area: polygonArea(cornerPoints),
      lane: 'free',
      pitchIndex: definition.category === 'note' ? getPitchIndex(normalizedY) : null,
    } satisfies VisibleCard;
  }

  function normalizePayload(rawValue: string | undefined): CardPayload | null {
    if (!rawValue) return null;
    if (CARD_LIBRARY.has(rawValue as CardPayload)) return rawValue as CardPayload;
    return null;
  }

  function getPitchIndex(normalizedY: number) {
    const inverted = 1 - clamp(normalizedY, 0, 1);
    return clamp(Math.round(inverted * (PITCHES.length - 1)), 0, PITCHES.length - 1);
  }

  // ── Status / UI sync ────────────────────────────────────────────────────────

  function syncVisibleStatus() {
    const heldCount = visibleCards.length;
    const stepCount = pendingPattern.stepCount;
    if (lastSeenCount === heldCount && heldCount === stepCount) {
      visibleStatus.textContent = `${heldCount} card${heldCount === 1 ? '' : 's'}`;
      return;
    }
    visibleStatus.textContent = `${lastSeenCount} seen / ${heldCount} held / ${stepCount} steps`;
  }

  function syncTempoLabels() {
    tempoLabel.textContent = `${bpm} BPM`;
    tempoControlLabel.textContent = String(bpm);
  }

  function syncLoopLockButton() {
    loopLockButton.classList.toggle('is-locked', loopLocked);
    loopLockButton.textContent = loopLocked ? 'Live Scan' : 'Lock Loop';
    loopLockButton.title = loopLocked
      ? 'Release the locked loop and return to live camera control (L)'
      : 'Freeze the current loop so the cards can move without changing it (L)';
  }

  function getStepMs() {
    return 60_000 / bpm;
  }

  // ── Loop lock / save / load ─────────────────────────────────────────────────

  function toggleLoopLock() {
    if (loopLocked) {
      loopLocked = false;
      if (pendingPattern.stepCount) {
        activePattern = pendingPattern;
        currentStep %= activePattern.stepCount;
      }
      renderPattern();
      syncLoopLockButton();
      return;
    }

    const patternToLock = pendingPattern.stepCount ? pendingPattern : activePattern;
    if (!patternToLock.stepCount) {
      loopLockButton.animate(
        [
          { transform: 'translateX(0)' },
          { transform: 'translateX(-4px)' },
          { transform: 'translateX(4px)' },
          { transform: 'translateX(0)' },
        ],
        { duration: 180, easing: 'ease-out' },
      );
      return;
    }

    activePattern = patternToLock;
    loopLocked = true;
    currentStep %= activePattern.stepCount;
    renderPattern();
    syncLoopLockButton();
  }

  function saveCurrentLoop() {
    const patternToSave = loopLocked
      ? activePattern
      : pendingPattern.stepCount
        ? pendingPattern
        : activePattern;
    if (!patternToSave.stepCount) {
      saveLoopButton.animate(
        [
          { transform: 'translateY(0)' },
          { transform: 'translateY(-3px)' },
          { transform: 'translateY(0)' },
        ],
        { duration: 160, easing: 'ease-out' },
      );
      return;
    }

    const loop = patternToSavedLoop(clonePattern(patternToSave), `Loop ${savedLoops.length + 1}`);
    savedLoops = [loop, ...savedLoops].slice(0, MAX_SAVED_LOOPS);
    persistSavedLoops();
    renderLoopBank();
  }

  function loadSavedLoop(loopId: string) {
    const loop = savedLoops.find((candidate) => candidate.id === loopId);
    if (!loop) return;

    activePattern = savedLoopToPattern(loop);
    pendingPattern = pendingPattern.stepCount ? pendingPattern : savedLoopToPattern(loop);
    loopLocked = true;
    currentStep %= activePattern.stepCount;
    renderPattern();
    syncLoopLockButton();
  }

  function addLiveToSavedLoop(loopId: string) {
    const loop = savedLoops.find((candidate) => candidate.id === loopId);
    if (!loop || !pendingPattern.stepCount) return;

    const merged = mergePatterns(savedLoopToPattern(loop), pendingPattern);
    loop.columns = merged.columns;
    loop.stepCount = merged.stepCount;
    loop.key = merged.key;
    loop.name = `${merged.stepCount}-step loop`;
    persistSavedLoops();
    renderLoopBank();

    activePattern = savedLoopToPattern(loop);
    loopLocked = true;
    currentStep %= activePattern.stepCount;
    renderPattern();
    syncLoopLockButton();
  }

  function deleteSavedLoop(loopId: string) {
    savedLoops = savedLoops.filter((loop) => loop.id !== loopId);
    persistSavedLoops();
    renderLoopBank();
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  function renderLoopBank() {
    loopBankStatus.textContent = savedLoops.length ? `${savedLoops.length} saved` : 'none yet';
    loopList.innerHTML = savedLoops.length
      ? savedLoops.map((loop) => `
          <article class="loop-chip">
            <button type="button" data-loop-action="load" data-loop-id="${escapeHtml(loop.id)}">
              <strong>${escapeHtml(loop.name)}</strong>
              <span>${loop.stepCount} steps</span>
            </button>
            <button type="button" data-loop-action="add-live" data-loop-id="${escapeHtml(loop.id)}" title="Layer the live QR pattern into this saved loop">+ Live</button>
            <button type="button" data-loop-action="delete" data-loop-id="${escapeHtml(loop.id)}" title="Delete this saved loop">x</button>
          </article>
        `).join('')
      : '<p class="empty-state">Save a loop, then layer live cards into it.</p>';
  }

  function renderPattern() {
    meterLabel.textContent = `${activePattern.stepCount || pendingPattern.stepCount}-step`;
    syncTempoLabels();
    patternTitle.textContent = activePattern.stepCount
      ? `${loopLocked ? 'Locked ' : ''}${activePattern.stepCount}-step pattern`
      : 'QR Instrument';

    const displayPattern = activePattern.stepCount ? activePattern : pendingPattern;
    sequencerGrid.style.setProperty('--step-count', String(Math.max(1, displayPattern.stepCount || MAX_STEPS)));

    sequencerGrid.innerHTML = Array.from({ length: Math.max(displayPattern.stepCount, MIN_STEPS) }, (_, index) => {
      const column = displayPattern.columns[index];
      return `
        <article class="step-column" data-step="${index}">
          <div class="lane-cell melody-cell">${formatStepStack(column?.melodies ?? [], 'melody')}</div>
          <div class="lane-cell drum-cell">${column?.rest ? '<span class="rest-mark">Rest</span>' : formatStepStack(column?.drums ?? [], 'drums')}</div>
        </article>
      `;
    }).join('');

    stepList.innerHTML = displayPattern.columns.length
      ? displayPattern.columns.map((column, index) => `
          <article class="step-row">
            <span>${index + 1}</span>
            <strong>${column.rest ? 'Rest' : formatStepText(column.melodies)}</strong>
            <strong>${column.rest ? '' : formatStepText(column.drums)}</strong>
          </article>
        `).join('')
      : '<p class="empty-state">No active columns</p>';

    updatePlayhead();
  }

  function updatePlayhead() {
    const columns = Array.from(sequencerGrid.querySelectorAll<HTMLElement>('.step-column'));
    columns.forEach((column) => {
      column.classList.toggle('is-active', Number(column.dataset.step) === currentStep);
    });
  }

  function formatStepStack(events: StepEvent[], lane: 'melody' | 'drums') {
    if (!events.length) return '<span class="rest-mark">-</span>';
    return events.map((event) => formatStep(event, lane)).join('');
  }

  function formatStep(event: StepEvent, lane: 'melody' | 'drums') {
    const card = CARD_LIBRARY.get(event.payload as CardPayload);
    const pitch = event.pitchIndex === null ? '' : `<small>${PITCHES[event.pitchIndex]?.label ?? ''}</small>`;
    return `<span class="event-chip" style="--event-color: ${card?.accent ?? '#fff'}">${escapeHtml(event.label)}${lane === 'melody' ? pitch : ''}</span>`;
  }

  function formatStepText(events: StepEvent[]) {
    if (!events.length) return 'Rest';
    return events.map(formatSingleStepText).join(' + ');
  }

  function formatSingleStepText(event: StepEvent) {
    if (event.pitchIndex !== null) return `${event.label} ${PITCHES[event.pitchIndex]?.label ?? ''}`;
    return event.label;
  }

  function renderOverlay(cards: VisibleCard[]) {
    if (!cards.length || !video.videoWidth || !video.videoHeight) {
      overlay.innerHTML = '';
      return;
    }

    const width = overlay.clientWidth;
    const height = overlay.clientHeight;
    if (!width || !height) {
      overlay.innerHTML = '';
      return;
    }

    const geometry = computeOverlayGeometry(video.videoWidth, video.videoHeight, width, height);
    const now = performance.now();
    const marks = cards.map((card) => {
      if (card.cornerPoints.length < 4) return '';
      const tracked = trackedCards.get(card.trackingId);
      const isFresh = !tracked || now - tracked.lastSeenAt <= FRESH_OVERLAY_MS;
      const projected = card.cornerPoints.map((point) => projectPoint(point, geometry));
      const points = projected.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
      const center = projectPoint({ x: card.x, y: card.y }, geometry);
      return `
        <g>
          <polygon class="qr-outline ${card.definition.category} ${isFresh ? 'fresh' : 'held'}" points="${points}"></polygon>
          <text class="qr-label" x="${center.x.toFixed(1)}" y="${(center.y - 8).toFixed(1)}" text-anchor="middle">
            ${escapeHtml(card.definition.label)}
          </text>
        </g>
      `;
    }).join('');

    overlay.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
        ${marks}
      </svg>
    `;
  }

  // ── Canvas background ───────────────────────────────────────────────────────

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = element.getBoundingClientRect();
    const width = rect.width || window.innerWidth;
    const height = rect.height || window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    syncCameraFrame();
  }

  function renderVisuals(timestamp: number) {
    if (destroyed) return;
    const rect = element.getBoundingClientRect();
    const width = rect.width || window.innerWidth;
    const height = rect.height || window.innerHeight;
    const time = timestamp * 0.001;
    const stepCount = Math.max(1, activePattern.stepCount || pendingPattern.stepCount || 4);
    const phase = activePattern.stepCount ? currentStep / stepCount : 0;

    ctx.clearRect(0, 0, width, height);

    const background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, '#101318');
    background.addColorStop(0.5, '#20271f');
    background.addColorStop(1, '#141922');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let index = 0; index < 7; index += 1) {
      const x = width * ((index + 0.5) / 7) + Math.sin(time * 0.34 + index) * 42;
      const y = height * (0.22 + (index % 3) * 0.19) + Math.cos(time * 0.28 + index) * 34;
      const radius = 160 + (index % 4) * 70;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, index % 2 === 0 ? 'rgba(113, 214, 255, 0.16)' : 'rgba(255, 220, 123, 0.14)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }

    for (let line = 0; line < 14; line += 1) {
      const y = height * (0.15 + line * 0.055);
      ctx.strokeStyle = line % 2 === 0 ? 'rgba(255,255,255,0.07)' : 'rgba(156,255,186,0.06)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let x = 0; x <= width; x += 22) {
        const wave = Math.sin(time * 1.1 + x * 0.009 + line) * (12 + line * 0.5);
        if (x === 0) {
          ctx.moveTo(x, y + wave);
        } else {
          ctx.lineTo(x, y + wave);
        }
      }
      ctx.stroke();
    }

    const playheadX = width * (0.08 + phase * 0.84);
    const glow = ctx.createLinearGradient(playheadX - 70, 0, playheadX + 70, 0);
    glow.addColorStop(0, 'rgba(255,255,255,0)');
    glow.addColorStop(0.5, 'rgba(255,255,255,0.18)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(playheadX - 70, 0, 140, height);
    ctx.restore();

    visualsHandle = requestAnimationFrame(renderVisuals);
  }

  // ── Clock / sequencer ───────────────────────────────────────────────────────

  function runClock(now: number) {
    if (destroyed) return;
    while (now >= nextStepAt) {
      tickStep();
      nextStepAt += getStepMs();
    }
    clockHandle = requestAnimationFrame(runClock);
  }

  function tickStep() {
    if (!loopLocked && currentStep === 0 && pendingPattern.key !== activePattern.key) {
      activePattern = pendingPattern;
      renderPattern();
    }

    if (activePattern.stepCount > 0) {
      const column = activePattern.columns[currentStep % activePattern.stepCount];
      playColumn(column);
    }

    currentStep = activePattern.stepCount > 0 ? (currentStep + 1) % activePattern.stepCount : 0;
    updatePlayhead();
  }

  function playColumn(column: PatternColumn) {
    if (!audioLayer) return;
    for (const melody of column.melodies) {
      const noteId = melody.payload.replace('note:', '') as NoteId;
      const pitch = PITCHES[melody.pitchIndex ?? 0] ?? PITCHES[0];
      playNote(audioLayer, noteId, pitch.frequency);
    }
    for (const drum of column.drums) {
      const drumId = drum.payload.replace('drum:', '') as DrumId;
      playDrum(audioLayer, drumId, 0.7 + drum.velocity * 0.3);
    }
  }

  // ── Audio ───────────────────────────────────────────────────────────────────

  async function ensureAudio() {
    if (!audioLayer) {
      const context = await ensureAudioContext();
      audioLayer = createAudioLayer(context);
    }
    if (audioLayer.context.state === 'suspended') {
      await audioLayer.context.resume();
    }
  }

  function playNote(layer: AudioLayer, noteId: NoteId, frequency: number) {
    const context = layer.context;
    const now = context.currentTime;

    if (noteId === 'chime') {
      scheduleTone(layer, frequency, now, 'sine', 0.38, 1.1, 2400, 5.2);
      scheduleTone(layer, frequency * 2.01, now + 0.012, 'triangle', 0.16, 0.9, 3200, 4.5);
      return;
    }

    if (noteId === 'bell') {
      scheduleTone(layer, frequency * 0.5, now, 'sine', 0.28, 1.6, 1600, 6);
      scheduleTone(layer, frequency * 1.5, now + 0.025, 'sine', 0.12, 1.2, 2600, 8);
      return;
    }

    scheduleTone(layer, frequency, now, 'triangle', 0.3, 0.34, 1200, 1.2);
    scheduleTone(layer, frequency * 2, now, 'square', 0.06, 0.22, 1800, 0.8);
  }

  function scheduleTone(
    layer: AudioLayer,
    frequency: number,
    startAt: number,
    type: OscillatorType,
    peak: number,
    duration: number,
    filterFrequency: number,
    filterQ: number,
  ) {
    const context = layer.context;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFrequency, startAt);
    filter.Q.setValueAtTime(filterQ, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(layer.compressor);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.04);
  }

  function playDrum(layer: AudioLayer, drumId: DrumId, velocity: number) {
    if (drumId === 'kick') playKick(layer, velocity);
    else if (drumId === 'snare') playSnare(layer, velocity);
    else if (drumId === 'hat') playHat(layer, velocity);
    else playShaker(layer, velocity);
  }

  function playKick(layer: AudioLayer, velocity: number) {
    const context = layer.context;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(142, now);
    oscillator.frequency.exponentialRampToValueAtTime(42, now + 0.22);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.78 * velocity, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);

    oscillator.connect(gain);
    gain.connect(layer.compressor);
    oscillator.start(now);
    oscillator.stop(now + 0.36);
  }

  function playSnare(layer: AudioLayer, velocity: number) {
    const context = layer.context;
    const now = context.currentTime;
    const noise = createNoiseSource(context, 0.22);
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = 'bandpass';
    filter.frequency.value = 1850;
    filter.Q.value = 1.1;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.46 * velocity, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(layer.compressor);
    noise.start(now);
    noise.stop(now + 0.22);
  }

  function playHat(layer: AudioLayer, velocity: number) {
    const context = layer.context;
    const now = context.currentTime;
    const noise = createNoiseSource(context, 0.08);
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = 'highpass';
    filter.frequency.value = 6400;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.24 * velocity, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(layer.compressor);
    noise.start(now);
    noise.stop(now + 0.08);
  }

  function playShaker(layer: AudioLayer, velocity: number) {
    const context = layer.context;
    const now = context.currentTime;
    for (let index = 0; index < 3; index += 1) {
      const offset = index * 0.035;
      const noise = createNoiseSource(context, 0.045);
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      filter.type = 'bandpass';
      filter.frequency.value = 3800 + index * 620;
      filter.Q.value = 2.2;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.13 * velocity, now + offset + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.04);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(layer.compressor);
      noise.start(now + offset);
      noise.stop(now + offset + 0.05);
    }
  }

  // ── Print cards ─────────────────────────────────────────────────────────────

  async function printCardsOnly() {
    const printWindow = window.open('', '_blank', 'width=920,height=1100');
    if (!printWindow) {
      window.print();
      return;
    }

    printWindow.document.write(`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <title>QR Instrument Cards</title>
          <style>
            @page { size: A4 portrait; margin: 10mm; }
            * { box-sizing: border-box; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            html, body { margin: 0; padding: 0; color: #101318; background: #ffffff; font-family: Arial, sans-serif; }
            h1 { margin: 0 0 6mm; font-size: 14pt; }
            .card-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5mm; align-items: start; }
            .print-card {
              min-height: 58mm;
              padding: 4mm;
              display: grid;
              gap: 2mm;
              color: #101318;
              background: #ffffff;
              border: 2mm solid var(--card-accent);
              border-radius: 3mm;
              break-inside: avoid;
              page-break-inside: avoid;
            }
            .print-meta { display: flex; justify-content: space-between; gap: 3mm; font-size: 9pt; }
            .print-meta span { text-transform: uppercase; font-size: 7pt; opacity: 0.7; }
            img { width: 38mm; height: 38mm; justify-self: center; image-rendering: pixelated; }
            code { font: 700 7pt Consolas, monospace; overflow-wrap: anywhere; }
            small { font-size: 7pt; opacity: 0.62; }
          </style>
        </head>
        <body>
          <h1>QR Instrument Cards</h1>
          <p>Preparing cards...</p>
        </body>
      </html>
    `);

    const cards = await Promise.all(
      PRINTABLE_DECK.map(async (payload, index) => {
        const card = CARD_LIBRARY.get(payload);
        if (!card) return '';

        const dataUrl = await QRCode.toDataURL(payload, {
          width: 420,
          margin: 2,
          color: { dark: '#101215', light: '#ffffff' },
        });

        return `
          <article class="print-card" style="--card-accent: ${card.accent}">
            <div class="print-meta">
              <span>${escapeHtml(card.category)}</span>
              <strong>${escapeHtml(card.label)}</strong>
            </div>
            <img src="${dataUrl}" alt="${escapeHtml(payload)}" />
            <code>${escapeHtml(payload)}</code>
            <small>#${index + 1}</small>
          </article>
        `;
      }),
    );

    printWindow.document.body.innerHTML = `
      <h1>QR Instrument Cards</h1>
      <section class="card-grid">${cards.join('')}</section>
    `;
    printWindow.document.close();

    window.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 250);
  }

  // ── Fullscreen ──────────────────────────────────────────────────────────────

  async function toggleFullscreen() {
    if (!document.fullscreenEnabled) {
      fullscreenButton.disabled = true;
      return;
    }
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  }

  // ── Event listeners ─────────────────────────────────────────────────────────

  function onStartCameraClick() {
    void startCamera();
  }

  function onPrintCardsClick() {
    void printCardsOnly();
  }

  function onLoopLockClick() {
    toggleLoopLock();
  }

  function onSaveLoopClick() {
    saveCurrentLoop();
  }

  function onLoopListClick(event: Event) {
    const button = (event.target instanceof Element)
      ? event.target.closest<HTMLButtonElement>('button[data-loop-action]')
      : null;
    if (!button) return;

    const loopId = button.dataset.loopId;
    const action = button.dataset.loopAction;
    if (!loopId || !action) return;

    if (action === 'load') loadSavedLoop(loopId);
    else if (action === 'add-live') addLiveToSavedLoop(loopId);
    else if (action === 'delete') deleteSavedLoop(loopId);
  }

  function onCameraSelectChange() {
    if (cameraSelect.value) void startCamera(cameraSelect.value);
  }

  function onTempoSliderInput() {
    bpm = Number(tempoSlider.value);
    syncTempoLabels();
    persistTempo();
  }

  function onFullscreenClick() {
    void toggleFullscreen();
  }

  function onResize() {
    resizeCanvas();
  }

  function onKeydown(event: KeyboardEvent) {
    const target = event.target;
    const isEditing = target instanceof HTMLInputElement
      || target instanceof HTMLSelectElement
      || target instanceof HTMLTextAreaElement;

    if (!isEditing && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      toggleLoopLock();
    }
  }

  startCameraButton.addEventListener('click', onStartCameraClick);
  printCardsButton.addEventListener('click', onPrintCardsClick);
  loopLockButton.addEventListener('click', onLoopLockClick);
  saveLoopButton.addEventListener('click', onSaveLoopClick);
  loopList.addEventListener('click', onLoopListClick);
  cameraSelect.addEventListener('change', onCameraSelectChange);
  tempoSlider.addEventListener('input', onTempoSliderInput);
  fullscreenButton.addEventListener('click', onFullscreenClick);
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKeydown);

  // ── Bootstrap ───────────────────────────────────────────────────────────────

  void probeCameraAvailability();
  resizeCanvas();
  renderPattern();
  renderLoopBank();
  syncTempoLabels();
  syncLoopLockButton();
  visualsHandle = requestAnimationFrame(renderVisuals);
  clockHandle = requestAnimationFrame(runClock);

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  return () => {
    destroyed = true;

    // Stop camera
    stopDetectionLoop();
    stopCurrentStream();

    // Cancel animation frames
    if (visualsHandle) cancelAnimationFrame(visualsHandle);
    if (clockHandle) cancelAnimationFrame(clockHandle);

    // Close audio
    if (audioLayer) {
      void audioLayer.context.close();
      audioLayer = null;
    }

    // Remove event listeners
    startCameraButton.removeEventListener('click', onStartCameraClick);
    printCardsButton.removeEventListener('click', onPrintCardsClick);
    loopLockButton.removeEventListener('click', onLoopLockClick);
    saveLoopButton.removeEventListener('click', onSaveLoopClick);
    loopList.removeEventListener('click', onLoopListClick);
    cameraSelect.removeEventListener('change', onCameraSelectChange);
    tempoSlider.removeEventListener('input', onTempoSliderInput);
    fullscreenButton.removeEventListener('click', onFullscreenClick);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onKeydown);

    element.innerHTML = '';
  };
}
