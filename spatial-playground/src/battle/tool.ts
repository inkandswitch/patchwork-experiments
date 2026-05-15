import QRCode from 'qrcode';
import { createWasmDetector } from '../shared/qr-detector.ts';
import { listVideoDevices, buildVideoConstraints, waitForVideoReady, stopStream } from '../shared/camera.ts';
import { clamp, escapeHtml, polygonArea, computeOverlayGeometry, projectPoint } from '../shared/utils.ts';
import type { Point, UnitId, CommandId, StanceId, BattleDoc } from '../types.ts';
import type { DetectedBarcodeLike } from '../shared/qr-detector.ts';

type CardCategory = 'unit' | 'command' | 'stance';
type CardPayload = `unit:${UnitId}` | `cmd:${CommandId}` | `stance:${StanceId}`;

type CardDefinition = {
  payload: CardPayload;
  category: CardCategory;
  id: UnitId | CommandId | StanceId;
  label: string;
  accent: string;
  description: string;
};

type VisibleCard = {
  trackingId: string;
  definition: CardDefinition;
  payload: CardPayload;
  cornerPoints: Point[];
  x: number;
  y: number;
  nx: number;
  ny: number;
  area: number;
};

type TrackedCard = {
  id: string;
  card: VisibleCard;
  lastSeenAt: number;
};

type SquadType = Exclude<UnitId, 'all'>;
type Team = 'player' | 'enemy';

type Squad = {
  id: string;
  team: Team;
  type: SquadType;
  label: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  hp: number;
  maxHp: number;
  count: number;
  speed: number;
  range: number;
  damage: number;
  cooldown: number;
  attackTargetId: string | null;
  hold: boolean;
  stance: StanceId;
  flash: number;
};

type ActiveOrder = {
  unit: UnitId;
  command: CommandId | null;
  stance: StanceId;
  target: Point | null;
  key: string;
};

const MAP_WIDTH = 1000;
const MAP_HEIGHT = 650;
const MAX_SCANS_PER_SECOND = 12;
const CARD_MEMORY_MS = 1100;
const TRACK_MATCH_DISTANCE_RATIO = 0.16;
const COMMAND_REPEAT_MS = 360;
const FRESH_OVERLAY_MS = 260;

const CARD_DEFINITIONS: CardDefinition[] = [
  { payload: 'unit:all', category: 'unit', id: 'all', label: 'All', accent: '#f7f3e9', description: 'Select every friendly squad.' },
  { payload: 'unit:infantry', category: 'unit', id: 'infantry', label: 'Infantry', accent: '#7bf5cb', description: 'Tough front line soldiers.' },
  { payload: 'unit:archers', category: 'unit', id: 'archers', label: 'Archers', accent: '#ffd166', description: 'Long range, fragile damage.' },
  { payload: 'unit:cavalry', category: 'unit', id: 'cavalry', label: 'Cavalry', accent: '#71d6ff', description: 'Fast flankers and finishers.' },
  { payload: 'cmd:move', category: 'command', id: 'move', label: 'Move', accent: '#9cffba', description: 'Move selected troops to this card position.' },
  { payload: 'cmd:attack', category: 'command', id: 'attack', label: 'Attack', accent: '#ff6b4a', description: 'Attack enemies near this card position.' },
  { payload: 'cmd:hold', category: 'command', id: 'hold', label: 'Hold', accent: '#f5f1e8', description: 'Stop and defend the current ground.' },
  { payload: 'cmd:flank', category: 'command', id: 'flank', label: 'Flank', accent: '#d6c3ff', description: 'Sweep around toward the target area.' },
  { payload: 'cmd:rally', category: 'command', id: 'rally', label: 'Rally', accent: '#ffdc7b', description: 'Regroup and recover near the target.' },
  { payload: 'stance:line', category: 'stance', id: 'line', label: 'Line', accent: '#f7f3e9', description: 'Wide formation, good for archers.' },
  { payload: 'stance:wedge', category: 'stance', id: 'wedge', label: 'Wedge', accent: '#ff9f7a', description: 'Aggressive charge formation.' },
  { payload: 'stance:shield', category: 'stance', id: 'shield', label: 'Shield', accent: '#7ad7ff', description: 'Slower, tougher defensive formation.' },
];

const CARD_LIBRARY = new Map<CardPayload, CardDefinition>(
  CARD_DEFINITIONS.map((card) => [card.payload, card]),
);

const STYLE = `
.battle-shell {
  --ink: #f7f3e9;
  --muted: rgba(247, 243, 233, 0.66);
  --line: rgba(247, 243, 233, 0.14);
  --panel: rgba(8, 11, 13, 0.72);
  --blue: #71d6ff;
  --red: #ff6b4a;
  --gold: #ffd166;
  --green: #7bf5cb;
  font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
  color: var(--ink);
  background: #111820;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  width: 100%;
  height: 100%;
  padding: 12px;
  overflow: hidden;
  margin: 0;
}

.battle-shell * {
  box-sizing: border-box;
}

.battle-shell button,
.battle-shell select {
  border: 0;
  font: inherit;
  color: inherit;
}

.battle-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.battle-topbar,
.battle-layout {
  position: relative;
  z-index: 1;
}

.battle-topbar {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(4, 7, 9, 0.72);
  backdrop-filter: blur(18px);
}

.nav-action,
.primary-action,
.camera-select {
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 13px;
  border: 1px solid var(--line);
  border-radius: 9px;
  color: inherit;
  text-decoration: none;
  white-space: nowrap;
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
}

.primary-action {
  color: #07100d;
  border-color: rgba(255, 255, 255, 0.34);
  background: linear-gradient(135deg, var(--blue), var(--gold));
}

.primary-action:disabled,
.nav-action:disabled,
.camera-select:disabled {
  opacity: 0.58;
  cursor: default;
}

.camera-select {
  min-width: 190px;
  max-width: 280px;
}

.battle-layout {
  height: calc(100% - 70px);
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(360px, 0.75fr);
  gap: 12px;
  padding-top: 12px;
}

.map-panel,
.camera-panel,
.order-panel {
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--panel);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(18px);
}

.map-panel {
  position: relative;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  padding: 16px;
}

.map-heading,
.panel-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.eyebrow {
  margin: 0 0 5px;
  color: var(--muted);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-size: 0.72rem;
}

.battle-shell h1,
.battle-shell h2,
.battle-shell p {
  margin: 0;
}

.battle-shell h1 {
  font-size: clamp(2.6rem, 5.8vw, 6rem);
  line-height: 0.86;
  letter-spacing: -0.075em;
}

.battle-shell h2 {
  max-width: 13ch;
  font-size: 1.2rem;
  line-height: 1;
}

.battle-status {
  min-width: 160px;
  display: grid;
  gap: 4px;
  justify-items: end;
  text-align: right;
}

.battle-status span {
  color: var(--muted);
}

.battle-status strong {
  font-size: 1.45rem;
}

.battle-map {
  width: 100%;
  height: 100%;
  min-height: 0;
  border: 1px solid rgba(247, 243, 233, 0.12);
  border-radius: 14px;
  background: #162018;
}

.order-banner {
  position: absolute;
  left: 50%;
  bottom: 28px;
  translate: -50% 0;
  max-width: min(86%, 860px);
  padding: 12px 16px;
  border: 1px solid rgba(247, 243, 233, 0.18);
  border-radius: 999px;
  color: var(--ink);
  background: rgba(4, 7, 9, 0.62);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.26);
  text-align: center;
  backdrop-filter: blur(10px);
}

.side-panel {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 12px;
}

.camera-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  padding: 14px;
}

.scanner-status {
  padding: 7px 10px;
  border: 1px solid rgba(247, 243, 233, 0.14);
  border-radius: 999px;
  color: var(--blue);
  background: rgba(255, 255, 255, 0.06);
}

.camera-frame {
  position: relative;
  min-height: 0;
  align-self: center;
  overflow: hidden;
  border-radius: 13px;
  border: 1px solid rgba(247, 243, 233, 0.12);
  background: #04070a;
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
}

.scanner-overlay {
  pointer-events: none;
}

.scanner-overlay svg {
  width: 100%;
  height: 100%;
}

.qr-outline {
  fill: rgba(255, 255, 255, 0.05);
  stroke-width: 5;
  vector-effect: non-scaling-stroke;
}

.qr-outline.unit {
  stroke: var(--blue);
}

.qr-outline.command {
  stroke: var(--red);
}

.qr-outline.stance {
  stroke: var(--gold);
}

.qr-outline.held {
  opacity: 0.54;
}

.qr-label {
  paint-order: stroke;
  stroke: rgba(0, 0, 0, 0.72);
  stroke-width: 5px;
  fill: var(--ink);
  font: 900 24px "Segoe UI", sans-serif;
}

.order-panel {
  display: grid;
  gap: 12px;
  padding: 14px;
}

.order-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.order-grid article {
  min-width: 0;
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid rgba(247, 243, 233, 0.1);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.055);
}

.order-grid span {
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.13em;
  font-size: 0.68rem;
}

.order-grid strong {
  overflow-wrap: anywhere;
}

.rules-copy {
  color: var(--muted);
  line-height: 1.42;
}

@media (max-width: 980px) {
  .battle-shell {
    overflow: auto;
    height: auto;
    min-height: 100%;
  }

  .battle-topbar {
    flex-wrap: wrap;
  }

  .battle-layout {
    height: auto;
    grid-template-columns: 1fr;
  }

  .map-panel {
    min-height: 70%;
  }

  .side-panel {
    grid-template-rows: auto auto;
  }

  .camera-frame {
    min-height: 42%;
  }
}
`;

export default function BattleTool(handle: any, element: HTMLElement) {
  /* ------------------------------------------------------------------ */
  /*  DOM                                                                */
  /* ------------------------------------------------------------------ */

  element.innerHTML = `
    <main class="battle-shell">
      <canvas id="battle-bg" class="battle-bg" aria-hidden="true"></canvas>
      <header class="battle-topbar">
        <button id="start-camera" class="primary-action" type="button">Start Camera</button>
        <button id="print-cards" class="nav-action" type="button">Cards</button>
        <button id="reset-battle" class="nav-action" type="button">Reset Battle</button>
        <select id="camera-select" class="camera-select" aria-label="Camera"></select>
        <button id="toggle-fullscreen" class="nav-action" type="button">Fullscreen</button>
      </header>

      <section class="battle-layout">
        <section class="map-panel">
          <div class="map-heading">
            <div>
              <p class="eyebrow">QR Battle Table</p>
              <h1>Card-command RTS</h1>
            </div>
            <div class="battle-status">
              <span id="battle-state">Hold the ford</span>
              <strong id="score-label">Wave 1</strong>
            </div>
          </div>
          <canvas id="battle-map" class="battle-map" aria-label="Top down battlefield"></canvas>
          <div id="order-banner" class="order-banner">Show a command card to issue orders.</div>
        </section>

        <aside class="side-panel">
          <section class="camera-panel">
            <div class="panel-heading">
              <div>
                <p class="eyebrow">Camera Command Space</p>
                <h2>Cards become battlefield orders</h2>
              </div>
              <strong id="scanner-status" class="scanner-status">Standby</strong>
            </div>
            <div id="camera-frame" class="camera-frame">
              <video id="camera" autoplay muted playsinline></video>
              <div id="scanner-overlay" class="scanner-overlay"></div>
            </div>
          </section>

          <section class="order-panel">
            <div class="order-grid">
              <article>
                <span>Unit</span>
                <strong id="unit-status">All</strong>
              </article>
              <article>
                <span>Command</span>
                <strong id="command-status">None</strong>
              </article>
              <article>
                <span>Stance</span>
                <strong id="stance-status">Line</strong>
              </article>
              <article>
                <span>Visible</span>
                <strong id="visible-status">0 cards</strong>
              </article>
            </div>
            <p class="rules-copy">
              Put a unit card plus a command card in view. The command card position maps to the battlefield.
              Add a stance card for line, wedge, or shield behavior.
            </p>
          </section>
        </aside>
      </section>
    </main>
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  element.prepend(styleEl);
  element.style.position = 'relative';
  element.style.overflow = 'hidden';

  const q = <T extends Element>(sel: string): T => {
    const el = element.querySelector<T>(sel);
    if (!el) throw new Error(`Required element not found: ${sel}`);
    return el;
  };

  const bgCanvas = q<HTMLCanvasElement>('#battle-bg');
  const bgContext = bgCanvas.getContext('2d')!;
  const mapCanvas = q<HTMLCanvasElement>('#battle-map');
  const mapContext = mapCanvas.getContext('2d')!;
  const startCameraButton = q<HTMLButtonElement>('#start-camera');
  const printCardsButton = q<HTMLButtonElement>('#print-cards');
  const resetBattleButton = q<HTMLButtonElement>('#reset-battle');
  const fullscreenButton = q<HTMLButtonElement>('#toggle-fullscreen');
  const cameraSelect = q<HTMLSelectElement>('#camera-select');
  const scannerStatus = q<HTMLElement>('#scanner-status');
  const unitStatus = q<HTMLElement>('#unit-status');
  const commandStatus = q<HTMLElement>('#command-status');
  const stanceStatus = q<HTMLElement>('#stance-status');
  const visibleStatus = q<HTMLElement>('#visible-status');
  const battleState = q<HTMLElement>('#battle-state');
  const scoreLabel = q<HTMLElement>('#score-label');
  const orderBanner = q<HTMLElement>('#order-banner');
  const cameraFrame = q<HTMLDivElement>('#camera-frame');
  const video = q<HTMLVideoElement>('#camera');
  const overlay = q<HTMLDivElement>('#scanner-overlay');

  /* ------------------------------------------------------------------ */
  /*  State                                                              */
  /* ------------------------------------------------------------------ */

  let detector = createWasmDetector();
  let currentStream: MediaStream | null = null;
  let selectedCameraId: string | null = null;
  let cameraReady = false;
  let cameraStarting = false;
  let scanLoopHandle = 0;
  let scanInFlight = false;
  let lastScanAt = 0;
  let visibleCards: VisibleCard[] = [];
  let trackedCards = new Map<string, TrackedCard>();
  let nextTrackingId = 1;
  let squads: Squad[] = [];
  let wave = 1;
  let enemySpawnTimer = 0;
  let playerBaseHp = 100;
  let enemyBaseHp = 100;
  let lastFrameAt = performance.now();
  let lastOrderKey = '';
  let lastOrderAt = 0;
  let battleRafHandle = 0;
  let bgRafHandle = 0;
  let disposed = false;

  /* ------------------------------------------------------------------ */
  /*  Persist wave number                                                */
  /* ------------------------------------------------------------------ */

  const doc = handle.doc() as BattleDoc | undefined;
  if (doc?.waveNumber && doc.waveNumber > 1) {
    wave = doc.waveNumber;
  }

  function persistWave() {
    try {
      handle.change((d: BattleDoc) => {
        d.waveNumber = wave;
      });
    } catch {
      // ignore if handle is stale
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Boot                                                               */
  /* ------------------------------------------------------------------ */

  resetBattle();
  resizeCanvases();
  bgRafHandle = requestAnimationFrame(renderBackground);
  battleRafHandle = requestAnimationFrame(runBattle);
  void probeCameraAvailability();
  syncFullscreenButton();

  /* ------------------------------------------------------------------ */
  /*  Event listeners                                                    */
  /* ------------------------------------------------------------------ */

  const onStartCamera = () => { void startCamera(); };
  const onPrintCards = () => { void printCards(); };
  const onResetBattle = () => { resetBattle(); };
  const onCameraChange = () => { if (cameraSelect.value) void startCamera(cameraSelect.value); };
  const onToggleFullscreen = () => { void toggleFullscreen(); };
  const onResize = () => { resizeCanvases(); };
  const onBeforeUnload = () => { stopDetectionLoop(); stopCurrentStream(); };
  const onFullscreenChange = () => { syncFullscreenButton(); };

  startCameraButton.addEventListener('click', onStartCamera);
  printCardsButton.addEventListener('click', onPrintCards);
  resetBattleButton.addEventListener('click', onResetBattle);
  cameraSelect.addEventListener('change', onCameraChange);
  fullscreenButton.addEventListener('click', onToggleFullscreen);
  window.addEventListener('resize', onResize);
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('fullscreenchange', onFullscreenChange);

  /* ------------------------------------------------------------------ */
  /*  Camera                                                             */
  /* ------------------------------------------------------------------ */

  async function probeCameraAvailability() {
    if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices.enumerateDevices) {
      scannerStatus.textContent = 'Unavailable';
      startCameraButton.disabled = true;
      return;
    }

    const devices = await listVideoDevices().catch(() => []);
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
      stopDetectionLoop();
      stopCurrentStream();
      visibleCards = [];
      trackedCards.clear();
      nextTrackingId = 1;
      detector = createWasmDetector();

      selectedCameraId = nextDeviceId ?? selectedCameraId;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: buildVideoConstraints(selectedCameraId),
      });

      currentStream = stream;
      video.srcObject = stream;
      await waitForVideoReady(video);
      await video.play();

      selectedCameraId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? selectedCameraId;
      cameraReady = true;
      syncCameraFrame();
      await populateCameraSelect();
      startDetectionLoop();

      scannerStatus.textContent = 'Watching';
      startCameraButton.textContent = 'Camera Ready';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      scannerStatus.textContent = message.slice(0, 28);
      startCameraButton.textContent = 'Retry Camera';
      cameraReady = false;
      stopCurrentStream();
    } finally {
      cameraStarting = false;
      startCameraButton.disabled = false;
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
    if (!cameraReady || disposed) return;

    if (scanInFlight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      scanLoopHandle = window.requestAnimationFrame(scanFrame);
      return;
    }

    if (timestamp - lastScanAt < 1000 / MAX_SCANS_PER_SECOND) {
      scanLoopHandle = window.requestAnimationFrame(scanFrame);
      return;
    }

    lastScanAt = timestamp;
    scanInFlight = true;

    try {
      const detections = await detector.detect(video);
      const detectedCards = detections
        .map(toVisibleCard)
        .filter((card): card is VisibleCard => Boolean(card));
      visibleCards = updateTrackedCards(detectedCards, performance.now());
      renderOverlay(visibleCards);
      resolveAndApplyOrder();
    } catch {
      visibleCards = updateTrackedCards([], performance.now());
      renderOverlay(visibleCards);
      resolveAndApplyOrder();
    } finally {
      scanInFlight = false;
      if (cameraReady && !disposed) {
        scanLoopHandle = window.requestAnimationFrame(scanFrame);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Card tracking                                                      */
  /* ------------------------------------------------------------------ */

  function updateTrackedCards(detectedCards: VisibleCard[], now: number) {
    const matchedTrackedIds = new Set<string>();
    const matchDistance = Math.max(video.videoWidth, video.videoHeight) * TRACK_MATCH_DISTANCE_RATIO;

    for (const detectedCard of detectedCards.sort((left, right) => right.area - left.area)) {
      const match = findMatchingTrackedCard(detectedCard, matchedTrackedIds, matchDistance);
      const id = match?.id ?? `card-${nextTrackingId}`;
      if (!match) {
        nextTrackingId += 1;
      }

      const card = {
        ...detectedCard,
        trackingId: id,
      };

      trackedCards.set(id, {
        id,
        card: match ? smoothVisibleCard(match.card, card) : card,
        lastSeenAt: now,
      });
      matchedTrackedIds.add(id);
    }

    for (const [id, tracked] of trackedCards) {
      if (!matchedTrackedIds.has(id) && now - tracked.lastSeenAt > CARD_MEMORY_MS) {
        trackedCards.delete(id);
      }
    }

    return [...trackedCards.values()].map((tracked) => tracked.card);
  }

  function findMatchingTrackedCard(card: VisibleCard, matchedIds: Set<string>, matchDistance: number) {
    let best: TrackedCard | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const tracked of trackedCards.values()) {
      if (matchedIds.has(tracked.id) || tracked.card.payload !== card.payload) {
        continue;
      }

      const nextDistance = Math.hypot(tracked.card.x - card.x, tracked.card.y - card.y);
      if (nextDistance < bestDistance && nextDistance <= matchDistance) {
        best = tracked;
        bestDistance = nextDistance;
      }
    }

    return best;
  }

  function smoothVisibleCard(previous: VisibleCard, next: VisibleCard) {
    const blend = 0.42;
    return {
      ...next,
      x: previous.x * (1 - blend) + next.x * blend,
      y: previous.y * (1 - blend) + next.y * blend,
      nx: previous.nx * (1 - blend) + next.nx * blend,
      ny: previous.ny * (1 - blend) + next.ny * blend,
      area: previous.area * 0.58 + next.area * 0.42,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Order resolution                                                   */
  /* ------------------------------------------------------------------ */

  function resolveAndApplyOrder() {
    const order = resolveActiveOrder();
    unitStatus.textContent = labelForOrderPart(order.unit);
    commandStatus.textContent = order.command ? labelForOrderPart(order.command) : 'None';
    stanceStatus.textContent = labelForOrderPart(order.stance);
    visibleStatus.textContent = `${visibleCards.length} card${visibleCards.length === 1 ? '' : 's'}`;

    if (!order.command || !order.target) {
      orderBanner.textContent = 'Show a command card to issue orders.';
      return;
    }

    const now = performance.now();
    if (order.key === lastOrderKey && now - lastOrderAt < COMMAND_REPEAT_MS) {
      return;
    }

    lastOrderKey = order.key;
    lastOrderAt = now;
    issueOrder(order);
  }

  function resolveActiveOrder(): ActiveOrder {
    const unitCard = strongestCard('unit');
    const commandCard = strongestCard('command');
    const stanceCard = strongestCard('stance');
    const unit = (unitCard?.definition.id ?? 'all') as UnitId;
    const command = (commandCard?.definition.id ?? null) as CommandId | null;
    const stance = (stanceCard?.definition.id ?? 'line') as StanceId;
    const target = commandCard ? cameraToMap(commandCard) : null;
    const key = [
      unit,
      command ?? 'none',
      stance,
      target ? Math.round(target.x / 35) : 'x',
      target ? Math.round(target.y / 35) : 'y',
    ].join(':');

    return { unit, command, stance, target, key };
  }

  function strongestCard(category: CardCategory) {
    return visibleCards
      .filter((card) => card.definition.category === category)
      .sort((left, right) => right.area - left.area)[0] ?? null;
  }

  /* ------------------------------------------------------------------ */
  /*  Issue orders to squads                                             */
  /* ------------------------------------------------------------------ */

  function issueOrder(order: ActiveOrder) {
    if (!order.command || !order.target) return;

    const selected = selectedPlayerSquads(order.unit);
    if (!selected.length) return;

    const offsets = formationOffsets(selected.length, order.stance);
    for (const [index, squad] of selected.entries()) {
      const offset = offsets[index] ?? { x: 0, y: 0 };
      squad.stance = order.stance;
      squad.hold = order.command === 'hold';
      squad.attackTargetId = null;

      if (order.command === 'hold') {
        squad.tx = squad.x;
        squad.ty = squad.y;
      } else if (order.command === 'attack') {
        const targetEnemy = nearestSquad(order.target, 'enemy');
        squad.attackTargetId = targetEnemy?.id ?? null;
        squad.tx = targetEnemy?.x ?? order.target.x + offset.x;
        squad.ty = targetEnemy?.y ?? order.target.y + offset.y;
      } else if (order.command === 'flank') {
        const side = squad.type === 'cavalry' ? 1 : -1;
        squad.tx = clamp(order.target.x + side * 120 + offset.x, 40, MAP_WIDTH - 40);
        squad.ty = clamp(order.target.y - 40 + offset.y, 40, MAP_HEIGHT - 40);
        squad.attackTargetId = nearestSquad(order.target, 'enemy')?.id ?? null;
      } else if (order.command === 'rally') {
        squad.tx = clamp(order.target.x + offset.x, 40, MAP_WIDTH - 40);
        squad.ty = clamp(Math.max(order.target.y, MAP_HEIGHT * 0.62) + offset.y, 40, MAP_HEIGHT - 40);
      } else {
        squad.tx = clamp(order.target.x + offset.x, 40, MAP_WIDTH - 40);
        squad.ty = clamp(order.target.y + offset.y, 40, MAP_HEIGHT - 40);
      }
    }

    orderBanner.textContent = `${labelForOrderPart(order.unit)}: ${labelForOrderPart(order.command)} ${labelForOrderPart(order.stance)} at ${Math.round(order.target.x)}, ${Math.round(order.target.y)}`;
  }

  function selectedPlayerSquads(unit: UnitId) {
    return squads.filter((squad) => squad.team === 'player' && squad.hp > 0 && (unit === 'all' || squad.type === unit));
  }

  function formationOffsets(count: number, stance: StanceId) {
    if (count <= 1) return [{ x: 0, y: 0 }];

    if (stance === 'wedge') {
      return Array.from({ length: count }, (_, index) => ({
        x: (index - (count - 1) / 2) * 46,
        y: Math.abs(index - (count - 1) / 2) * 34,
      }));
    }

    if (stance === 'shield') {
      return Array.from({ length: count }, (_, index) => ({
        x: (index - (count - 1) / 2) * 32,
        y: (index % 2) * 28,
      }));
    }

    return Array.from({ length: count }, (_, index) => ({
      x: (index - (count - 1) / 2) * 68,
      y: 0,
    }));
  }

  /* ------------------------------------------------------------------ */
  /*  Battle simulation                                                  */
  /* ------------------------------------------------------------------ */

  function runBattle(timestamp: number) {
    if (disposed) return;
    const dt = Math.min(0.05, (timestamp - lastFrameAt) / 1000);
    lastFrameAt = timestamp;
    updateBattle(dt);
    renderBattle();
    battleRafHandle = requestAnimationFrame(runBattle);
  }

  function updateBattle(dt: number) {
    if (playerBaseHp <= 0 || enemyBaseHp <= 0) {
      battleState.textContent = playerBaseHp <= 0 ? 'Base lost' : 'Enemy camp broken';
      return;
    }

    enemySpawnTimer -= dt;
    if (enemySpawnTimer <= 0) {
      spawnEnemyWave();
      enemySpawnTimer = Math.max(5.8, 10.5 - wave * 0.45);
      wave += 1;
      persistWave();
    }

    for (const squad of squads) {
      if (squad.hp <= 0) continue;

      squad.cooldown = Math.max(0, squad.cooldown - dt);
      squad.flash = Math.max(0, squad.flash - dt);
      if (squad.team === 'enemy') {
        updateEnemySquad(squad);
      }
      updateSquadMovement(squad, dt);
      updateSquadCombat(squad);
      if (squad.team === 'player' && squad.stance === 'shield' && squad.hold) {
        squad.hp = Math.min(squad.maxHp, squad.hp + dt * 0.6);
      }
    }

    squads = squads.filter((squad) => squad.hp > 0);
    battleState.textContent = enemyBaseHp <= 0 ? 'Victory' : playerBaseHp <= 0 ? 'Defeat' : 'Hold the ford';
    scoreLabel.textContent = `Wave ${wave}`;
  }

  function updateEnemySquad(squad: Squad) {
    const target = nearestSquad({ x: squad.x, y: squad.y }, 'player');
    if (target && distance(squad, target) < 230) {
      squad.attackTargetId = target.id;
      squad.tx = target.x;
      squad.ty = target.y;
    } else {
      squad.attackTargetId = null;
      squad.tx = MAP_WIDTH * 0.5;
      squad.ty = MAP_HEIGHT - 70;
    }
  }

  function updateSquadMovement(squad: Squad, dt: number) {
    const targetSquad = squad.attackTargetId ? squads.find((candidate) => candidate.id === squad.attackTargetId && candidate.hp > 0) : null;
    const destination = targetSquad ? { x: targetSquad.x, y: targetSquad.y } : { x: squad.tx, y: squad.ty };
    const dx = destination.x - squad.x;
    const dy = destination.y - squad.y;
    const dist = Math.hypot(dx, dy);
    const inRange = targetSquad ? dist <= squad.range : dist < 5;

    if (squad.hold || inRange) return;

    const stanceSpeed = squad.stance === 'shield' ? 0.74 : squad.stance === 'wedge' ? 1.12 : 1;
    const step = Math.min(dist, squad.speed * stanceSpeed * dt);
    squad.x += (dx / Math.max(1, dist)) * step;
    squad.y += (dy / Math.max(1, dist)) * step;
  }

  function updateSquadCombat(squad: Squad) {
    const enemyTeam: Team = squad.team === 'player' ? 'enemy' : 'player';
    const target = nearestSquad({ x: squad.x, y: squad.y }, enemyTeam, squad.range);
    if (target && squad.cooldown <= 0) {
      const stanceDamage = squad.stance === 'wedge' ? 1.18 : squad.stance === 'shield' ? 0.72 : 1;
      const defense = target.stance === 'shield' ? 0.68 : 1;
      target.hp -= squad.damage * stanceDamage * defense;
      target.flash = 0.12;
      squad.cooldown = squad.type === 'archers' ? 0.88 : squad.type === 'cavalry' ? 0.68 : 0.78;
      return;
    }

    if (squad.team === 'player' && squad.y < 70 && squad.cooldown <= 0) {
      enemyBaseHp -= squad.damage * 0.42;
      squad.cooldown = 0.8;
    } else if (squad.team === 'enemy' && squad.y > MAP_HEIGHT - 72 && squad.cooldown <= 0) {
      playerBaseHp -= squad.damage * 0.4;
      squad.cooldown = 0.8;
    }

    if (squad.team === 'player' && squad.stance === 'shield' && squad.hold) {
      squad.hp = Math.min(squad.maxHp, squad.hp + 0.04);
    }
  }

  function spawnEnemyWave() {
    const count = 2 + Math.floor(wave / 2);
    for (let index = 0; index < count; index += 1) {
      const type: SquadType = index % 4 === 3 ? 'cavalry' : index % 3 === 2 ? 'archers' : 'infantry';
      squads.push(createSquad(`enemy-${Date.now()}-${index}`, 'enemy', type, 270 + index * 120, 88 + (index % 2) * 28));
    }
  }

  function resetBattle() {
    playerBaseHp = 100;
    enemyBaseHp = 100;
    wave = 1;
    enemySpawnTimer = 2.5;
    lastOrderKey = '';
    lastOrderAt = 0;
    squads = [
      createSquad('player-infantry', 'player', 'infantry', 420, 560),
      createSquad('player-archers', 'player', 'archers', 500, 595),
      createSquad('player-cavalry', 'player', 'cavalry', 580, 560),
    ];
    orderBanner.textContent = 'Show a command card to issue orders.';
    persistWave();
  }

  function createSquad(id: string, team: Team, type: SquadType, x: number, y: number): Squad {
    const stats = type === 'infantry'
      ? { hp: 44, count: 22, speed: 76, range: 54, damage: 5.2 }
      : type === 'archers'
        ? { hp: 28, count: 16, speed: 70, range: 170, damage: 4.2 }
        : { hp: 34, count: 12, speed: 118, range: 58, damage: 6.4 };

    return {
      id,
      team,
      type,
      label: `${team === 'player' ? 'Blue' : 'Red'} ${labelForOrderPart(type)}`,
      x,
      y,
      tx: x,
      ty: y,
      hp: stats.hp,
      maxHp: stats.hp,
      count: stats.count,
      speed: stats.speed,
      range: stats.range,
      damage: stats.damage,
      cooldown: 0,
      attackTargetId: null,
      hold: false,
      stance: 'line',
      flash: 0,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Rendering – battle map                                             */
  /* ------------------------------------------------------------------ */

  function renderBattle() {
    const width = mapCanvas.clientWidth;
    const height = mapCanvas.clientHeight;
    if (!width || !height) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (mapCanvas.width !== Math.floor(width * dpr) || mapCanvas.height !== Math.floor(height * dpr)) {
      mapCanvas.width = Math.floor(width * dpr);
      mapCanvas.height = Math.floor(height * dpr);
      mapContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    mapContext.clearRect(0, 0, width, height);
    mapContext.save();
    mapContext.scale(width / MAP_WIDTH, height / MAP_HEIGHT);
    drawMap();
    drawBases();
    for (const squad of squads) {
      drawSquad(squad);
    }
    drawProjectedTarget();
    mapContext.restore();
  }

  function drawMap() {
    const gradient = mapContext.createLinearGradient(0, 0, 0, MAP_HEIGHT);
    gradient.addColorStop(0, '#2c241d');
    gradient.addColorStop(0.42, '#293a2b');
    gradient.addColorStop(0.56, '#314d54');
    gradient.addColorStop(0.7, '#2f3f2d');
    gradient.addColorStop(1, '#242c21');
    mapContext.fillStyle = gradient;
    mapContext.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

    mapContext.fillStyle = 'rgba(89, 151, 168, 0.34)';
    mapContext.beginPath();
    mapContext.moveTo(0, 340);
    for (let x = 0; x <= MAP_WIDTH; x += 80) {
      mapContext.lineTo(x, 330 + Math.sin(x * 0.018) * 28);
    }
    mapContext.lineTo(MAP_WIDTH, 420);
    mapContext.lineTo(0, 430);
    mapContext.closePath();
    mapContext.fill();

    mapContext.strokeStyle = 'rgba(247, 243, 233, 0.08)';
    mapContext.lineWidth = 2;
    for (let x = 70; x < MAP_WIDTH; x += 90) {
      mapContext.beginPath();
      mapContext.moveTo(x, 0);
      mapContext.lineTo(x - 40, MAP_HEIGHT);
      mapContext.stroke();
    }

    mapContext.fillStyle = 'rgba(255, 220, 123, 0.16)';
    mapContext.fillRect(410, 310, 180, 95);
  }

  function drawBases() {
    drawBase(MAP_WIDTH / 2, 36, enemyBaseHp, '#ff6b4a', 'Enemy Camp');
    drawBase(MAP_WIDTH / 2, MAP_HEIGHT - 38, playerBaseHp, '#71d6ff', 'Your Camp');
  }

  function drawBase(x: number, y: number, hp: number, color: string, label: string) {
    mapContext.fillStyle = 'rgba(0, 0, 0, 0.28)';
    mapContext.fillRect(x - 110, y - 22, 220, 44);
    mapContext.strokeStyle = color;
    mapContext.lineWidth = 3;
    mapContext.strokeRect(x - 110, y - 22, 220, 44);
    mapContext.fillStyle = color;
    mapContext.fillRect(x - 104, y + 12, 208 * clamp(hp / 100, 0, 1), 6);
    mapContext.fillStyle = '#f7f3e9';
    mapContext.font = '700 18px Segoe UI';
    mapContext.textAlign = 'center';
    mapContext.fillText(label, x, y + 4);
  }

  function drawSquad(squad: Squad) {
    const color = squad.team === 'player' ? '#71d6ff' : '#ff6b4a';
    const radius = squad.type === 'cavalry' ? 22 : squad.type === 'archers' ? 18 : 21;
    const health = clamp(squad.hp / squad.maxHp, 0, 1);

    mapContext.save();
    mapContext.translate(squad.x, squad.y);
    mapContext.globalAlpha = squad.flash > 0 ? 0.55 : 1;
    mapContext.fillStyle = 'rgba(0, 0, 0, 0.26)';
    mapContext.beginPath();
    mapContext.ellipse(0, 12, radius * 1.45, radius * 0.55, 0, 0, Math.PI * 2);
    mapContext.fill();

    mapContext.globalAlpha = 1;
    mapContext.fillStyle = color;
    mapContext.strokeStyle = squad.stance === 'shield' ? '#f7f3e9' : squad.stance === 'wedge' ? '#ffd166' : '#111820';
    mapContext.lineWidth = squad.stance === 'shield' ? 4 : 2;

    if (squad.stance === 'wedge') {
      mapContext.beginPath();
      mapContext.moveTo(0, -radius);
      mapContext.lineTo(radius * 1.05, radius);
      mapContext.lineTo(-radius * 1.05, radius);
      mapContext.closePath();
      mapContext.fill();
      mapContext.stroke();
    } else {
      mapContext.beginPath();
      mapContext.roundRect(-radius, -radius, radius * 2, radius * 2, squad.stance === 'shield' ? 8 : 999);
      mapContext.fill();
      mapContext.stroke();
    }

    mapContext.fillStyle = '#071016';
    mapContext.font = '900 13px Segoe UI';
    mapContext.textAlign = 'center';
    mapContext.fillText(shortSquadLabel(squad), 0, 5);

    mapContext.fillStyle = 'rgba(0,0,0,0.46)';
    mapContext.fillRect(-28, radius + 8, 56, 7);
    mapContext.fillStyle = health > 0.4 ? '#7bf5cb' : '#ffdc7b';
    mapContext.fillRect(-28, radius + 8, 56 * health, 7);
    mapContext.restore();

    if (squad.team === 'player') {
      mapContext.strokeStyle = 'rgba(113, 214, 255, 0.22)';
      mapContext.setLineDash([5, 7]);
      mapContext.beginPath();
      mapContext.moveTo(squad.x, squad.y);
      mapContext.lineTo(squad.tx, squad.ty);
      mapContext.stroke();
      mapContext.setLineDash([]);
    }
  }

  function drawProjectedTarget() {
    const commandCard = strongestCard('command');
    if (!commandCard) return;

    const target = cameraToMap(commandCard);
    mapContext.strokeStyle = commandCard.definition.accent;
    mapContext.lineWidth = 4;
    mapContext.beginPath();
    mapContext.arc(target.x, target.y, 28, 0, Math.PI * 2);
    mapContext.stroke();
    mapContext.fillStyle = commandCard.definition.accent;
    mapContext.globalAlpha = 0.18;
    mapContext.beginPath();
    mapContext.arc(target.x, target.y, 42, 0, Math.PI * 2);
    mapContext.fill();
    mapContext.globalAlpha = 1;
  }

  function shortSquadLabel(squad: Squad) {
    if (squad.type === 'infantry') return 'INF';
    if (squad.type === 'archers') return 'ARC';
    return 'CAV';
  }

  /* ------------------------------------------------------------------ */
  /*  Rendering – background                                             */
  /* ------------------------------------------------------------------ */

  function renderBackground(timestamp: number) {
    if (disposed) return;
    const width = element.clientWidth;
    const height = element.clientHeight;
    const time = timestamp * 0.001;
    bgContext.clearRect(0, 0, width, height);
    const gradient = bgContext.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#131717');
    gradient.addColorStop(0.5, '#20251c');
    gradient.addColorStop(1, '#111820');
    bgContext.fillStyle = gradient;
    bgContext.fillRect(0, 0, width, height);

    bgContext.save();
    bgContext.globalCompositeOperation = 'screen';
    for (let index = 0; index < 8; index += 1) {
      const x = width * ((index + 0.45) / 8) + Math.sin(time * 0.2 + index) * 52;
      const y = height * (0.16 + (index % 4) * 0.21) + Math.cos(time * 0.25 + index) * 34;
      const glow = bgContext.createRadialGradient(x, y, 0, x, y, 220);
      glow.addColorStop(0, index % 2 ? 'rgba(255, 209, 102, 0.12)' : 'rgba(113, 214, 255, 0.14)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      bgContext.fillStyle = glow;
      bgContext.fillRect(0, 0, width, height);
    }
    bgContext.restore();
    bgRafHandle = requestAnimationFrame(renderBackground);
  }

  /* ------------------------------------------------------------------ */
  /*  Rendering – camera overlay                                         */
  /* ------------------------------------------------------------------ */

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
      const fresh = !tracked || now - tracked.lastSeenAt <= FRESH_OVERLAY_MS;
      const points = card.cornerPoints
        .map((point) => projectPoint(point, geometry))
        .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
        .join(' ');
      const center = projectPoint({ x: card.x, y: card.y }, geometry);

      return `
        <g>
          <polygon class="qr-outline ${card.definition.category} ${fresh ? 'fresh' : 'held'}" points="${points}"></polygon>
          <text class="qr-label" x="${center.x.toFixed(1)}" y="${(center.y - 8).toFixed(1)}" text-anchor="middle">${escapeHtml(card.definition.label)}</text>
        </g>
      `;
    }).join('');

    overlay.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${marks}</svg>`;
  }

  /* ------------------------------------------------------------------ */
  /*  Card printing                                                      */
  /* ------------------------------------------------------------------ */

  async function printCards() {
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
          <title>QR Battle Cards</title>
          <style>
            @page { size: A4 portrait; margin: 10mm; }
            * { box-sizing: border-box; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            html, body { margin: 0; color: #101318; background: #fff; font-family: Arial, sans-serif; }
            h1 { margin: 0 0 3mm; font-size: 15pt; }
            p { margin: 0 0 6mm; font-size: 9pt; color: #444; }
            .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5mm; }
            .card { min-height: 74mm; display: grid; gap: 2mm; padding: 4mm; border: 2mm solid var(--accent); border-radius: 3mm; break-inside: avoid; page-break-inside: avoid; }
            .top { display: flex; justify-content: space-between; gap: 3mm; align-items: start; }
            .cat { text-transform: uppercase; font-size: 7pt; opacity: 0.64; }
            strong { font-size: 12pt; text-align: right; }
            img { width: 48mm; height: 48mm; justify-self: center; image-rendering: pixelated; }
            code { font: 700 7pt Consolas, monospace; overflow-wrap: anywhere; }
            small { font-size: 7pt; color: #555; }
          </style>
        </head>
        <body>
          <h1>QR Battle Cards</h1>
          <p>Use one unit card, one command card, and optionally one stance card. Command card position is the map target.</p>
          <section class="grid">Preparing...</section>
        </body>
      </html>
    `);

    const cards = await Promise.all(CARD_DEFINITIONS.map(async (card) => {
      const dataUrl = await QRCode.toDataURL(card.payload, {
        width: 420,
        margin: 2,
        color: { dark: '#101215', light: '#ffffff' },
      });

      return `
        <article class="card" style="--accent: ${card.accent}">
          <div class="top"><span class="cat">${escapeHtml(card.category)}</span><strong>${escapeHtml(card.label)}</strong></div>
          <img src="${dataUrl}" alt="${escapeHtml(card.payload)}" />
          <code>${escapeHtml(card.payload)}</code>
          <small>${escapeHtml(card.description)}</small>
        </article>
      `;
    }));

    const grid = printWindow.document.querySelector('.grid');
    if (grid) {
      grid.innerHTML = cards.join('');
    }
    printWindow.document.close();
    window.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 250);
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                            */
  /* ------------------------------------------------------------------ */

  function toVisibleCard(detection: DetectedBarcodeLike) {
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

    return {
      definition,
      payload,
      trackingId: '',
      cornerPoints,
      x,
      y,
      nx: clamp(x / video.videoWidth, 0, 1),
      ny: clamp(y / video.videoHeight, 0, 1),
      area: polygonArea(cornerPoints),
    } satisfies VisibleCard;
  }

  function normalizePayload(rawValue: string | undefined) {
    if (!rawValue) return null;
    return CARD_LIBRARY.has(rawValue as CardPayload) ? rawValue as CardPayload : null;
  }

  function cameraToMap(card: VisibleCard) {
    return {
      x: clamp(card.nx * MAP_WIDTH, 30, MAP_WIDTH - 30),
      y: clamp(card.ny * MAP_HEIGHT, 30, MAP_HEIGHT - 30),
    };
  }

  function nearestSquad(point: Point, team: Team, maxDistance = Number.POSITIVE_INFINITY) {
    let best: Squad | null = null;
    let bestDistance = maxDistance;

    for (const squad of squads) {
      if (squad.team !== team || squad.hp <= 0) continue;

      const nextDistance = Math.hypot(squad.x - point.x, squad.y - point.y);
      if (nextDistance < bestDistance) {
        best = squad;
        bestDistance = nextDistance;
      }
    }

    return best;
  }

  function distance(left: Point, right: Point) {
    return Math.hypot(left.x - right.x, left.y - right.y);
  }

  function labelForOrderPart(value: UnitId | CommandId | StanceId | SquadType) {
    if (value === 'all') return 'All';
    if (value === 'infantry') return 'Infantry';
    if (value === 'archers') return 'Archers';
    if (value === 'cavalry') return 'Cavalry';
    if (value === 'move') return 'Move';
    if (value === 'attack') return 'Attack';
    if (value === 'hold') return 'Hold';
    if (value === 'flank') return 'Flank';
    if (value === 'rally') return 'Rally';
    if (value === 'wedge') return 'Wedge';
    if (value === 'shield') return 'Shield';
    return 'Line';
  }

  /* ------------------------------------------------------------------ */
  /*  Layout                                                             */
  /* ------------------------------------------------------------------ */

  function resizeCanvases() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = element.clientWidth;
    const height = element.clientHeight;
    bgCanvas.width = Math.floor(width * dpr);
    bgCanvas.height = Math.floor(height * dpr);
    bgCanvas.style.width = `${width}px`;
    bgCanvas.style.height = `${height}px`;
    bgContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    syncCameraFrame();
  }

  function syncCameraFrame() {
    if (video.videoWidth && video.videoHeight) {
      cameraFrame.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    }
  }

  async function populateCameraSelect() {
    const cameras = await listVideoDevices().catch(() => []);
    cameraSelect.innerHTML = cameras.length
      ? cameras.map((camera) => `<option value="${escapeHtml(camera.deviceId)}">${escapeHtml(camera.label || 'Camera')}</option>`).join('')
      : '<option>Default camera</option>';
    cameraSelect.disabled = cameras.length <= 1;

    if (selectedCameraId && cameras.some((camera) => camera.deviceId === selectedCameraId)) {
      cameraSelect.value = selectedCameraId;
    }
  }

  async function toggleFullscreen() {
    if (!document.fullscreenEnabled) {
      fullscreenButton.disabled = true;
      return;
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await element.requestFullscreen();
    }
  }

  function syncFullscreenButton() {
    fullscreenButton.disabled = !document.fullscreenEnabled;
    fullscreenButton.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
  }

  function stopCurrentStream() {
    stopStream(currentStream);
    currentStream = null;
    video.srcObject = null;
    cameraReady = false;
  }

  /* ------------------------------------------------------------------ */
  /*  Cleanup                                                            */
  /* ------------------------------------------------------------------ */

  return () => {
    disposed = true;

    // Stop animation loops
    if (battleRafHandle) cancelAnimationFrame(battleRafHandle);
    if (bgRafHandle) cancelAnimationFrame(bgRafHandle);
    stopDetectionLoop();

    // Stop camera
    stopCurrentStream();

    // Remove global listeners
    window.removeEventListener('resize', onResize);
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.removeEventListener('fullscreenchange', onFullscreenChange);

    // Clear DOM
    element.innerHTML = '';
  };
}
