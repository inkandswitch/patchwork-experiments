import { arucoToSVGString } from 'aruco-marker';
import type { ColorsDoc } from '../types.ts';
import { listVideoDevices, buildVideoConstraints, waitForVideoReady, stopStream } from '../shared/camera.ts';
import { escapeHtml } from '../shared/utils.ts';
import type { ColorRegion } from './types.ts';
import { DWELL_MS } from './constants.ts';
import { STYLE } from './style.ts';
import { hueToColor } from './composition.ts';
import { renderOverlay } from './overlay.ts';
import { createEffectsRenderer } from './effects.ts';
import { createCardTracker } from './tracking.ts';

const DEFAULT_MARKERS = [
  { id: 0, label: 'Red', description: 'Hue 0 — pure red.' },
  { id: 120, label: 'Green', description: 'Hue 120 — pure green.' },
  { id: 240, label: 'Blue', description: 'Hue 240 — pure blue.' },
];

export default function ColorsTool(handle: any, element: HTMLElement) {
  element.innerHTML = `
    <div class="app-shell" data-scene="idle">
      <canvas class="scene-canvas" aria-hidden="true"></canvas>

      <section class="display-stage" aria-label="Current display">
        <div class="display-toolbar">
          <button class="utility-button js-open-studio" type="button">Studio</button>
        </div>
      </section>

      <section class="studio-shell js-studio">
        <section class="studio-header panel">
          <div>
            <p class="eyebrow">Studio</p>
            <h2>Camera and marker controls</h2>
          </div>
          <button class="secondary-button js-back-to-display" type="button">Back to Display</button>
        </section>

        <section class="hero-stage">
          <section class="hero-copy panel">
            <p class="eyebrow">Color Markers</p>
            <h1 class="js-scene-title">Idle</h1>
            <p class="js-scene-tagline tagline">
              Show ArUco markers (IDs 0–359) to display colors. The marker ID is the hue.
            </p>

            <div class="controls">
              <button class="primary-button js-toggle-camera" type="button">Start Camera</button>
            </div>

            <div class="status-grid">
              <article class="status-card">
                <span class="status-label">Scanner</span>
                <strong class="js-scanner-status">Standby</strong>
              </article>
              <article class="status-card">
                <span class="status-label">Active markers</span>
                <strong class="js-color-status">None</strong>
              </article>
            </div>

            <section class="dwell-meter">
              <div class="dwell-copy">
                <span class="js-dwell-label">Markers become active after brief stable visibility.</span>
                <span class="js-dwell-amount">0%</span>
              </div>
              <div class="dwell-track" aria-hidden="true">
                <div class="dwell-fill js-dwell-fill"></div>
              </div>
            </section>

            <p class="micro-copy">
              ArUco marker ID = hue (0–359). Color is hsl(id, 100%, 50%). Print markers from any ArUco generator using the standard dictionary.
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
                <span class="status-label">Visible markers</span>
                <strong class="js-last-code">Waiting for camera</strong>
              </div>
            </div>
          </aside>
        </section>

        <section class="card-sheet panel">
          <div class="card-sheet-header">
            <div>
              <p class="eyebrow">Printable Markers</p>
              <h2>Three default markers: red, green, and blue</h2>
              <p class="micro-copy">
                Print these on plain paper or cardstock. The marker ID is the hue value.
              </p>
            </div>
            <button class="secondary-button js-print-cards" type="button">Print This Sheet</button>
          </div>

          <div class="card-grid js-card-grid"></div>
        </section>
      </section>
    </div>
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  element.appendChild(styleEl);
  element.style.position = 'relative';
  element.style.width = '100%';
  element.style.height = '100%';
  element.style.overflow = 'hidden';

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
  const scannerStatus = q<HTMLElement>('.js-scanner-status');
  const colorStatus = q<HTMLElement>('.js-color-status');
  const dwellLabel = q<HTMLElement>('.js-dwell-label');
  const dwellAmount = q<HTMLElement>('.js-dwell-amount');
  const dwellFill = q<HTMLElement>('.js-dwell-fill');
  const lastCode = q<HTMLElement>('.js-last-code');
  const toggleCameraButton = q<HTMLButtonElement>('.js-toggle-camera');
  const cameraSelect = q<HTMLSelectElement>('.js-camera-select');
  const video = q<HTMLVideoElement>('.js-camera');
  const overlayEl = q<HTMLDivElement>('.js-scanner-overlay');
  const cardGrid = q<HTMLDivElement>('.js-card-grid');
  const printButton = q<HTMLButtonElement>('.js-print-cards');

  // --- Doc-driven display state ---
  let currentRegions: ColorRegion[] = [];
  let currentAspect = 4 / 3;

  let currentStream: MediaStream | null = null;
  let cameraReady = false;
  let cameraStarting = false;
  let selectedCameraId: string | null = null;
  let destroyed = false;

  function syncFromDoc() {
    const doc = handle.doc() as ColorsDoc | undefined;
    if (!doc) return;

    currentRegions = (doc.activeRegions ?? []).map((r: any) => ({
      hue: r.hue as number,
      corners: (r.corners ?? []).map((c: any) => ({ x: c[0] ?? 0, y: c[1] ?? 0 })),
    }));
    currentAspect = doc.cameraAspect ?? 4 / 3;

    const hues = currentRegions.map((r) => r.hue);
    colorStatus.textContent = hues.length
      ? hues.map((h) => `hue ${h}`).join(', ')
      : 'None';
    sceneTitle.textContent = hues.length
      ? `${hues.length} marker${hues.length > 1 ? 's' : ''}`
      : 'Idle';
    shell.dataset.scene = hues.length ? 'active' : 'idle';
  }

  const effects = createEffectsRenderer({
    canvas: sceneCanvas,
    element,
    getRegions: () => currentRegions,
    getAspectRatio: () => currentAspect,
  });

  const tracker = createCardTracker({
    video,
    onVisibleCardsChange(cards) {
      renderOverlay(overlayEl, video, tracker.getTrackedCards(), cards);
      lastCode.textContent = cards.length
        ? cards.map((card) => `hue ${card.hue}`).join(' \u2022 ')
        : 'No markers visible';
    },
    onRegionsChange(regions) {
      handle.change((doc: ColorsDoc) => {
        doc.activeRegions = regions.map((r) => ({
          hue: r.hue,
          corners: r.corners.map((c) => [c.x, c.y]),
        }));
        doc.cameraAspect = video.videoWidth / (video.videoHeight || 1);
      });
      syncFromDoc();
    },
  });

  function onDocChange() {
    if (!cameraReady) {
      syncFromDoc();
    }
  }
  handle.on('change', onDocChange);

  async function probeCameraAvailability() {
    if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices.enumerateDevices) {
      scannerStatus.textContent = 'Camera API unavailable';
      toggleCameraButton.disabled = true;
      return;
    }

    const devices = await listVideoDevices().catch(() => []);
    if (!devices.length) {
      scannerStatus.textContent = 'No camera detected';
      toggleCameraButton.disabled = true;
    }
  }

  async function startCamera(nextDeviceId?: string) {
    if (cameraStarting) return;

    cameraStarting = true;
    toggleCameraButton.disabled = true;
    toggleCameraButton.textContent = cameraReady ? 'Switching...' : 'Starting...';
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

      scannerStatus.textContent = 'Watching for markers';
      toggleCameraButton.textContent = 'Stop Camera';
      lastCode.textContent = 'No markers visible';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      cameraReady = false;
      scannerStatus.textContent = 'Camera failed';
      lastCode.textContent = message;
      toggleCameraButton.textContent = 'Start Camera';
      toggleCameraButton.disabled = false;
      stopCurrentStream();
    } finally {
      if (cameraReady) {
        toggleCameraButton.disabled = false;
      }
      cameraStarting = false;
    }
  }

  function stopCamera() {
    tracker.stop();
    stopCurrentStream();
    tracker.reset();
    renderOverlay(overlayEl, video, tracker.getTrackedCards(), []);

    handle.change((doc: ColorsDoc) => {
      doc.activeRegions = null;
      doc.cameraAspect = null;
    });
    syncFromDoc();

    scannerStatus.textContent = 'Standby';
    lastCode.textContent = 'Camera stopped';
    toggleCameraButton.textContent = 'Start Camera';
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

  function renderCards() {
    cardGrid.innerHTML = DEFAULT_MARKERS.map((marker) => `
      <article class="print-card" data-category="color">
        <div class="print-card-top">
          <span class="scene-chip" style="background: ${hueToColor(marker.id)}">Hue ${marker.id}</span>
          <span class="print-value">${marker.label}</span>
        </div>
        <div class="print-code-shell">
          ${arucoToSVGString(marker.id, '220px')}
        </div>
        <h3>${marker.label}</h3>
        <p>${marker.description}</p>
      </article>
    `).join('');
  }

  function syncScannerState() {
    if (destroyed) return;
    const now = performance.now();
    const candidateCards = tracker.getCandidateCards();

    if (!cameraReady) {
      dwellLabel.textContent = 'Markers become active after brief stable visibility.';
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
      dwellLabel.textContent = `Settling hue ${nextPending.hue}`;
      dwellAmount.textContent = `${Math.round(progress * 100)}%`;
      dwellFill.style.transform = `scaleX(${progress})`;
    } else {
      dwellLabel.textContent = 'Show ArUco markers to the camera.';
      dwellAmount.textContent = candidates.length ? `${candidates.length} active` : '0%';
      dwellFill.style.transform = 'scaleX(0)';
    }

    const visibleCards = tracker.getVisibleCards();
    scannerStatus.textContent = visibleCards.length
      ? `${visibleCards.length} held`
      : 'Watching for markers';
  }

  const onToggleCamera = () => {
    if (cameraReady) {
      stopCamera();
    } else {
      void startCamera();
    }
  };
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
  const onPrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const cardsHtml = DEFAULT_MARKERS.map((marker) => `
      <div style="page-break-inside: avoid; border: 1px solid #ccc; border-radius: 12px; padding: 24px; display: inline-block; text-align: center; margin: 12px;">
        <div style="display: inline-block; padding: 2px; background: ${hueToColor(marker.id)}; color: white; border-radius: 999px; font-size: 13px; padding: 4px 12px; margin-bottom: 12px;">
          Hue ${marker.id}
        </div>
        <div style="padding: 12px; background: white;">
          ${arucoToSVGString(marker.id, '200px')}
        </div>
        <h2 style="margin: 12px 0 4px; font-family: sans-serif;">${marker.label}</h2>
        <p style="margin: 0; font-family: sans-serif; color: #666; font-size: 14px;">${marker.description}</p>
      </div>
    `).join('');

    printWindow.document.write(`<!DOCTYPE html>
      <html>
      <head><title>ArUco Color Markers</title></head>
      <body style="font-family: sans-serif; text-align: center; padding: 24px;">
        <h1 style="margin-bottom: 24px;">ArUco Color Markers</h1>
        ${cardsHtml}
        <script>window.onload = () => { window.print(); window.close(); }<\/script>
      </body>
      </html>`);
    printWindow.document.close();
  };
  const onResize = () => { effects.resize(); };

  toggleCameraButton.addEventListener('click', onToggleCamera);
  q<HTMLButtonElement>('.js-open-studio').addEventListener('click', onOpenStudio);
  q<HTMLButtonElement>('.js-back-to-display').addEventListener('click', onBackToDisplay);
  cameraSelect.addEventListener('change', onCameraChange);
  printButton.addEventListener('click', onPrint);
  window.addEventListener('resize', onResize);

  syncFromDoc();
  renderCards();
  void probeCameraAvailability();

  const syncIntervalHandle = window.setInterval(syncScannerState, 80);

  return () => {
    destroyed = true;

    tracker.destroy();
    stopCurrentStream();
    effects.destroy();

    if (syncIntervalHandle) {
      window.clearInterval(syncIntervalHandle);
    }

    toggleCameraButton.removeEventListener('click', onToggleCamera);
    cameraSelect.removeEventListener('change', onCameraChange);
    printButton.removeEventListener('click', onPrint);
    window.removeEventListener('resize', onResize);
    handle.off('change', onDocChange);

    element.innerHTML = '';
  };
}
