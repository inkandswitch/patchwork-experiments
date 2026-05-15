import { ensureAudioContext } from '../shared/audio.ts';
import { findHueBridgeIp, pairHue, sendHueAction, hueToHueBridge, percentToHueSat, percentToHueBrightness } from '../shared/hue.ts';
import { clamp } from '../shared/utils.ts';
import type { ClapDoc } from '../types.ts';

type Hsl = {
  h: number;
  s: number;
  l: number;
};

const SAMPLE_SIZE = 1024;
const DEFAULT_PEAK_THRESHOLD = 0.38;
const DEFAULT_WINDOW_MS = 850;
const REFRACTORY_MS = 190;
const COLORS: Hsl[] = [
  { h: 0, s: 92, l: 58 },
  { h: 32, s: 96, l: 58 },
  { h: 118, s: 78, l: 50 },
  { h: 205, s: 90, l: 58 },
  { h: 272, s: 86, l: 60 },
  { h: 322, s: 84, l: 58 },
];

const STYLE = `
  .clap-root {
    --ink: #f7f3e9;
    --muted: rgba(247, 243, 233, 0.66);
    --line: rgba(247, 243, 233, 0.14);
    --panel: rgba(7, 10, 13, 0.72);
    --blue: #71d6ff;
    --green: #7bf5cb;
    --gold: #ffd166;
    --window-progress: 0;
    display: block;
    width: 100%;
    height: 100%;
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    color: var(--ink);
    background: #111820;
    font-synthesis: none;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  * { box-sizing: border-box; }

  button, input { font: inherit; }

  .clap-shell {
    width: 100%;
    height: 100%;
    padding: 12px;
    overflow: hidden;
  }

  #bg-canvas {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
  }

  .topbar, .clap-layout { position: relative; z-index: 1; }

  .topbar {
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

  .primary-action, .secondary-action {
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
    color: #06100d;
    border-color: rgba(255, 255, 255, 0.34);
    background: linear-gradient(135deg, var(--green), var(--gold));
  }

  .secondary-action:disabled, .primary-action:disabled {
    opacity: 0.56;
    cursor: default;
  }

  .clap-layout {
    height: calc(100% - 70px);
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(360px, 0.85fr);
    gap: 12px;
    padding-top: 12px;
  }

  .hero-panel, .panel-card {
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--panel);
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(18px);
  }

  .hero-panel {
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: 14px;
    padding: 20px;
  }

  .hero-copy { display: grid; gap: 8px; }

  .eyebrow {
    margin: 0;
    color: var(--muted);
    letter-spacing: 0.2em;
    text-transform: uppercase;
    font-size: 0.78rem;
  }

  h1, p { margin: 0; }

  h1 {
    font-size: clamp(3.2rem, 8vw, 8rem);
    line-height: 0.84;
    letter-spacing: -0.08em;
  }

  .gesture-subtitle {
    max-width: 760px;
    color: var(--muted);
    font-size: clamp(1rem, 1.7vw, 1.35rem);
    line-height: 1.35;
  }

  .wave-panel {
    min-height: 0;
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    gap: 12px;
  }

  .wave-canvas {
    width: 100%;
    height: 100%;
    min-height: 280px;
    border: 1px solid rgba(247, 243, 233, 0.12);
    border-radius: 18px;
    background: #071117;
    box-shadow: inset 0 0 80px rgba(113, 214, 255, 0.08);
  }

  .meter-row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .meter {
    min-width: 0;
    display: grid;
    gap: 6px;
    padding: 10px;
    border: 1px solid rgba(247, 243, 233, 0.1);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.055);
  }

  .meter span, .decision-panel span {
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.13em;
    font-size: 0.68rem;
  }

  .meter i {
    width: 0%;
    height: 12px;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--blue), var(--green));
    box-shadow: 0 0 22px rgba(123, 245, 203, 0.24);
    transition: width 80ms linear;
  }

  .threshold-meter i {
    background: linear-gradient(90deg, var(--gold), #ff7b54);
  }

  .decision-panel {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .decision-panel article {
    min-width: 0;
    display: grid;
    gap: 5px;
    padding: 12px;
    overflow: hidden;
    border: 1px solid rgba(247, 243, 233, 0.1);
    border-radius: 12px;
    background:
      linear-gradient(90deg, rgba(123, 245, 203, 0.12) calc(var(--window-progress) * 100%), transparent 0),
      rgba(255, 255, 255, 0.055);
  }

  .decision-panel strong {
    overflow-wrap: anywhere;
    font-size: 1.05rem;
  }

  .control-panel {
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: auto auto;
    gap: 12px;
  }

  .panel-card {
    display: grid;
    gap: 12px;
    padding: 16px;
  }

  .field, .slider-row { display: grid; gap: 7px; }

  .field span, .slider-row span {
    color: var(--muted);
    font-size: 0.9rem;
  }

  .field input {
    min-height: 42px;
    width: 100%;
    padding: 0 12px;
    border: 1px solid rgba(247, 243, 233, 0.16);
    border-radius: 9px;
    color: var(--ink);
    background: rgba(0, 0, 0, 0.22);
  }

  .slider-row input {
    width: 100%;
    accent-color: var(--green);
  }

  .button-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .button-grid .secondary-action:first-child:nth-last-child(3) {
    grid-column: span 2;
  }

  .micro-copy {
    color: var(--muted);
    line-height: 1.42;
    font-size: 0.92rem;
  }

  @media (max-width: 980px) {
    .clap-shell { height: auto; min-height: 100%; overflow: auto; }
    .topbar { flex-wrap: wrap; }
    .clap-layout { height: auto; grid-template-columns: 1fr; }
    .hero-panel { min-height: 72vh; }
    .decision-panel, .meter-row { grid-template-columns: 1fr; }
  }
`;

export default function ClapTool(handle: any, element: HTMLElement) {
  // ---- doc state ----
  const doc = handle.doc() as ClapDoc | undefined;
  let peakThreshold = doc?.thresholdConfig?.peakThreshold ?? DEFAULT_PEAK_THRESHOLD;
  let windowMs = doc?.thresholdConfig?.windowMs ?? DEFAULT_WINDOW_MS;
  let hueUsername = doc?.hueConfig?.username ?? '';
  let huePairedBridgeIp = doc?.hueConfig?.bridgeIp ?? '';
  let hueLightsOn = doc?.hueConfig?.lightsOn ?? false;
  let hueBusy = false;

  // ---- audio / mic state ----
  let audioContext: AudioContext | null = null;
  let micStream: MediaStream | null = null;
  let micSource: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let micLoopHandle = 0;
  let listening = false;
  let samples = new Uint8Array(SAMPLE_SIZE);
  let peak = 0;
  let rms = 0;
  let baseline = 0.02;
  let lastClapAt = 0;
  let clapCount = 0;
  let decisionStartedAt = 0;
  let decisionTimer = 0;
  let colorIndex = 0;
  let bgRafHandle = 0;
  let destroyed = false;

  // ---- DOM ----
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  element.appendChild(styleEl);

  const root = document.createElement('div');
  root.className = 'clap-root';
  root.innerHTML = `
    <main class="clap-shell">
      <canvas class="bg-canvas" aria-hidden="true"></canvas>

      <header class="topbar">
        <button class="start-mic primary-action" type="button">Start Mic</button>
      </header>

      <section class="clap-layout">
        <section class="hero-panel">
          <div class="hero-copy">
            <p class="eyebrow">Clap Lights</p>
            <h1 class="gesture-title">Listening test</h1>
            <p class="gesture-subtitle">One clap changes color only when lights are already on. Two claps toggle the Hue light bars on or off.</p>
          </div>

          <div class="wave-panel">
            <canvas class="wave-canvas" aria-label="Microphone waveform"></canvas>
            <div class="meter-row">
              <div class="meter">
                <span>Peak</span>
                <i class="peak-fill"></i>
              </div>
              <div class="meter">
                <span>RMS</span>
                <i class="rms-fill"></i>
              </div>
              <div class="meter threshold-meter">
                <span>Threshold</span>
                <i class="threshold-fill"></i>
              </div>
            </div>
          </div>

          <section class="decision-panel">
            <article>
              <span>Detected Claps</span>
              <strong class="clap-count">0</strong>
            </article>
            <article>
              <span>Decision Window</span>
              <strong class="window-status">Idle</strong>
            </article>
            <article>
              <span>Last Action</span>
              <strong class="last-action">None</strong>
            </article>
          </section>
        </section>

        <aside class="control-panel">
          <section class="panel-card">
            <p class="eyebrow">Hue Bridge</p>
            <label class="field">
              <span>Bridge IP</span>
              <input class="bridge-ip" type="text" inputmode="decimal" autocomplete="off" placeholder="192.168.1.50" />
            </label>
            <div class="button-grid">
              <button class="find-bridge secondary-action" type="button">Find Bridge</button>
              <button class="pair-bridge secondary-action" type="button">Pair</button>
              <button class="toggle-lights secondary-action" type="button">Turn Lights On</button>
            </div>
            <p class="hue-status micro-copy">Use the same Hue Bridge pairing as Colors, or pair here.</p>
          </section>

          <section class="panel-card">
            <p class="eyebrow">Classifier</p>
            <label class="slider-row">
              <span>Peak threshold <strong class="threshold-label">${peakThreshold.toFixed(2)}</strong></span>
              <input class="threshold-slider" type="range" min="0.18" max="0.78" step="0.01" value="${peakThreshold}" />
            </label>
            <label class="slider-row">
              <span>Double-clap window <strong class="window-label">${windowMs}ms</strong></span>
              <input class="window-slider" type="range" min="420" max="1300" step="10" value="${windowMs}" />
            </label>
            <div class="button-grid">
              <button class="test-single secondary-action" type="button">Test 1 Clap</button>
              <button class="test-double secondary-action" type="button">Test 2 Claps</button>
            </div>
            <p class="micro-copy">A clap counts when the waveform jumps above the threshold after a short cooldown. One clap changes color only while lights are on. Two claps toggle power.</p>
          </section>
        </aside>
      </section>
    </main>
  `;
  element.appendChild(root);

  // ---- query helpers ----
  function q<T extends Element>(sel: string): T {
    const el = element.querySelector<T>(sel);
    if (!el) throw new Error(`Missing element: ${sel}`);
    return el;
  }

  const bgCanvas = q<HTMLCanvasElement>('.bg-canvas');
  const bgContext = bgCanvas.getContext('2d')!;
  const waveCanvas = q<HTMLCanvasElement>('.wave-canvas');
  const waveContext = waveCanvas.getContext('2d')!;
  const startMicButton = q<HTMLButtonElement>('.start-mic');
  const bridgeIpInput = q<HTMLInputElement>('.bridge-ip');
  const findBridgeButton = q<HTMLButtonElement>('.find-bridge');
  const pairBridgeButton = q<HTMLButtonElement>('.pair-bridge');
  const toggleLightsButton = q<HTMLButtonElement>('.toggle-lights');
  const hueStatusEl = q<HTMLElement>('.hue-status');
  const gestureTitleEl = q<HTMLElement>('.gesture-title');
  const gestureSubtitleEl = q<HTMLElement>('.gesture-subtitle');
  const peakFillEl = q<HTMLElement>('.peak-fill');
  const rmsFillEl = q<HTMLElement>('.rms-fill');
  const thresholdFillEl = q<HTMLElement>('.threshold-fill');
  const clapCountLabel = q<HTMLElement>('.clap-count');
  const windowStatusEl = q<HTMLElement>('.window-status');
  const lastActionEl = q<HTMLElement>('.last-action');
  const thresholdSlider = q<HTMLInputElement>('.threshold-slider');
  const thresholdLabelEl = q<HTMLElement>('.threshold-label');
  const windowSlider = q<HTMLInputElement>('.window-slider');
  const windowLabelEl = q<HTMLElement>('.window-label');
  const testSingleButton = q<HTMLButtonElement>('.test-single');
  const testDoubleButton = q<HTMLButtonElement>('.test-double');

  // ---- load persisted Hue state ----
  bridgeIpInput.value = huePairedBridgeIp;
  syncHueControls();
  syncClassifierLabels();
  resizeCanvases();
  bgRafHandle = requestAnimationFrame(renderBackground);
  drawWaveform();

  // ---- persistence helpers ----
  function persistThresholdConfig() {
    handle.change((doc: ClapDoc) => {
      doc.thresholdConfig = {
        peakThreshold,
        windowMs,
      };
    });
  }

  function persistHueConfig() {
    const bridgeIp = getHueBridgeIp();
    if (bridgeIp && hueUsername) {
      handle.change((doc: ClapDoc) => {
        doc.hueConfig = {
          bridgeIp,
          username: hueUsername,
          lightsOn: hueLightsOn,
        };
      });
    } else {
      handle.change((doc: ClapDoc) => {
        doc.hueConfig = null;
      });
    }
  }

  // ---- event listeners ----
  startMicButton.addEventListener('click', () => {
    void toggleMic();
  });

  bridgeIpInput.addEventListener('input', () => {
    if (getHueBridgeIp() !== huePairedBridgeIp) {
      hueUsername = '';
    }
    persistHueConfig();
    syncHueControls();
  });

  findBridgeButton.addEventListener('click', () => {
    void findHueBridge();
  });

  pairBridgeButton.addEventListener('click', () => {
    void pairHueBridge();
  });

  toggleLightsButton.addEventListener('click', () => {
    void toggleHueLights();
  });

  thresholdSlider.addEventListener('input', () => {
    peakThreshold = Number(thresholdSlider.value);
    syncClassifierLabels();
    persistThresholdConfig();
  });

  windowSlider.addEventListener('input', () => {
    windowMs = Number(windowSlider.value);
    syncClassifierLabels();
    persistThresholdConfig();
  });

  testSingleButton.addEventListener('click', () => {
    registerClap(performance.now());
  });

  testDoubleButton.addEventListener('click', () => {
    registerClap(performance.now());
    window.setTimeout(() => registerClap(performance.now()), Math.min(windowMs - 80, 280));
  });

  const onResize = () => resizeCanvases();
  window.addEventListener('resize', onResize);

  // ---- mic ----
  async function toggleMic() {
    if (listening) {
      stopMic();
      setActionText('Mic stopped', 'Start again when you want to test claps.');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setActionText('No mic API', 'This browser does not expose microphone access.');
      return;
    }

    try {
      audioContext = await ensureAudioContext();
      if (!audioContext) {
        setActionText('Audio unsupported', 'Web Audio is unavailable in this browser.');
        return;
      }

      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      micSource = audioContext.createMediaStreamSource(micStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = SAMPLE_SIZE;
      analyser.smoothingTimeConstant = 0.08;
      samples = new Uint8Array(analyser.fftSize);
      micSource.connect(analyser);
      baseline = 0.02;
      lastClapAt = 0;
      clapCount = 0;
      decisionStartedAt = 0;
      listening = true;
      startMicButton.textContent = 'Stop Mic';
      setActionText('Listening', 'One clap changes color if lights are on. Two claps toggle on/off.');
      micLoopHandle = window.requestAnimationFrame(readMic);
    } catch (error) {
      stopMic();
      const message = error instanceof Error ? error.message : String(error);
      setActionText('Mic failed', message);
    }
  }

  function stopMic() {
    if (micLoopHandle) {
      window.cancelAnimationFrame(micLoopHandle);
      micLoopHandle = 0;
    }

    if (decisionTimer) {
      window.clearTimeout(decisionTimer);
      decisionTimer = 0;
    }

    micSource?.disconnect();
    micSource = null;
    analyser = null;
    micStream?.getTracks().forEach((track) => track.stop());
    micStream = null;
    listening = false;
    clapCount = 0;
    decisionStartedAt = 0;
    startMicButton.textContent = 'Start Mic';
    updateDecisionUi();
  }

  function readMic(timestamp: number) {
    if (!listening || !analyser || destroyed) return;

    analyser.getByteTimeDomainData(samples);
    peak = 0;
    let sum = 0;

    for (const sample of samples) {
      const centered = Math.abs(sample - 128) / 128;
      peak = Math.max(peak, centered);
      sum += centered * centered;
    }

    rms = Math.sqrt(sum / samples.length);
    baseline = baseline * 0.988 + rms * 0.012;
    updateMeters();
    drawWaveform();

    const adaptiveThreshold = Math.max(peakThreshold, baseline * 5);
    const aboveThreshold = peak >= adaptiveThreshold || rms >= adaptiveThreshold * 0.42;
    const cooledDown = timestamp - lastClapAt >= REFRACTORY_MS;

    if (aboveThreshold && cooledDown) {
      lastClapAt = timestamp;
      registerClap(timestamp);
    }

    updateDecisionUi(timestamp);
    micLoopHandle = window.requestAnimationFrame(readMic);
  }

  // ---- clap detection ----
  function registerClap(timestamp: number) {
    clapCount += 1;
    lastClapAt = timestamp;

    if (clapCount === 1) {
      decisionStartedAt = timestamp;
      setActionText('One clap heard', 'Waiting briefly for a possible second clap.');
    }

    if (clapCount >= 2) {
      if (decisionTimer) {
        window.clearTimeout(decisionTimer);
        decisionTimer = 0;
      }
      clapCount = 0;
      decisionStartedAt = 0;
      void triggerPowerToggle();
      updateDecisionUi(timestamp);
      return;
    }

    if (decisionTimer) {
      window.clearTimeout(decisionTimer);
    }

    decisionTimer = window.setTimeout(() => {
      decisionTimer = 0;
      const count = clapCount;
      clapCount = 0;
      decisionStartedAt = 0;
      if (count === 1) {
        void triggerColorChange();
      }
      updateDecisionUi();
    }, windowMs);
    updateDecisionUi(timestamp);
  }

  // ---- Hue actions ----
  async function triggerColorChange() {
    if (!hueLightsOn) {
      setActionText('Single clap ignored', 'Lights are off. Double clap to turn them on first.');
      syncHueControls('Single clap ignored: lights are off. Double clap to turn them on.');
      return;
    }

    const color = COLORS[colorIndex % COLORS.length];
    colorIndex += 1;
    setActionText('Single clap: color', `Hue ${Math.round(color.h)} degrees.`);
    const bridgeIp = getHueBridgeIp();
    if (!bridgeIp || !hueUsername) return;

    try {
      await sendHueAction(bridgeIp, hueUsername, {
        hue: hueToHueBridge(color.h),
        sat: percentToHueSat(color.s),
        bri: percentToHueBrightness(Math.min(100, color.l + 34)),
        transitiontime: 1,
      });
    } catch {
      syncHueControls('Hue request failed. Check bridge IP/network.');
    }
  }

  async function triggerPowerToggle() {
    const nextOn = !hueLightsOn;
    hueLightsOn = nextOn;
    persistHueConfig();
    setActionText(nextOn ? 'Double clap: ON' : 'Double clap: OFF', nextOn ? 'Power toggled on.' : 'Power toggled off.');
    const bridgeIp = getHueBridgeIp();
    if (!bridgeIp || !hueUsername) return;

    try {
      await sendHueAction(bridgeIp, hueUsername, {
        on: nextOn,
        bri: nextOn ? 254 : undefined,
        transitiontime: 1,
      });
    } catch {
      syncHueControls('Hue request failed. Check bridge IP/network.');
    }
  }

  // ---- UI helpers ----
  function updateMeters() {
    peakFillEl.style.width = `${clamp(peak, 0, 1) * 100}%`;
    rmsFillEl.style.width = `${clamp(rms * 2.2, 0, 1) * 100}%`;
    thresholdFillEl.style.width = `${peakThreshold * 100}%`;
  }

  function updateDecisionUi(timestamp = performance.now()) {
    clapCountLabel.textContent = String(clapCount);
    if (!clapCount || !decisionStartedAt) {
      windowStatusEl.textContent = 'Idle';
      root.style.setProperty('--window-progress', '0');
      return;
    }

    const progress = clamp((timestamp - decisionStartedAt) / windowMs, 0, 1);
    root.style.setProperty('--window-progress', String(progress));
    windowStatusEl.textContent = `${Math.round((1 - progress) * windowMs)}ms for second clap`;
  }

  function drawWaveform() {
    const width = waveCanvas.clientWidth || 1;
    const height = waveCanvas.clientHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (waveCanvas.width !== Math.floor(width * dpr) || waveCanvas.height !== Math.floor(height * dpr)) {
      waveCanvas.width = Math.floor(width * dpr);
      waveCanvas.height = Math.floor(height * dpr);
      waveContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    waveContext.clearRect(0, 0, width, height);
    const gradient = waveContext.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#071117');
    gradient.addColorStop(1, '#121f18');
    waveContext.fillStyle = gradient;
    waveContext.fillRect(0, 0, width, height);

    const thresholdY = height * (1 - peakThreshold);
    waveContext.strokeStyle = 'rgba(255, 209, 102, 0.82)';
    waveContext.setLineDash([8, 8]);
    waveContext.beginPath();
    waveContext.moveTo(0, thresholdY);
    waveContext.lineTo(width, thresholdY);
    waveContext.stroke();
    waveContext.setLineDash([]);

    waveContext.strokeStyle = peak >= peakThreshold ? '#7bf5cb' : '#71d6ff';
    waveContext.lineWidth = 3;
    waveContext.beginPath();
    for (let index = 0; index < samples.length; index += 1) {
      const x = index / (samples.length - 1) * width;
      const centered = (samples[index] - 128) / 128;
      const y = height * 0.5 + centered * height * 0.42;
      if (index === 0) {
        waveContext.moveTo(x, y);
      } else {
        waveContext.lineTo(x, y);
      }
    }
    waveContext.stroke();

    if (clapCount) {
      waveContext.fillStyle = 'rgba(123, 245, 203, 0.16)';
      waveContext.fillRect(0, 0, width * clamp((performance.now() - decisionStartedAt) / windowMs, 0, 1), height);
    }
  }

  function syncClassifierLabels() {
    thresholdLabelEl.textContent = peakThreshold.toFixed(2);
    windowLabelEl.textContent = `${windowMs}ms`;
    updateMeters();
    drawWaveform();
  }

  function setActionText(title: string, subtitle: string) {
    gestureTitleEl.textContent = title;
    gestureSubtitleEl.textContent = subtitle;
    lastActionEl.textContent = title;
  }

  function syncHueControls(message?: string) {
    const bridgeIp = getHueBridgeIp();
    findBridgeButton.disabled = hueBusy;
    pairBridgeButton.disabled = hueBusy || !bridgeIp;
    toggleLightsButton.disabled = hueBusy || !bridgeIp || !hueUsername;
    toggleLightsButton.textContent = hueLightsOn ? 'Turn Lights Off' : 'Turn Lights On';

    if (message) {
      hueStatusEl.textContent = message;
    } else if (!bridgeIp) {
      hueStatusEl.textContent = 'Enter the Hue Bridge IP, or use Find Bridge.';
    } else if (!hueUsername) {
      hueStatusEl.textContent = 'Press the physical Hue Bridge button, then Pair.';
    } else {
      hueStatusEl.textContent = `Paired with ${bridgeIp}. Start mic to test clap controls.`;
    }
  }

  async function findHueBridge() {
    hueBusy = true;
    syncHueControls('Looking for Hue bridges...');
    let statusMessage = '';

    try {
      const ip = await findHueBridgeIp();
      if (!ip) {
        statusMessage = 'No Hue Bridge found. Check bridge/router connection.';
        return;
      }

      bridgeIpInput.value = ip;
      if (getHueBridgeIp() !== huePairedBridgeIp) {
        hueUsername = '';
      }
      persistHueConfig();
      statusMessage = `Found Hue Bridge at ${ip}. Press bridge button, then Pair.`;
    } catch {
      statusMessage = 'Bridge discovery failed. Type the bridge IP manually.';
    } finally {
      hueBusy = false;
      syncHueControls(statusMessage || undefined);
    }
  }

  async function pairHueBridge() {
    const bridgeIp = getHueBridgeIp();
    if (!bridgeIp) {
      syncHueControls('Enter the Hue Bridge IP first.');
      return;
    }

    hueBusy = true;
    syncHueControls('Pairing... press the bridge button if this fails.');
    let statusMessage = '';

    try {
      const username = await pairHue(bridgeIp, 'clap_lights#browser');
      if (username) {
        hueUsername = username;
        huePairedBridgeIp = bridgeIp;
        persistHueConfig();
        statusMessage = 'Paired. Start mic or use Test buttons.';
      } else {
        statusMessage = 'Pairing failed. Press the bridge button and try again.';
      }
    } catch {
      statusMessage = 'Pairing request failed. Check bridge IP and network.';
    } finally {
      hueBusy = false;
      syncHueControls(statusMessage || undefined);
    }
  }

  async function toggleHueLights() {
    const nextOn = !hueLightsOn;
    hueLightsOn = nextOn;
    persistHueConfig();
    syncHueControls(nextOn ? 'Turning Hue lights on...' : 'Turning Hue lights off...');
    const bridgeIp = getHueBridgeIp();
    if (!bridgeIp || !hueUsername) return;

    try {
      await sendHueAction(bridgeIp, hueUsername, { on: nextOn, bri: nextOn ? 254 : undefined, transitiontime: 1 });
      syncHueControls(nextOn ? 'Hue lights are on.' : 'Hue lights are off.');
    } catch {
      syncHueControls('Hue request failed. Check bridge IP/network.');
    }
  }

  // ---- background animation ----
  function renderBackground(timestamp: number) {
    if (destroyed) return;

    const rect = root.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const time = timestamp * 0.001;

    if (bgCanvas.width !== Math.floor(width) || bgCanvas.height !== Math.floor(height)) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      bgCanvas.width = Math.floor(width * dpr);
      bgCanvas.height = Math.floor(height * dpr);
      bgCanvas.style.width = `${width}px`;
      bgCanvas.style.height = `${height}px`;
      bgContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    bgContext.clearRect(0, 0, width, height);
    const gradient = bgContext.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#10161d');
    gradient.addColorStop(0.5, '#172822');
    gradient.addColorStop(1, '#121620');
    bgContext.fillStyle = gradient;
    bgContext.fillRect(0, 0, width, height);
    bgContext.save();
    bgContext.globalCompositeOperation = 'screen';
    for (let index = 0; index < 10; index += 1) {
      const x = width * ((index + 0.35) / 10) + Math.sin(time * 0.24 + index) * 44;
      const y = height * (0.18 + (index % 4) * 0.19) + Math.cos(time * 0.28 + index) * 38;
      const glow = bgContext.createRadialGradient(x, y, 0, x, y, 220);
      glow.addColorStop(0, index % 2 ? 'rgba(255,209,102,0.13)' : 'rgba(113,214,255,0.15)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      bgContext.fillStyle = glow;
      bgContext.fillRect(0, 0, width, height);
    }
    bgContext.restore();
    bgRafHandle = requestAnimationFrame(renderBackground);
  }

  function resizeCanvases() {
    const rect = root.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    bgCanvas.width = Math.floor(rect.width * dpr);
    bgCanvas.height = Math.floor(rect.height * dpr);
    bgCanvas.style.width = `${rect.width}px`;
    bgCanvas.style.height = `${rect.height}px`;
    bgContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawWaveform();
  }

  function getHueBridgeIp() {
    return bridgeIpInput.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }

  // ---- cleanup ----
  return () => {
    destroyed = true;
    stopMic();
    if (bgRafHandle) {
      cancelAnimationFrame(bgRafHandle);
      bgRafHandle = 0;
    }
    void audioContext?.close();
    audioContext = null;
    window.removeEventListener('resize', onResize);
  };
}
