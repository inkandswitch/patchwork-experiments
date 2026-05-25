import QRCode from 'qrcode';
import type { ColorsDoc, ColorId, EffectId } from '../types.ts';
import { listVideoDevices, buildVideoConstraints, waitForVideoReady, stopStream } from '../shared/camera.ts';
import { escapeHtml } from '../shared/utils.ts';
import type { ActiveComposition } from './types.ts';
import { CARD_DEFINITIONS, DWELL_MS, EFFECT_LIBRARY } from './constants.ts';
import { STYLE } from './style.ts';
import { createComposition, formatColorMix, formatVisibleLabel, categoryLabel } from './composition.ts';
import { renderOverlay } from './overlay.ts';
import { createEffectsRenderer } from './effects.ts';
import { createCardTracker } from './tracking.ts';

export default function ColorsTool(handle: any, element: HTMLElement) {
  // --- Build DOM inside element ---
  element.innerHTML = `
    <div class="app-shell" data-scene="idle">
      <canvas class="scene-canvas" aria-hidden="true"></canvas>
      <div class="scene-noise" aria-hidden="true"></div>

      <section class="display-stage" aria-label="Current display">
        <div class="display-toolbar">
          <button class="utility-button js-open-studio" type="button">Studio</button>
        </div>
      </section>

      <section class="studio-shell js-studio">
        <section class="studio-header panel">
          <div>
            <p class="eyebrow">Studio</p>
            <h2>Camera, cards, and composition controls</h2>
          </div>
          <button class="secondary-button js-back-to-display" type="button">Back to Display</button>
        </section>

        <section class="hero-stage">
          <section class="hero-copy panel">
            <p class="eyebrow">QR Scene Machine</p>
            <h1 class="js-scene-title">Idle Field</h1>
            <p class="js-scene-tagline tagline">
              Blend up to two color cards and one effect card at the same time.
            </p>

            <div class="controls">
              <button class="primary-button js-start-camera" type="button">Enable Webcam</button>
              <button class="secondary-button js-print-cards" type="button">Print Cards</button>
            </div>

            <div class="status-grid">
              <article class="status-card">
                <span class="status-label">Scanner</span>
                <strong class="js-scanner-status">Standby</strong>
              </article>
              <article class="status-card">
                <span class="status-label">Colors</span>
                <strong class="js-color-status">Idle</strong>
              </article>
              <article class="status-card">
                <span class="status-label">Effect</span>
                <strong class="js-effect-status">None</strong>
              </article>
            </div>

            <section class="dwell-meter">
              <div class="dwell-copy">
                <span class="js-dwell-label">Cards become active after 0.22 seconds of stable visibility.</span>
                <span class="js-dwell-amount">0%</span>
              </div>
              <div class="dwell-track" aria-hidden="true">
                <div class="dwell-fill js-dwell-fill"></div>
              </div>
            </section>

            <p class="micro-copy">
              Use up to two color cards at once. Add one effect card to stack motion on top.
            </p>
          </section>

          <aside class="camera-panel panel">
            <div class="camera-header">
              <div>
                <p class="eyebrow">Live Camera</p>
                <h2>Desktop webcam preview</h2>
              </div>
              <label class="camera-picker">
                <span>Camera</span>
                <select class="js-camera-select" disabled>
                  <option>Default camera</option>
                </select>
              </label>
            </div>

            <div class="video-shell">
              <video class="js-camera" playsinline muted></video>
              <div class="scanner-overlay js-scanner-overlay"></div>
              <div class="video-reticle" aria-hidden="true"></div>
            </div>

            <div class="camera-footer">
              <div class="camera-note">
                <span class="status-label">Visible cards</span>
                <strong class="js-last-code">Waiting for camera permission</strong>
              </div>
              <p class="micro-copy">
                Detector: <span class="js-detector-mode">Tuned WASM detector (stable multi-QR)</span>. Edge and Chrome can read multiple QR codes at once when the native detector is available.
              </p>
            </div>
          </aside>
        </section>

        <section class="card-sheet panel">
          <div class="card-sheet-header">
            <div>
              <p class="eyebrow">Printable Cards</p>
              <h2>Seven cards: color and effect</h2>
              <p class="micro-copy">
                Print these on plain paper or cardstock. Start with large cards and keep them well lit.
              </p>
            </div>
            <button class="secondary-button js-print-cards-inline" type="button">Print This Sheet</button>
          </div>

          <div class="card-grid js-card-grid"></div>
        </section>
      </section>
    </div>
  `;

  // --- Inject inline styles & positioning context ---
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  element.appendChild(styleEl);
  element.style.position = 'relative';
  element.style.width = '100%';
  element.style.height = '100%';
  element.style.overflow = 'hidden';

  // --- Query elements ---
  const q = <T extends Element>(sel: string): T => {
    const el = element.querySelector<T>(sel);
    if (!el) throw new Error(`Required element not found: ${sel}`);
    return el;
  };

  const sceneCanvas = q<HTMLCanvasElement>('.scene-canvas');
  const displayStage = q<HTMLElement>('.display-stage');
  const studioShell = q<HTMLElement>('.js-studio');
  studioShell.style.display = 'none';
  const shell = q<HTMLDivElement>('.app-shell');
  const sceneTitle = q<HTMLHeadingElement>('.js-scene-title');
  const sceneTagline = q<HTMLParagraphElement>('.js-scene-tagline');
  const scannerStatus = q<HTMLElement>('.js-scanner-status');
  const colorStatus = q<HTMLElement>('.js-color-status');
  const effectStatus = q<HTMLElement>('.js-effect-status');
  const dwellLabel = q<HTMLElement>('.js-dwell-label');
  const dwellAmount = q<HTMLElement>('.js-dwell-amount');
  const dwellFill = q<HTMLElement>('.js-dwell-fill');
  const lastCode = q<HTMLElement>('.js-last-code');
  const startCameraButton = q<HTMLButtonElement>('.js-start-camera');
  const printButton = q<HTMLButtonElement>('.js-print-cards');
  const printButtonInline = q<HTMLButtonElement>('.js-print-cards-inline');
  const cameraSelect = q<HTMLSelectElement>('.js-camera-select');
  const video = q<HTMLVideoElement>('.js-camera');
  const overlayEl = q<HTMLDivElement>('.js-scanner-overlay');
  const cardGrid = q<HTMLDivElement>('.js-card-grid');

  // --- Shared mutable state ---
  let currentStream: MediaStream | null = null;
  let currentComposition = createComposition([], null);
  let compositionEnteredAt = performance.now();
  let cameraReady = false;
  let cameraStarting = false;
  let selectedCameraId: string | null = null;
  let destroyed = false;

  // --- Create module instances ---
  const effects = createEffectsRenderer({
    canvas: sceneCanvas,
    element,
    getComposition: () => currentComposition,
    getCompositionEnteredAt: () => compositionEnteredAt,
  });

  const tracker = createCardTracker({
    video,
    onCompositionChange(composition) {
      applyComposition(composition);
    },
    onVisibleCardsChange(cards) {
      renderOverlay(overlayEl, video, tracker.getTrackedCards(), cards);
      lastCode.textContent = cards.length
        ? cards.map((card) => formatVisibleLabel(card.card)).join(' \u2022 ')
        : 'No supported cards visible';
    },
  });

  // --- Composition bridge ---
  function applyComposition(composition: ActiveComposition, fromRemote = false) {
    currentComposition = composition;
    compositionEnteredAt = performance.now();

    shell.dataset.scene = composition.colors.join('-') || 'idle';
    element.style.setProperty('--scene-bg-a', composition.palette.background[0]);
    element.style.setProperty('--scene-bg-b', composition.palette.background[1]);
    element.style.setProperty('--scene-bg-c', composition.palette.background[2]);
    element.style.setProperty('--scene-accent', composition.palette.accent);
    element.style.setProperty('--scene-glow', composition.palette.glow);
    element.style.setProperty('--scene-panel', composition.palette.panel);
    element.style.setProperty('--scene-text', composition.palette.text);

    sceneTitle.textContent = composition.title;
    sceneTagline.textContent = composition.tagline;
    colorStatus.textContent = composition.colors.length
      ? formatColorMix(composition.colors)
      : 'Idle';
    effectStatus.textContent = composition.effect ? EFFECT_LIBRARY[composition.effect].label : 'None';

    if (!fromRemote) {
      handle.change((doc: ColorsDoc) => {
        doc.activeColors = composition.colors;
        doc.activeEffect = composition.effect;
      });
    }
  }

  // --- Remote doc sync ---
  function onDocChange() {
    const doc = handle.doc() as ColorsDoc | undefined;
    if (!doc) return;
    const remoteColors = (doc.activeColors ?? []) as ColorId[];
    const remoteEffect = (doc.activeEffect ?? null) as EffectId | null;
    const remoteComposition = createComposition(remoteColors, remoteEffect);
    if (remoteComposition.key !== currentComposition.key) {
      applyComposition(remoteComposition, true);
    }
  }
  handle.on("change", onDocChange);

  // --- Camera ---
  async function probeCameraAvailability() {
    if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices.enumerateDevices) {
      scannerStatus.textContent = 'Camera API unavailable';
      startCameraButton.disabled = true;
      return;
    }

    const devices = await listVideoDevices().catch(() => []);
    if (!devices.length) {
      scannerStatus.textContent = 'No camera detected';
      startCameraButton.disabled = true;
    }
  }

  async function startCamera(nextDeviceId?: string) {
    if (cameraStarting) return;

    cameraStarting = true;
    startCameraButton.disabled = true;
    startCameraButton.textContent = cameraReady ? 'Switching...' : 'Starting...';
    scannerStatus.textContent = cameraReady ? 'Switching camera' : 'Requesting permission';

    try {
      tracker.stop();
      stopCurrentStream();
      tracker.reset();
      renderOverlay(overlayEl, video, tracker.getTrackedCards(), []);

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

      await populateCameraSelect();
      tracker.start();

      scannerStatus.textContent = 'Watching for cards';
      startCameraButton.textContent = 'Webcam Ready';
      lastCode.textContent = 'No supported cards visible';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      cameraReady = false;
      scannerStatus.textContent = 'Camera failed';
      lastCode.textContent = message;
      startCameraButton.textContent = 'Retry Webcam';
      startCameraButton.disabled = false;
      stopCurrentStream();
    } finally {
      if (cameraReady) {
        startCameraButton.disabled = false;
      }
      cameraStarting = false;
    }
  }

  async function populateCameraSelect() {
    const cameras = await listVideoDevices().catch(() => []);

    cameraSelect.innerHTML = cameras.map((camera) =>
      `<option value="${camera.deviceId}">${escapeHtml(camera.label || 'Camera')}</option>`,
    ).join('');

    if (!cameras.length) {
      cameraSelect.innerHTML = '<option>Default camera</option>';
      cameraSelect.disabled = true;
      return;
    }

    cameraSelect.disabled = cameras.length === 1;

    if (selectedCameraId) {
      const matching = cameras.find((camera) => camera.deviceId === selectedCameraId);
      if (matching) {
        cameraSelect.value = matching.deviceId;
        return;
      }
    }

    const activeLabel = currentStream?.getVideoTracks()[0]?.label;
    if (activeLabel) {
      const matchingByLabel = cameras.find((camera) => camera.label === activeLabel);
      if (matchingByLabel) {
        cameraSelect.value = matchingByLabel.deviceId;
      }
    }
  }

  function stopCurrentStream() {
    if (currentStream) {
      stopStream(currentStream);
      currentStream = null;
      video.srcObject = null;
      cameraReady = false;
    }
  }

  // --- Scanner state sync (UI polling) ---
  function syncScannerState() {
    if (destroyed) return;
    const now = performance.now();
    const candidateCards = tracker.getCandidateCards();

    for (const [id, candidate] of candidateCards) {
      if (now - candidate.lastSeenAt > 1400) {
        candidateCards.delete(id);
      }
    }

    if (!cameraReady) {
      scannerStatus.textContent = 'Standby';
      dwellLabel.textContent = 'Cards become active after 0.22 seconds of stable visibility.';
      dwellAmount.textContent = '0%';
      dwellFill.style.transform = 'scaleX(0)';
      return;
    }

    const candidates = [...candidateCards.values()];
    const pending = candidates
      .filter((candidate) => now - candidate.firstSeenAt < DWELL_MS)
      .sort(
        (left, right) =>
          (now - right.firstSeenAt) - (now - left.firstSeenAt),
      );

    if (pending.length) {
      const nextPending = pending[0];
      const progress = Math.min(1, (now - nextPending.firstSeenAt) / DWELL_MS);
      dwellLabel.textContent = `Settling ${formatVisibleLabel(nextPending.card)}`;
      dwellAmount.textContent = `${Math.round(progress * 100)}%`;
      dwellFill.style.transform = `scaleX(${progress})`;
    } else {
      dwellLabel.textContent = 'Use up to two color cards and one effect card.';
      dwellAmount.textContent = candidates.length ? `${candidates.length} active` : '0%';
      dwellFill.style.transform = 'scaleX(0)';
    }

    const visibleCards = tracker.getVisibleCards();
    scannerStatus.textContent = visibleCards.length
      ? `${visibleCards.length} held`
      : 'Watching for cards';
  }

  // --- Card printing ---
  async function renderCards() {
    cardGrid.innerHTML = CARD_DEFINITIONS.map((card) => `
        <article class="print-card" data-category="${card.category}">
          <div class="print-card-top">
            <span class="scene-chip">${categoryLabel(card.category)}</span>
            <span class="print-value">${card.payload}</span>
          </div>
          <div class="print-code-shell">
            <canvas class="qr-canvas" data-payload="${card.payload}" width="220" height="220"></canvas>
          </div>
          <h3>${card.label}</h3>
          <p>${card.description}</p>
        </article>
      `).join('');

    const canvases = Array.from(element.querySelectorAll<HTMLCanvasElement>('.qr-canvas'));
    await Promise.all(
      canvases.map((canvas) =>
        QRCode.toCanvas(canvas, canvas.dataset.payload ?? 'color:red', {
          width: 220,
          margin: 2,
          color: {
            dark: '#111111',
            light: '#ffffff',
          },
        }),
      ),
    );
  }

  // --- Event listeners ---
  const onStartCamera = () => { void startCamera(); };
  const onOpenStudio = () => {
    studioShell.style.display = '';
    displayStage.style.display = 'none';
  };
  const onBackToDisplay = () => {
    studioShell.style.display = 'none';
    displayStage.style.display = '';
  };
  const onCameraChange = () => {
    if (cameraSelect.value) {
      void startCamera(cameraSelect.value);
    }
  };
  const onPrint = () => { window.print(); };
  const onResize = () => { effects.resize(); };

  startCameraButton.addEventListener('click', onStartCamera);
  q<HTMLButtonElement>('.js-open-studio').addEventListener('click', onOpenStudio);
  q<HTMLButtonElement>('.js-back-to-display').addEventListener('click', onBackToDisplay);
  cameraSelect.addEventListener('change', onCameraChange);
  printButton.addEventListener('click', onPrint);
  printButtonInline.addEventListener('click', onPrint);
  window.addEventListener('resize', onResize);

  // --- Initialize ---
  {
    const doc = handle.doc() as ColorsDoc | undefined;
    if (doc?.activeColors?.length || doc?.activeEffect) {
      currentComposition = createComposition(
        (doc.activeColors ?? []) as ColorId[],
        (doc.activeEffect ?? null) as EffectId | null,
      );
    }
  }
  applyComposition(currentComposition, true);
  void renderCards();
  void probeCameraAvailability();

  const syncIntervalHandle = window.setInterval(syncScannerState, 80);

  // --- Cleanup ---
  return () => {
    destroyed = true;

    tracker.destroy();
    stopCurrentStream();
    effects.destroy();

    if (syncIntervalHandle) {
      window.clearInterval(syncIntervalHandle);
    }

    startCameraButton.removeEventListener('click', onStartCamera);
    cameraSelect.removeEventListener('change', onCameraChange);
    printButton.removeEventListener('click', onPrint);
    printButtonInline.removeEventListener('click', onPrint);
    window.removeEventListener('resize', onResize);
    handle.off("change", onDocChange);

    element.innerHTML = '';
  };
}
