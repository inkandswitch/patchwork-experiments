import QRCode from 'qrcode';
import type { ColorsDoc, Point, ColorId, EffectId, SoundId } from '../types.ts';
import { createWasmDetector, type MultiDetector } from '../shared/qr-detector.ts';
import { listVideoDevices, buildVideoConstraints, waitForVideoReady, stopStream } from '../shared/camera.ts';
import { ensureAudioContext, createNoiseSource } from '../shared/audio.ts';
import {
  findHueBridgeIp,
  pairHue,
  sendHueAction,
  hueToHueBridge,
  percentToHueSat,
  percentToHueBrightness,
  type HueAction,
} from '../shared/hue.ts';
import { clamp, escapeHtml, polygonArea, computeOverlayGeometry, projectPoint } from '../shared/utils.ts';

type CardCategory = 'color' | 'fx' | 'sound';
type CardPayload = `color:${ColorId}` | `fx:${EffectId}` | `sound:${SoundId}`;

type CardDefinition = {
  payload: CardPayload;
  category: CardCategory;
  id: ColorId | EffectId | SoundId;
  label: string;
  description: string;
  accent: string;
};

type Hsl = {
  h: number;
  s: number;
  l: number;
};

type Palette = {
  name: string;
  accent: string;
  glow: string;
  background: [string, string, string];
  panel: string;
  text: string;
};

type VisibleCard = {
  trackingId: string;
  card: CardDefinition;
  rawValue: string;
  cornerPoints: Point[];
  x: number;
  y: number;
  area: number;
};

type CandidateCard = {
  trackingId: string;
  card: CardDefinition;
  firstSeenAt: number;
  lastSeenAt: number;
  lastArea: number;
  x: number;
  y: number;
};

type TrackedSceneCard = {
  id: string;
  card: VisibleCard;
  lastSeenAt: number;
};

type ActiveComposition = {
  colors: ColorId[];
  effect: EffectId | null;
  sound: SoundId | null;
  palette: Palette;
  title: string;
  tagline: string;
  key: string;
};

const DWELL_MS = 160;
const CARD_TTL_MS = 1400;
const MAX_SCANS_PER_SECOND = 14;
const TRACK_MATCH_DISTANCE_RATIO = 0.15;

const COLOR_ORDER: ColorId[] = ['red', 'blue', 'yellow', 'green'];

const COLOR_LIBRARY: Record<ColorId, { label: string; hsl: Hsl; accent: string; description: string }> = {
  red: {
    label: 'Red',
    hsl: { h: 6, s: 80, l: 56 },
    accent: '#e24f3e',
    description: 'Warm crimson palette. Pair with blue for purple or yellow for orange.',
  },
  blue: {
    label: 'Blue',
    hsl: { h: 220, s: 84, l: 58 },
    accent: '#4b7dff',
    description: 'Cool electric blue. Pair with red for purple or yellow for spring green.',
  },
  yellow: {
    label: 'Yellow',
    hsl: { h: 48, s: 92, l: 62 },
    accent: '#f6c74b',
    description: 'Bright golden yellow. Pair with red for orange or green for lime.',
  },
  green: {
    label: 'Green',
    hsl: { h: 145, s: 62, l: 48 },
    accent: '#4fbf78',
    description: 'Fresh leaf green. Pair with blue for cyan or yellow for lime.',
  },
};

const EFFECT_LIBRARY: Record<EffectId, { label: string; description: string; accent: string }> = {
  ripple: {
    label: 'Ripple',
    description: 'A liquid energy field with shock rings, caustics, and orbiting flares.',
    accent: '#8cc9ff',
  },
  grid: {
    label: 'Grid',
    description: 'A hyperspace tunnel with portal frames, rails, and star streaks.',
    accent: '#9be06b',
  },
  grain: {
    label: 'Grain',
    description: 'A prism storm of shards, orbiting dust, and radiant debris.',
    accent: '#f0d18a',
  },
};

const SOUND_LIBRARY: Record<SoundId, { label: string; description: string; accent: string }> = {
  chime: {
    label: 'Chime',
    description: 'Sparse bell tones in a pentatonic pattern.',
    accent: '#f2f5ff',
  },
  pad: {
    label: 'Pad',
    description: 'Airy sustained synth chords with slow filter drift.',
    accent: '#c5e6ff',
  },
  lofi: {
    label: 'Lofi',
    description: 'Soft pulse, filtered hiss, and mellow tape wobble.',
    accent: '#ffd3a1',
  },
};

const IDLE_PALETTE: Palette = {
  name: 'Idle Field',
  accent: '#355f70',
  glow: 'rgba(100, 187, 210, 0.36)',
  background: ['#f4e7d4', '#dce8dd', '#fff8ef'],
  panel: 'rgba(255, 249, 239, 0.74)',
  text: '#152329',
};

const CARD_DEFINITIONS: CardDefinition[] = [
  ...COLOR_ORDER.map((colorId) => ({
    payload: `color:${colorId}` as CardPayload,
    category: 'color' as const,
    id: colorId,
    label: COLOR_LIBRARY[colorId].label,
    description: COLOR_LIBRARY[colorId].description,
    accent: COLOR_LIBRARY[colorId].accent,
  })),
  ...(['ripple', 'grid', 'grain'] as const).map((effectId) => ({
    payload: `fx:${effectId}` as CardPayload,
    category: 'fx' as const,
    id: effectId,
    label: EFFECT_LIBRARY[effectId].label,
    description: EFFECT_LIBRARY[effectId].description,
    accent: EFFECT_LIBRARY[effectId].accent,
  })),
  ...(['chime', 'pad', 'lofi'] as const).map((soundId) => ({
    payload: `sound:${soundId}` as CardPayload,
    category: 'sound' as const,
    id: soundId,
    label: SOUND_LIBRARY[soundId].label,
    description: SOUND_LIBRARY[soundId].description,
    accent: SOUND_LIBRARY[soundId].accent,
  })),
];

const CARD_LIBRARY = new Map<CardPayload, CardDefinition>(
  CARD_DEFINITIONS.map((card) => [card.payload, card]),
);

// ---------------------------------------------------------------------------
// Inline styles (adapted from qr-scene-machine/src/style.css)
// ---------------------------------------------------------------------------

const STYLE = `
.app-shell {
  --scene-bg-a: #f4e7d4;
  --scene-bg-b: #dce8dd;
  --scene-bg-c: #fff8ef;
  --scene-accent: #355f70;
  --scene-glow: rgba(100, 187, 210, 0.36);
  --scene-panel: rgba(255, 249, 239, 0.74);
  --scene-text: #152329;
  --scene-border: rgba(255, 255, 255, 0.28);
  --scene-shadow: 0 24px 80px rgba(16, 24, 24, 0.16);
  --scene-page-width: 1260px;
  --heading-font: Georgia, 'Palatino Linotype', serif;
  --body-font: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  --mono-font: 'Cascadia Code', Consolas, monospace;
  font-family: var(--body-font);
  color: var(--scene-text);
  background:
    radial-gradient(circle at 20% 20%, rgba(255, 255, 255, 0.18), transparent 26%),
    linear-gradient(140deg, var(--scene-bg-a), var(--scene-bg-b), var(--scene-bg-c));
  color-scheme: light;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  margin: 0;
  position: relative;
  width: 100%;
  height: 100%;
  scroll-behavior: smooth;
  overflow-y: auto;
  transition:
    background 700ms ease,
    color 420ms ease;
}

* {
  box-sizing: border-box;
}

button,
select,
code {
  font: inherit;
}

button,
select {
  border: 0;
}

code {
  font-family: var(--mono-font);
  font-size: 0.92rem;
}

.scene-canvas {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.scene-noise {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  opacity: 0.25;
  mix-blend-mode: soft-light;
  background-image:
    radial-gradient(circle at 1px 1px, rgba(255, 255, 255, 0.35) 1px, transparent 0),
    radial-gradient(circle at 2px 2px, rgba(0, 0, 0, 0.12) 1px, transparent 0);
  background-size: 18px 18px, 23px 23px;
}

.display-stage,
.studio-shell,
.studio-header,
.hero-stage,
.card-sheet {
  position: relative;
  z-index: 2;
}

.studio-header,
.hero-stage,
.card-sheet {
  max-width: var(--scene-page-width);
  margin: 0 auto;
}

.display-stage {
  min-height: 100%;
}

.display-toolbar {
  position: absolute;
  top: 18px;
  right: 18px;
  display: flex;
  gap: 10px;
}

.utility-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 0 16px;
  border-radius: 999px;
  cursor: pointer;
  color: white;
  background: rgba(12, 16, 20, 0.26);
  border: 1px solid rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(18px);
  transition:
    transform 180ms ease,
    background 220ms ease,
    border-color 220ms ease,
    box-shadow 180ms ease,
    opacity 180ms ease;
}

.utility-button:hover,
.utility-button:focus-visible {
  transform: translateY(-1px);
  background: rgba(12, 16, 20, 0.36);
  border-color: rgba(255, 255, 255, 0.26);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
}

.utility-button:disabled {
  opacity: 0.62;
  cursor: default;
  transform: none;
}

.studio-shell {
  padding: 22px 24px 56px;
}

.studio-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 20px 24px;
  margin-bottom: 22px;
}

.hero-stage {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  gap: 22px;
  min-height: calc(100% - 96px);
  align-items: stretch;
}

.panel {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--scene-border);
  background: var(--scene-panel);
  box-shadow: var(--scene-shadow);
  backdrop-filter: blur(22px);
  border-radius: 28px;
  transition:
    background 520ms ease,
    border-color 520ms ease,
    box-shadow 520ms ease;
}

.panel::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.16), transparent 40%);
}

.hero-copy {
  padding: 34px 34px 30px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 26px;
}

.eyebrow {
  margin: 0 0 10px;
  font-size: 0.88rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  opacity: 0.72;
}

h1,
h2,
h3 {
  margin: 0;
  font-family: var(--heading-font);
  font-weight: 600;
  letter-spacing: -0.02em;
}

h1 {
  font-size: clamp(3rem, 5vw, 5.1rem);
  line-height: 0.98;
  max-width: 12ch;
}

h2 {
  font-size: clamp(1.45rem, 2vw, 2rem);
}

h3 {
  font-size: 1.45rem;
}

.tagline,
.micro-copy,
.print-card p {
  margin: 0;
  line-height: 1.55;
  max-width: 56ch;
  opacity: 0.88;
}

.tagline {
  font-size: 1.12rem;
}

.controls {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.primary-button,
.secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 18px;
  border-radius: 999px;
  cursor: pointer;
  transition:
    transform 180ms ease,
    box-shadow 180ms ease,
    background 240ms ease,
    color 240ms ease,
    opacity 180ms ease;
}

.compact-button {
  min-height: 40px;
  padding: 0 14px;
}

.primary-button {
  background: linear-gradient(135deg, var(--scene-accent), color-mix(in srgb, var(--scene-accent) 48%, white));
  color: white;
  box-shadow: 0 10px 30px color-mix(in srgb, var(--scene-accent) 25%, transparent);
}

.secondary-button {
  background: rgba(255, 255, 255, 0.18);
  color: inherit;
  border: 1px solid rgba(255, 255, 255, 0.28);
}

.primary-button:hover,
.secondary-button:hover,
.primary-button:focus-visible,
.secondary-button:focus-visible {
  transform: translateY(-1px);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
}

.primary-button:disabled {
  opacity: 0.68;
  cursor: progress;
  transform: none;
}

.secondary-button:disabled {
  opacity: 0.58;
  cursor: default;
  transform: none;
}

.secondary-button.is-active {
  color: #111c17;
  background: linear-gradient(135deg, #baffcf, #ffe08a);
  border-color: rgba(255, 255, 255, 0.52);
  box-shadow: 0 0 28px rgba(186, 255, 207, 0.22);
}

.hue-panel {
  display: grid;
  grid-template-columns: minmax(150px, 0.8fr) minmax(170px, 1fr);
  gap: 12px;
  align-items: end;
  padding: 16px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.18);
}

.hue-panel .eyebrow {
  margin-bottom: 6px;
}

.hue-panel h3 {
  font-size: 1.35rem;
}

.hue-field {
  display: grid;
  gap: 7px;
}

.hue-field span {
  font-size: 0.78rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  opacity: 0.68;
}

.hue-field input {
  min-height: 42px;
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 16px;
  padding: 0 12px;
  color: inherit;
  background: rgba(255, 255, 255, 0.18);
  font: inherit;
}

.hue-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.hue-panel .micro-copy {
  grid-column: 1 / -1;
  font-size: 0.9rem;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.status-card {
  padding: 16px 18px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.18);
  display: grid;
  gap: 7px;
}

.status-label {
  font-size: 0.78rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  opacity: 0.68;
}

.status-card strong,
.camera-note strong {
  font-size: 1.02rem;
  font-weight: 600;
}

.dwell-meter {
  display: grid;
  gap: 10px;
}

.dwell-copy {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dwell-track {
  height: 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.18);
}

.dwell-fill {
  width: 100%;
  height: 100%;
  transform-origin: left center;
  transform: scaleX(0);
  background: linear-gradient(90deg, var(--scene-accent), color-mix(in srgb, var(--scene-accent) 30%, white));
  box-shadow: 0 0 24px var(--scene-glow);
  transition: transform 80ms linear;
}

.camera-panel {
  padding: 24px;
  display: grid;
  gap: 18px;
}

.camera-header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
}

.camera-picker {
  display: grid;
  gap: 8px;
  min-width: 180px;
  font-size: 0.92rem;
}

.camera-picker select {
  min-height: 42px;
  border-radius: 16px;
  padding: 0 12px;
  background: rgba(255, 255, 255, 0.18);
  color: inherit;
  border: 1px solid rgba(255, 255, 255, 0.24);
}

.video-shell {
  position: relative;
  aspect-ratio: 4 / 3;
  border-radius: 22px;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.1), transparent 44%),
    rgba(8, 14, 18, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.video-shell video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.video-reticle {
  position: absolute;
  inset: 12%;
  border-radius: 28px;
  border: 1px dashed rgba(255, 255, 255, 0.2);
  pointer-events: none;
}

.video-reticle::before,
.video-reticle::after {
  content: '';
  position: absolute;
  inset: 18px;
  border-radius: 22px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.scanner-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.scanner-overlay svg {
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 0 14px var(--scene-glow));
}

.scanner-overlay .qr-outline {
  stroke-width: 4px;
  stroke-linejoin: round;
}

.scanner-overlay .qr-outline.held {
  opacity: 0.45;
  stroke-dasharray: 8 7;
}

.scanner-overlay .qr-label {
  font-family: var(--body-font);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  fill: white;
  paint-order: stroke;
  stroke: rgba(0, 0, 0, 0.56);
  stroke-width: 3px;
  stroke-linejoin: round;
}

.camera-footer {
  display: grid;
  gap: 10px;
}

.camera-note {
  display: grid;
  gap: 8px;
  padding: 16px 18px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.18);
}

.card-sheet {
  margin-top: 22px;
  padding: 28px;
}

.card-sheet-header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 22px;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}

.print-card {
  padding: 20px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.2);
  display: grid;
  gap: 14px;
}

.print-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.scene-chip,
.print-value {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  border-radius: 999px;
  padding: 0 12px;
}

.scene-chip {
  background: var(--scene-accent);
  color: white;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 0.76rem;
}

.print-value {
  background: rgba(255, 255, 255, 0.46);
  font-family: var(--mono-font);
  font-size: 0.86rem;
}

.print-code-shell {
  background: white;
  border-radius: 18px;
  padding: 14px;
  justify-self: center;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
}

.print-code-shell canvas {
  display: block;
  width: min(100%, 240px);
  height: auto;
}

.print-card[data-category='color'] .scene-chip {
  background: #355f70;
}

.print-card[data-category='fx'] .scene-chip {
  background: #597f47;
}

.print-card[data-category='sound'] .scene-chip {
  background: #7a5a2f;
}

@media (max-width: 1080px) {
  .studio-header {
    align-items: start;
    flex-direction: column;
  }

  .hero-stage {
    grid-template-columns: 1fr;
    min-height: auto;
  }

  .card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .display-toolbar {
    top: 14px;
    right: 14px;
    left: 14px;
    justify-content: space-between;
  }

  .studio-shell {
    padding: 18px 14px 32px;
  }

  .studio-header,
  .hero-copy,
  .camera-panel,
  .card-sheet {
    padding: 20px;
  }

  .status-grid,
  .card-grid {
    grid-template-columns: 1fr;
  }

  .camera-header,
  .card-sheet-header,
  .dwell-copy,
  .studio-header {
    align-items: start;
    flex-direction: column;
  }

  h1 {
    max-width: none;
  }
}
`;

// ---------------------------------------------------------------------------
// Tool entry point
// ---------------------------------------------------------------------------

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
              Blend up to two color cards, one effect card, and one sound card at the same time.
            </p>

            <div class="controls">
              <button class="primary-button js-start-camera" type="button">Enable Webcam + Audio</button>
              <button class="secondary-button js-test-audio" type="button">Test Audio</button>
              <button class="secondary-button js-print-cards" type="button">Print Cards</button>
            </div>

            <section class="hue-panel">
              <div>
                <p class="eyebrow">Hue Bridge</p>
                <h3>Light bars</h3>
              </div>
              <label class="hue-field">
                <span>Bridge IP</span>
                <input class="js-hue-bridge-ip" type="text" inputmode="decimal" autocomplete="off" placeholder="192.168.1.50" />
              </label>
              <div class="hue-actions">
                <button class="secondary-button compact-button js-hue-find" type="button">Find Bridge</button>
                <button class="secondary-button compact-button js-hue-pair" type="button">Pair</button>
                <button class="secondary-button compact-button js-hue-toggle" type="button">Turn Lights On</button>
                <button class="secondary-button compact-button js-hue-sync" type="button">Sync Scene</button>
              </div>
              <p class="js-hue-status micro-copy">Enter the Hue Bridge IP, press the bridge button, then Pair.</p>
            </section>

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
              <article class="status-card">
                <span class="status-label">Sound</span>
                <strong class="js-sound-status">Silent</strong>
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
              Use up to two color cards at once. Add one effect card and one sound card to stack motion and audio on top.
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
              <h2>Ten cards: color, effect, and sound</h2>
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

  // --- Query elements from inside element ---
  const q = <T extends Element>(sel: string): T => {
    const el = element.querySelector<T>(sel);
    if (!el) throw new Error(`Required element not found: ${sel}`);
    return el;
  };

  const sceneCanvas = q<HTMLCanvasElement>('.scene-canvas');
  const displayStage = q<HTMLElement>('.display-stage');
  const studioShell = q<HTMLElement>('.js-studio');
  // Start in display mode — studio hidden
  studioShell.style.display = 'none';
  const shell = q<HTMLDivElement>('.app-shell');
  const sceneTitle = q<HTMLHeadingElement>('.js-scene-title');
  const sceneTagline = q<HTMLParagraphElement>('.js-scene-tagline');
  const scannerStatus = q<HTMLElement>('.js-scanner-status');
  const colorStatus = q<HTMLElement>('.js-color-status');
  const effectStatus = q<HTMLElement>('.js-effect-status');
  const soundStatus = q<HTMLElement>('.js-sound-status');
  const dwellLabel = q<HTMLElement>('.js-dwell-label');
  const dwellAmount = q<HTMLElement>('.js-dwell-amount');
  const dwellFill = q<HTMLElement>('.js-dwell-fill');
  const lastCode = q<HTMLElement>('.js-last-code');
  const openStudioButton = q<HTMLButtonElement>('.js-open-studio');
  const backToDisplayButton = q<HTMLButtonElement>('.js-back-to-display');
  const startCameraButton = q<HTMLButtonElement>('.js-start-camera');
  const testAudioButton = q<HTMLButtonElement>('.js-test-audio');
  const printButton = q<HTMLButtonElement>('.js-print-cards');
  const printButtonInline = q<HTMLButtonElement>('.js-print-cards-inline');
  const hueBridgeInput = q<HTMLInputElement>('.js-hue-bridge-ip');
  const hueFindButton = q<HTMLButtonElement>('.js-hue-find');
  const huePairButton = q<HTMLButtonElement>('.js-hue-pair');
  const hueToggleButton = q<HTMLButtonElement>('.js-hue-toggle');
  const hueSyncButton = q<HTMLButtonElement>('.js-hue-sync');
  const hueStatus = q<HTMLElement>('.js-hue-status');
  const cameraSelect = q<HTMLSelectElement>('.js-camera-select');
  const video = q<HTMLVideoElement>('.js-camera');
  const overlay = q<HTMLDivElement>('.js-scanner-overlay');
  const cardGrid = q<HTMLDivElement>('.js-card-grid');

  const ctx = sceneCanvas.getContext('2d')!;

  // --- Mutable state ---
  let currentStream: MediaStream | null = null;
  let currentComposition = createComposition([], null, null);
  let compositionEnteredAt = performance.now();
  let cameraReady = false;
  let cameraStarting = false;
  let selectedCameraId: string | null = null;
  let multiDetector: MultiDetector | null = null;
  let scanLoopHandle = 0;
  let scanInFlight = false;
  let lastScanAt = 0;
  let currentVisibleCards: VisibleCard[] = [];
  let trackedCards = new Map<string, TrackedSceneCard>();
  let candidateCards = new Map<string, CandidateCard>();
  let nextTrackingId = 1;
  let audioContext: AudioContext | null = null;
  let activeSoundCleanup: (() => void) | null = null;
  let activeSoundId: SoundId | null = null;
  let hueUsername = '';
  let huePairedBridgeIp = '';
  let hueLightsOn = false;
  let hueSceneSync = false;
  let hueBusy = false;
  let hueLastSceneKey = '';
  let rafHandle = 0;
  let syncIntervalHandle = 0;
  let destroyed = false;

  // --- Hue settings via handle.doc / handle.change ---
  function loadHueSettings() {
    try {
      const doc = handle.doc() as ColorsDoc | undefined;
      const settings = doc?.hueConfig;
      if (settings) {
        hueBridgeInput.value = settings.bridgeIp ?? '';
        hueUsername = settings.username ?? '';
        huePairedBridgeIp = settings.bridgeIp ?? '';
        hueLightsOn = Boolean(settings.lightsOn);
        hueSceneSync = Boolean(settings.sceneSync);
      } else {
        hueBridgeInput.value = '';
        hueUsername = '';
        huePairedBridgeIp = '';
        hueLightsOn = false;
        hueSceneSync = false;
      }
    } catch {
      hueBridgeInput.value = '';
      hueUsername = '';
      huePairedBridgeIp = '';
      hueLightsOn = false;
      hueSceneSync = false;
    }
  }

  function saveHueSettings() {
    handle.change((doc: ColorsDoc) => {
      doc.hueConfig = {
        bridgeIp: getHueBridgeIp(),
        username: hueUsername,
        lightsOn: hueLightsOn,
        sceneSync: hueSceneSync,
      };
    });
  }

  function syncHueControls(message?: string) {
    const bridgeIp = getHueBridgeIp();
    hueFindButton.disabled = hueBusy;
    huePairButton.disabled = hueBusy || !bridgeIp;
    hueToggleButton.disabled = hueBusy || !bridgeIp || !hueUsername;
    hueSyncButton.disabled = hueBusy || !bridgeIp || !hueUsername;
    hueToggleButton.textContent = hueLightsOn ? 'Turn Lights Off' : 'Turn Lights On';
    hueSyncButton.textContent = hueSceneSync ? 'Unsync Scene' : 'Sync Scene';
    hueSyncButton.classList.toggle('is-active', hueSceneSync);

    if (message) {
      hueStatus.textContent = message;
    } else if (!bridgeIp) {
      hueStatus.textContent = 'Enter the Hue Bridge IP, press the bridge button, then Pair.';
    } else if (!hueUsername) {
      hueStatus.textContent = 'Press the physical Hue Bridge button, then click Pair.';
    } else if (hueSceneSync) {
      hueStatus.textContent = `Scene sync active: QR colors and effects are driving Hue at ${bridgeIp}.`;
    } else {
      hueStatus.textContent = `Paired with ${bridgeIp}. Toggle lights, or Sync Scene for QR-driven color/effects.`;
    }
  }

  async function findHueBridge() {
    hueBusy = true;
    syncHueControls('Looking for Hue bridges on this network...');
    let statusMessage = '';

    try {
      const ip = await findHueBridgeIp();
      if (!ip) {
        statusMessage = 'No Hue Bridge found. Check it is powered, connected to the router, and online.';
        return;
      }

      hueBridgeInput.value = ip;
      if (getHueBridgeIp() !== huePairedBridgeIp) {
        hueUsername = '';
      }
      saveHueSettings();
      statusMessage = `Found Hue Bridge at ${ip}. Press bridge button, then Pair.`;
    } catch {
      statusMessage = 'Bridge discovery failed. You can still type the bridge IP from the Hue app or router.';
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
      const username = await pairHue(bridgeIp, 'qr_scene_machine#browser');
      if (username) {
        hueUsername = username;
        huePairedBridgeIp = bridgeIp;
        saveHueSettings();
        statusMessage = 'Paired. Try Turn Lights On.';
        return;
      }
      statusMessage = 'Pair failed: unexpected bridge response.';
    } catch (err) {
      statusMessage = err instanceof Error
        ? `Pair failed: ${err.message}`
        : 'Pair failed. Check bridge IP and that this page is on the same network.';
    } finally {
      hueBusy = false;
      syncHueControls(statusMessage || undefined);
    }
  }

  async function toggleHueLights() {
    const bridgeIp = getHueBridgeIp();
    if (!bridgeIp || !hueUsername) {
      syncHueControls('Pair the Hue Bridge first.');
      return;
    }

    const nextOn = !hueLightsOn;
    hueBusy = true;
    syncHueControls(nextOn ? 'Turning Hue lights on...' : 'Turning Hue lights off...');
    let statusMessage = '';

    try {
      await sendHueAction(bridgeIp, hueUsername, { on: nextOn });
      hueLightsOn = nextOn;
      saveHueSettings();
      statusMessage = nextOn ? 'Hue lights are on.' : 'Hue lights are off.';
    } catch (err) {
      statusMessage = err instanceof Error
        ? `Hue error: ${err.message}`
        : 'Hue request failed. Check bridge IP and browser network permissions.';
    } finally {
      hueBusy = false;
      syncHueControls(statusMessage || undefined);
    }
  }

  async function toggleHueSceneSync() {
    if (!hueUsername || !getHueBridgeIp()) {
      syncHueControls('Pair the Hue Bridge first.');
      return;
    }

    hueSceneSync = !hueSceneSync;
    hueLightsOn = hueSceneSync ? true : hueLightsOn;
    saveHueSettings();
    syncHueControls(hueSceneSync ? 'Scene sync enabled.' : 'Scene sync paused.');

    if (hueSceneSync) {
      await applyHueComposition(currentComposition, true);
    }
  }

  async function applyHueComposition(composition: ActiveComposition, force = false) {
    if (!hueSceneSync || !hueUsername || !getHueBridgeIp()) {
      return;
    }

    if (!force && composition.key === hueLastSceneKey) {
      return;
    }

    hueLastSceneKey = composition.key;
    const action = createHueColorAction(composition, force ? 2 : 3);
    await doSendHueAction(action);
  }

  function createHueColorAction(composition: ActiveComposition, transitiontime: number): HueAction {
    const mix = hslForComposition(composition);
    return {
      on: true,
      hue: hueToHueBridge(mix.h),
      sat: percentToHueSat(composition.colors.length ? clamp(mix.s + 22, 55, 100) : mix.s),
      bri: percentToHueBrightness(composition.colors.length ? clamp(mix.l + 42, 62, 100) : 54),
      transitiontime,
    };
  }

  async function doSendHueAction(action: HueAction) {
    const bridgeIp = getHueBridgeIp();
    if (!bridgeIp || !hueUsername) {
      return;
    }

    try {
      await sendHueAction(bridgeIp, hueUsername, action);

      if (action.on !== undefined) {
        hueLightsOn = action.on;
        saveHueSettings();
        syncHueControls(hueSceneSync ? `Hue target: ${formatColorMix(currentComposition.colors) || 'Idle'}.` : undefined);
      }
    } catch {
      hueSceneSync = false;
      syncHueControls('Hue sync stopped: bridge request failed.');
      saveHueSettings();
    }
  }

  function hslForComposition(composition: ActiveComposition): Hsl {
    if (!composition.colors.length) {
      return { h: 190, s: 40, l: 48 };
    }

    return mixHsl(composition.colors.map((colorId) => COLOR_LIBRARY[colorId].hsl));
  }

  function getHueBridgeIp() {
    return hueBridgeInput.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }

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
    if (cameraStarting) {
      return;
    }

    cameraStarting = true;
    startCameraButton.disabled = true;
    startCameraButton.textContent = cameraReady ? 'Switching...' : 'Starting...';
    scannerStatus.textContent = cameraReady ? 'Switching camera' : 'Requesting permission';

    try {
      audioContext = audioContext ?? await ensureAudioContext();
      stopDetectionLoop();
      stopCurrentStream();
      candidateCards.clear();
      trackedCards.clear();
      nextTrackingId = 1;
      currentVisibleCards = [];
      renderOverlay([]);

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
      multiDetector = createWasmDetector();

      await populateCameraSelect();
      startDetectionLoop();

      scannerStatus.textContent = 'Watching for cards';
      startCameraButton.textContent = 'Webcam + Audio Ready';
      lastCode.textContent = 'No supported cards visible';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      cameraReady = false;
      scannerStatus.textContent = 'Camera failed';
      lastCode.textContent = message;
      startCameraButton.textContent = 'Retry Webcam + Audio';
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
    if (!cameraReady || destroyed) {
      return;
    }

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
      const cards = await detectVisibleCards();
      handleVisibleCards(cards);
    } catch {
      handleVisibleCards([]);
    } finally {
      scanInFlight = false;
      if (cameraReady && !destroyed) {
        scanLoopHandle = window.requestAnimationFrame(scanFrame);
      }
    }
  }

  async function detectVisibleCards() {
    if (!multiDetector) {
      return [];
    }

    const detections = await multiDetector.detect(video);
    return detections
      .map((detection) => toVisibleCard(detection.rawValue, detection.cornerPoints ?? []))
      .filter((card): card is VisibleCard => Boolean(card));
  }

  function handleVisibleCards(cards: VisibleCard[]) {
    const now = performance.now();
    pruneStaleCandidates(now);

    currentVisibleCards = updateTrackedCards(cards, now);
    renderOverlay(currentVisibleCards);

    for (const card of currentVisibleCards) {
      const sourceLastSeenAt = trackedCards.get(card.trackingId)?.lastSeenAt ?? now;
      const existing = candidateCards.get(card.trackingId);
      if (existing) {
        existing.lastSeenAt = sourceLastSeenAt;
        existing.lastArea = card.area;
        existing.x = card.x;
        existing.y = card.y;
      } else {
        candidateCards.set(card.trackingId, {
          trackingId: card.trackingId,
          card: card.card,
          firstSeenAt: now,
          lastSeenAt: sourceLastSeenAt,
          lastArea: card.area,
          x: card.x,
          y: card.y,
        });
      }
    }

    pruneStaleCandidates(now);

    const activeCards = [...candidateCards.values()].filter(
      (candidate) => now - candidate.firstSeenAt >= DWELL_MS,
    );
    const nextComposition = resolveComposition(activeCards);

    lastCode.textContent = currentVisibleCards.length
      ? currentVisibleCards.map((card) => formatVisibleLabel(card.card)).join(' \u2022 ')
      : 'No supported cards visible';

    if (nextComposition.key !== currentComposition.key) {
      applyComposition(nextComposition);
    }
  }

  function updateTrackedCards(detectedCards: VisibleCard[], now: number) {
    const matchedTrackedIds = new Set<string>();
    const matchDistance = Math.max(video.videoWidth, video.videoHeight) * TRACK_MATCH_DISTANCE_RATIO;

    for (const detectedCard of detectedCards.sort((left, right) => right.area - left.area)) {
      const match = findMatchingTrackedCard(detectedCard, matchedTrackedIds, matchDistance);
      const id = match?.id ?? `scene-card-${nextTrackingId}`;
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
      if (matchedTrackedIds.has(id)) {
        continue;
      }

      if (now - tracked.lastSeenAt > CARD_TTL_MS) {
        trackedCards.delete(id);
      }
    }

    return [...trackedCards.values()]
      .map((tracked) => tracked.card)
      .sort((left, right) => right.area - left.area);
  }

  function findMatchingTrackedCard(card: VisibleCard, usedIds: Set<string>, maxDistance: number) {
    let bestMatch: TrackedSceneCard | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const tracked of trackedCards.values()) {
      if (usedIds.has(tracked.id) || tracked.card.card.payload !== card.card.payload) {
        continue;
      }

      const distance = Math.hypot(tracked.card.x - card.x, tracked.card.y - card.y);
      if (distance < maxDistance && distance < bestDistance) {
        bestMatch = tracked;
        bestDistance = distance;
      }
    }

    return bestMatch;
  }

  function smoothVisibleCard(previous: VisibleCard, next: VisibleCard) {
    const positionBlend = 0.76;
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
      x,
      y,
      cornerPoints,
      area: previous.area + (next.area - previous.area) * positionBlend,
    } satisfies VisibleCard;
  }

  function pruneStaleCandidates(now: number) {
    for (const [id, candidate] of candidateCards) {
      if (now - candidate.lastSeenAt > CARD_TTL_MS) {
        candidateCards.delete(id);
      }
    }
  }

  function resolveComposition(activeCandidates: CandidateCard[]) {
    const activeColors = activeCandidates
      .filter((candidate) => candidate.card.category === 'color')
      .sort((left, right) => left.x - right.x)
      .map((candidate) => candidate.card.id as ColorId);

    const activeEffect = activeCandidates
      .filter((candidate) => candidate.card.category === 'fx')
      .sort((left, right) => right.lastArea - left.lastArea)[0]?.card.id as EffectId | undefined;

    const activeSound = activeCandidates
      .filter((candidate) => candidate.card.category === 'sound')
      .sort((left, right) => right.lastArea - left.lastArea)[0]?.card.id as SoundId | undefined;

    return createComposition(activeColors, activeEffect ?? null, activeSound ?? null);
  }

  function createComposition(colors: ColorId[], effect: EffectId | null, sound: SoundId | null): ActiveComposition {
    const palette = resolvePalette(colors);
    const title = colors.length
      ? formatColorMix(colors)
      : 'Idle Field';

    const colorPhrase = colors.length
      ? `${colors.length === 2 ? 'Dual-color blend' : 'Single-color palette'} in ${palette.name.toLowerCase()}.`
      : 'Neutral idle palette waiting for cards.';

    const effectPhrase = effect
      ? `${EFFECT_LIBRARY[effect].label} effect is active.`
      : 'No effect layer active.';

    const soundPhrase = sound
      ? `${SOUND_LIBRARY[sound].label} sound bed is active.`
      : 'No sound layer active.';

    return {
      colors,
      effect,
      sound,
      palette,
      title,
      tagline: `${colorPhrase} ${effectPhrase} ${soundPhrase}`,
      key: `colors:${colors.join('+') || 'idle'}|fx:${effect ?? 'none'}|sound:${sound ?? 'none'}`,
    };
  }

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
    soundStatus.textContent = composition.sound ? SOUND_LIBRARY[composition.sound].label : 'Silent';

    updateSoundLayer(composition.sound);
    void applyHueComposition(composition);

    // Persist to doc so other peers see the change
    if (!fromRemote) {
      handle.change((doc: ColorsDoc) => {
        doc.activeColors = composition.colors;
        doc.activeEffect = composition.effect;
        doc.activeSound = composition.sound;
      });
    }
  }

  // Listen for remote doc changes (other peer scanning cards)
  function onDocChange() {
    const doc = handle.doc() as ColorsDoc | undefined;
    if (!doc) return;
    const remoteColors = (doc.activeColors ?? []) as ColorId[];
    const remoteEffect = (doc.activeEffect ?? null) as EffectId | null;
    const remoteSound = (doc.activeSound ?? null) as SoundId | null;
    const remoteComposition = createComposition(remoteColors, remoteEffect, remoteSound);
    if (remoteComposition.key !== currentComposition.key) {
      applyComposition(remoteComposition, true);
    }
  }
  handle.on("change", onDocChange);

  function syncScannerState() {
    if (destroyed) return;
    const now = performance.now();
    pruneStaleCandidates(now);

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
      dwellLabel.textContent = 'Use up to two color cards, one effect card, and one sound card.';
      dwellAmount.textContent = candidates.length ? `${candidates.length} active` : '0%';
      dwellFill.style.transform = 'scaleX(0)';
    }

    scannerStatus.textContent = currentVisibleCards.length
      ? `${currentVisibleCards.length} held`
      : 'Watching for cards';
  }

  // --- Canvas rendering ---
  function resizeCanvas() {
    if (destroyed) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = element.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    sceneCanvas.width = Math.floor(width * dpr);
    sceneCanvas.height = Math.floor(height * dpr);
    sceneCanvas.style.width = `${width}px`;
    sceneCanvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function renderScene(timestamp: number) {
    if (destroyed) return;
    const rect = element.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const time = timestamp * 0.001;
    const palette = currentComposition.palette;

    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, palette.background[0]);
    gradient.addColorStop(0.5, palette.background[1]);
    gradient.addColorStop(1, palette.background[2]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    drawAmbientHalo(width, height, time, palette);

    if (currentComposition.effect === 'ripple') {
      drawRippleEffect(width, height, time, palette);
    } else if (currentComposition.effect === 'grid') {
      drawGridEffect(width, height, time, palette);
    } else if (currentComposition.effect === 'grain') {
      drawGrainEffect(width, height, time, palette);
    } else {
      drawIdleDrift(width, height, time, palette);
    }

    drawDisplayVignette(width, height, palette);
    drawSceneFlash(width, height, time, palette);
    rafHandle = window.requestAnimationFrame(renderScene);
  }

  function drawAmbientHalo(width: number, height: number, time: number, palette: Palette) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let index = 0; index < 3; index += 1) {
      const radius = Math.max(width, height) * (0.18 + index * 0.12);
      const x = width * (0.22 + index * 0.24) + Math.sin(time * 0.2 + index) * 80;
      const y = height * (0.25 + index * 0.2) + Math.cos(time * 0.16 + index * 1.7) * 60;
      const alpha = 0.1 + index * 0.04;
      const radial = ctx.createRadialGradient(x, y, 0, x, y, radius);
      radial.addColorStop(0, withAlpha(palette.accent, alpha));
      radial.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = radial;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawIdleDrift(width: number, height: number, time: number, palette: Palette) {
    ctx.save();
    ctx.globalAlpha = 0.24;
    for (let index = 0; index < 11; index += 1) {
      const radius = 32 + (index % 4) * 28;
      const x = width * (0.08 + index * 0.09) + Math.sin(time * 0.55 + index) * 34;
      const y = height * (0.18 + (index % 5) * 0.14) + Math.cos(time * 0.42 + index) * 36;
      ctx.fillStyle = withAlpha(palette.accent, 0.12 + (index % 3) * 0.05);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawRippleEffect(width: number, height: number, time: number, palette: Palette) {
    const centerX = width * (0.5 + Math.sin(time * 0.22) * 0.12);
    const centerY = height * (0.48 + Math.cos(time * 0.18) * 0.08);
    const secondaryX = width * (0.28 + Math.cos(time * 0.31) * 0.09);
    const secondaryY = height * (0.72 + Math.sin(time * 0.28) * 0.08);
    const diagonal = Math.hypot(width, height);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const mainPool = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, diagonal * 0.58);
    mainPool.addColorStop(0, withAlpha('#ffffff', 0.1));
    mainPool.addColorStop(0.18, withAlpha(palette.accent, 0.18));
    mainPool.addColorStop(0.55, withAlpha(palette.background[2], 0.12));
    mainPool.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = mainPool;
    ctx.fillRect(0, 0, width, height);

    const secondaryPool = ctx.createRadialGradient(secondaryX, secondaryY, 0, secondaryX, secondaryY, diagonal * 0.46);
    secondaryPool.addColorStop(0, withAlpha(palette.background[2], 0.12));
    secondaryPool.addColorStop(0.32, withAlpha(palette.accent, 0.11));
    secondaryPool.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = secondaryPool;
    ctx.fillRect(0, 0, width, height);

    for (let band = 0; band < 28; band += 1) {
      const baseY = (band / 27) * height;
      const amplitude = 18 + (band % 6) * 8;
      const turbulence = 10 + (band % 5) * 6;
      ctx.lineWidth = 1.6 + (band % 4) * 1.15;
      ctx.globalAlpha = 0.1 + (band % 7) * 0.02;
      ctx.strokeStyle = band % 5 === 0
        ? withAlpha('#ffffff', 0.22)
        : band % 2 === 0
          ? withAlpha(palette.accent, 0.34)
          : withAlpha(palette.background[2], 0.28);
      ctx.beginPath();
      for (let x = -24; x <= width + 24; x += 18) {
        const dxPrimary = x - centerX;
        const dxSecondary = x - secondaryX;
        const waveA = Math.sin(time * 2.6 + x * 0.011 + band * 0.28) * amplitude;
        const waveB = Math.cos(time * 1.6 + x * 0.021 + band * 0.42) * turbulence;
        const primaryPull = Math.sin((Math.hypot(dxPrimary, baseY - centerY) * 0.018) - time * 4.8) * 18;
        const secondaryPull = Math.cos((Math.hypot(dxSecondary, baseY - secondaryY) * 0.015) - time * 3.6) * 12;
        const y = baseY + waveA + waveB + primaryPull + secondaryPull;
        if (x === -24) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    for (let ring = 0; ring < 24; ring += 1) {
      const progress = ((time * 0.9) + ring / 24) % 1;
      const radius = 48 + progress * diagonal * 0.62;
      ctx.lineWidth = 10 - progress * 7.5;
      ctx.globalAlpha = (1 - progress) * 0.42;
      ctx.strokeStyle = ring % 4 === 0
        ? withAlpha('#ffffff', 0.26)
        : withAlpha(palette.accent, 0.32);
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (let ring = 0; ring < 16; ring += 1) {
      const progress = ((time * 0.65) + ring / 16) % 1;
      const radius = 30 + progress * diagonal * 0.4;
      ctx.lineWidth = 7 - progress * 5.5;
      ctx.globalAlpha = (1 - progress) * 0.26;
      ctx.strokeStyle = withAlpha(palette.background[2], 0.28);
      ctx.beginPath();
      ctx.arc(secondaryX, secondaryY, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (let beam = 0; beam < 18; beam += 1) {
      const angle = time * 0.3 + beam * 0.34;
      const radius = 180 + (beam % 6) * 48;
      const startX = centerX + Math.cos(angle) * radius;
      const startY = centerY + Math.sin(angle * 1.18) * radius * 0.66;
      const controlX = width * (0.5 + Math.sin(angle * 1.7) * 0.28);
      const controlY = height * (0.5 + Math.cos(angle * 1.4) * 0.24);
      const endX = centerX + Math.cos(angle + 0.6) * (diagonal * 0.36);
      const endY = centerY + Math.sin(angle + 0.6) * (diagonal * 0.22);
      ctx.globalAlpha = 0.11 + (beam % 4) * 0.02;
      ctx.lineWidth = 2.8 + (beam % 3) * 1.1;
      ctx.strokeStyle = beam % 3 === 0
        ? withAlpha('#ffffff', 0.18)
        : withAlpha(palette.accent, 0.24);
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.quadraticCurveTo(controlX, controlY, endX, endY);
      ctx.stroke();
    }

    for (let flare = 0; flare < 7; flare += 1) {
      const angle = time * 0.8 + flare * 0.92;
      const orbit = 140 + flare * 64 + Math.sin(time * 1.6 + flare) * 24;
      const flareX = centerX + Math.cos(angle) * orbit;
      const flareY = centerY + Math.sin(angle * 1.3) * orbit * 0.55;
      const radial = ctx.createRadialGradient(flareX, flareY, 0, flareX, flareY, 80 + flare * 18);
      radial.addColorStop(0, withAlpha('#ffffff', 0.18));
      radial.addColorStop(0.25, withAlpha(palette.accent, 0.2));
      radial.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = radial;
      ctx.beginPath();
      ctx.arc(flareX, flareY, 80 + flare * 18, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawGridEffect(width: number, height: number, time: number, palette: Palette) {
    const horizon = height * 0.28 + Math.sin(time * 0.35) * height * 0.03;
    const vanishingX = width * (0.5 + Math.sin(time * 0.42) * 0.07);
    const vanishingY = horizon + Math.cos(time * 0.7) * 14;
    const tunnelHeight = height * 0.66;

    ctx.save();
    const skyGlow = ctx.createRadialGradient(vanishingX, vanishingY, 0, vanishingX, vanishingY, Math.max(width, height) * 0.6);
    skyGlow.addColorStop(0, withAlpha(palette.accent, 0.18));
    skyGlow.addColorStop(0.28, withAlpha('#ffffff', 0.08));
    skyGlow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = skyGlow;
    ctx.fillRect(0, 0, width, height);

    const floorGlow = ctx.createLinearGradient(0, horizon, 0, height);
    floorGlow.addColorStop(0, withAlpha(palette.background[0], 0));
    floorGlow.addColorStop(0.15, withAlpha(palette.accent, 0.16));
    floorGlow.addColorStop(1, withAlpha(palette.background[0], 0.34));
    ctx.fillStyle = floorGlow;
    ctx.fillRect(0, horizon, width, height - horizon);

    ctx.globalCompositeOperation = 'screen';
    for (let rail = -28; rail <= 28; rail += 1) {
      const x = width * 0.5 + rail * width * 0.038;
      const wobble = Math.sin(time * 0.95 + rail * 0.33) * 22;
      ctx.lineWidth = rail % 6 === 0 ? 3.2 : 1.25;
      ctx.strokeStyle = rail % 5 === 0
        ? withAlpha('#ffffff', 0.24)
        : withAlpha(palette.accent, 0.28);
      ctx.beginPath();
      ctx.moveTo(x, height);
      ctx.lineTo(vanishingX + wobble, vanishingY);
      ctx.stroke();
    }

    for (let row = 1; row <= 30; row += 1) {
      const depth = row / 30;
      const y = horizon + Math.pow(depth, 1.68) * (height - horizon);
      const span = width * (0.045 + depth * 1.02);
      const bend = Math.sin(time * 1.15 + row * 0.34) * (2 + depth * 12);
      ctx.lineWidth = row % 4 === 0 ? 2.2 : 1;
      ctx.strokeStyle = row % 3 === 0
        ? withAlpha('#ffffff', 0.2)
        : withAlpha(palette.background[2], 0.22);
      ctx.beginPath();
      ctx.moveTo(vanishingX - span, y + bend);
      ctx.lineTo(vanishingX + span, y - bend);
      ctx.stroke();
    }

    for (let frame = 0; frame < 12; frame += 1) {
      const progress = ((time * 0.17) + frame / 12) % 1;
      const depth = Math.pow(progress, 1.9);
      const halfWidth = width * (0.04 + depth * 0.42);
      const halfHeight = tunnelHeight * (0.03 + depth * 0.24);
      const offsetX = Math.sin(time * 0.9 + frame * 0.8) * (6 + depth * 12);
      const offsetY = Math.cos(time * 0.7 + frame * 0.5) * (3 + depth * 7);
      ctx.lineWidth = 5 - depth * 3.2;
      ctx.strokeStyle = frame % 4 === 0
        ? withAlpha('#ffffff', 0.18 + (1 - depth) * 0.18)
        : withAlpha(palette.accent, 0.22 + (1 - depth) * 0.16);
      ctx.beginPath();
      ctx.moveTo(vanishingX + offsetX - halfWidth, vanishingY + offsetY - halfHeight);
      ctx.lineTo(vanishingX + offsetX + halfWidth, vanishingY + offsetY - halfHeight);
      ctx.lineTo(vanishingX + offsetX + halfWidth * 1.08, vanishingY + offsetY + halfHeight);
      ctx.lineTo(vanishingX + offsetX - halfWidth * 1.08, vanishingY + offsetY + halfHeight);
      ctx.closePath();
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(vanishingX, vanishingY + 22);
    ctx.rotate(time * 0.22);
    for (let ring = 0; ring < 5; ring += 1) {
      const radius = 28 + ring * 20 + Math.sin(time * 1.8 + ring) * 6;
      ctx.lineWidth = 4 - ring * 0.45;
      ctx.strokeStyle = ring % 2 === 0
        ? withAlpha('#ffffff', 0.32)
        : withAlpha(palette.accent, 0.28);
      ctx.beginPath();
      for (let side = 0; side < 6; side += 1) {
        const angle = (Math.PI * 2 * side) / 6;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius * 0.8;
        if (side === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();

    for (let streak = 0; streak < 68; streak += 1) {
      const progress = ((time * 0.28) + streak * 0.019) % 1;
      const distance = Math.pow(progress, 2.2) * width * 0.9;
      const angle = streak * 2.399963 + Math.sin(streak) * 0.12;
      const startX = vanishingX + Math.cos(angle) * distance * 0.14;
      const startY = vanishingY + Math.sin(angle) * distance * 0.08;
      const endX = vanishingX + Math.cos(angle) * distance;
      const endY = vanishingY + Math.sin(angle) * distance * 0.58;
      ctx.lineWidth = 0.8 + progress * 2.2;
      ctx.strokeStyle = streak % 6 === 0
        ? withAlpha('#ffffff', 0.22)
        : withAlpha(palette.accent, 0.2 + progress * 0.18);
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }

    const sweepY = horizon + ((time * 310) % (height - horizon + 160)) - 80;
    const sweep = ctx.createLinearGradient(0, sweepY, 0, sweepY + 18);
    sweep.addColorStop(0, 'rgba(255,255,255,0)');
    sweep.addColorStop(0.5, withAlpha('#ffffff', 0.22));
    sweep.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sweep;
    ctx.fillRect(0, sweepY, width, 18);
    ctx.restore();
  }

  function drawGrainEffect(width: number, height: number, time: number, palette: Palette) {
    const centerX = width * (0.5 + Math.sin(time * 0.16) * 0.06);
    const centerY = height * (0.48 + Math.cos(time * 0.13) * 0.05);
    const maxRadius = Math.max(width, height) * 0.62;

    ctx.save();
    const cloud = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxRadius);
    cloud.addColorStop(0, withAlpha('#ffffff', 0.1));
    cloud.addColorStop(0.18, withAlpha(palette.accent, 0.2));
    cloud.addColorStop(0.46, withAlpha(palette.background[2], 0.14));
    cloud.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cloud;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = 'screen';
    for (let arm = 0; arm < 5; arm += 1) {
      ctx.beginPath();
      for (let step = 0; step <= 110; step += 1) {
        const progress = step / 110;
        const angle = time * 0.35 + arm * 1.256 + progress * 9.8;
        const radius = 24 + progress * maxRadius * 0.74;
        const wobble = Math.sin(time * 1.6 + step * 0.09 + arm) * 12;
        const x = centerX + Math.cos(angle) * (radius + wobble);
        const y = centerY + Math.sin(angle) * (radius * 0.58 + wobble * 0.36);
        if (step === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.lineWidth = 1.2 + arm * 0.45;
      ctx.strokeStyle = arm % 2 === 0
        ? withAlpha(palette.accent, 0.18)
        : withAlpha(palette.background[2], 0.16);
      ctx.stroke();
    }

    for (let index = 0; index < 260; index += 1) {
      const depth = (index % 13) / 12;
      const orbit = 26 + depth * maxRadius * 0.82 + Math.sin(time * 0.9 + index) * 18;
      const angle = time * (0.18 + depth * 0.46) + index * 0.49;
      const x = centerX + Math.cos(angle) * orbit;
      const y = centerY + Math.sin(angle * 1.18) * orbit * 0.56;
      const size = 0.8 + depth * 4.6;
      const alpha = 0.05 + depth * 0.25;
      ctx.fillStyle = index % 9 === 0
        ? withAlpha('#ffffff', alpha + 0.12)
        : index % 4 === 0
          ? withAlpha(palette.background[2], alpha)
          : withAlpha(palette.accent, alpha);
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let streak = 0; streak < 42; streak += 1) {
      const progress = ((time * 0.22) + streak * 0.031) % 1;
      const angle = streak * 1.37 + Math.sin(streak * 0.7) * 0.4;
      const inner = 24 + progress * maxRadius * 0.24;
      const outer = inner + 90 + (streak % 5) * 24;
      const x1 = centerX + Math.cos(angle) * inner;
      const y1 = centerY + Math.sin(angle) * inner * 0.58;
      const x2 = centerX + Math.cos(angle) * outer;
      const y2 = centerY + Math.sin(angle) * outer * 0.58;
      ctx.lineWidth = 1 + progress * 3;
      ctx.strokeStyle = streak % 5 === 0
        ? withAlpha('#ffffff', 0.2 + progress * 0.1)
        : withAlpha(palette.accent, 0.18 + progress * 0.16);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    for (let shard = 0; shard < 18; shard += 1) {
      ctx.save();
      const angle = time * 0.2 + shard * 0.37;
      const distance = 120 + (shard % 6) * 44 + Math.sin(time * 1.4 + shard) * 28;
      const x = centerX + Math.cos(angle) * distance;
      const y = centerY + Math.sin(angle * 1.22) * distance * 0.62;
      ctx.translate(x, y);
      ctx.rotate(angle + time * 0.6);
      ctx.fillStyle = shard % 3 === 0
        ? withAlpha('#ffffff', 0.14)
        : shard % 2 === 0
          ? withAlpha(palette.background[2], 0.12)
          : withAlpha(palette.accent, 0.12);
      ctx.beginPath();
      ctx.moveTo(-24, -10);
      ctx.lineTo(32, 0);
      ctx.lineTo(-18, 10);
      ctx.lineTo(-6, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawDisplayVignette(width: number, height: number, palette: Palette) {
    ctx.save();
    const vignette = ctx.createRadialGradient(width * 0.5, height * 0.48, Math.min(width, height) * 0.12, width * 0.5, height * 0.5, Math.max(width, height) * 0.72);
    vignette.addColorStop(0, 'rgba(255,255,255,0)');
    vignette.addColorStop(0.58, 'rgba(255,255,255,0)');
    vignette.addColorStop(1, 'rgba(2, 6, 12, 0.46)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = 'screen';
    const edgeGlow = ctx.createLinearGradient(0, 0, width, 0);
    edgeGlow.addColorStop(0, withAlpha(palette.accent, 0.06));
    edgeGlow.addColorStop(0.5, 'rgba(255,255,255,0)');
    edgeGlow.addColorStop(1, withAlpha(palette.background[2], 0.07));
    ctx.fillStyle = edgeGlow;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  function drawSceneFlash(width: number, height: number, time: number, palette: Palette) {
    const elapsed = time - compositionEnteredAt * 0.001;
    if (elapsed > 0.8) {
      return;
    }

    const alpha = Math.max(0, 0.32 - elapsed * 0.38);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = withAlpha('#ffffff', alpha);
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = withAlpha(palette.accent, alpha * 0.58);
    ctx.beginPath();
    ctx.arc(width * 0.52, height * 0.48, 140 + elapsed * 340, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // --- Overlay rendering ---
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
      if (card.cornerPoints.length < 4) {
        return '';
      }

      const tracked = trackedCards.get(card.trackingId);
      const held = tracked ? now - tracked.lastSeenAt > 260 : false;
      const projected = card.cornerPoints.map((point) => projectPoint(point, geometry));
      const points = projected.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
      const centroid = projected.reduce(
        (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
        { x: 0, y: 0 },
      );
      const labelX = centroid.x / projected.length;
      const labelY = centroid.y / projected.length - 10;

      return `
        <g>
          <polygon class="qr-outline ${held ? 'held' : 'fresh'}" fill="${withAlpha(card.card.accent, held ? 0.08 : 0.16)}" stroke="${card.card.accent}" points="${points}"></polygon>
          <text class="qr-label" x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle">
            ${escapeHtml(card.card.label)}
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

  // --- QR card helpers ---
  function toVisibleCard(rawValue: string | undefined, cornerPoints: Point[]) {
    if (!rawValue) {
      return null;
    }

    const payload = normalizePayload(rawValue);
    if (!payload) {
      return null;
    }

    const card = CARD_LIBRARY.get(payload);
    if (!card) {
      return null;
    }

    const centroid = cornerPoints.reduce(
      (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
      { x: 0, y: 0 },
    );
    const x = centroid.x / Math.max(1, cornerPoints.length);
    const y = centroid.y / Math.max(1, cornerPoints.length);

    return {
      trackingId: '',
      card,
      rawValue,
      cornerPoints,
      x,
      y,
      area: polygonArea(cornerPoints),
    } satisfies VisibleCard;
  }

  function normalizePayload(rawValue: string) {
    const trimmed = rawValue.trim().toLowerCase();

    if (CARD_LIBRARY.has(trimmed as CardPayload)) {
      return trimmed as CardPayload;
    }

    if (trimmed === 'scene:red') {
      return 'color:red';
    }

    if (trimmed === 'scene:blue') {
      return 'color:blue';
    }

    return null;
  }

  // --- Color / palette helpers ---
  function formatColorMix(colors: ColorId[]) {
    const counts = new Map<ColorId, number>();
    for (const color of colors) {
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }

    return COLOR_ORDER
      .filter((color) => counts.has(color))
      .map((color) => {
        const count = counts.get(color) ?? 0;
        return count > 1
          ? `${COLOR_LIBRARY[color].label} x${count}`
          : COLOR_LIBRARY[color].label;
      })
      .join(' + ');
  }

  function resolvePalette(colors: ColorId[]) {
    if (!colors.length) {
      return IDLE_PALETTE;
    }

    const colorDefinitions = colors.map((colorId) => COLOR_LIBRARY[colorId]);
    const mix = mixHsl(colorDefinitions.map((definition) => definition.hsl));

    if (colors.length === 1) {
      const base = colorDefinitions[0].hsl;
      const accent = hslToHex(base.h, clamp(base.s + 4, 0, 100), clamp(base.l + 2, 0, 100));
      const isBright = base.l > 58 || (base.h > 40 && base.h < 80);

      return {
        name: COLOR_LIBRARY[colors[0]].label,
        accent,
        glow: hslaString(base.h, clamp(base.s + 12, 0, 100), clamp(base.l + 10, 0, 100), 0.42),
        background: [
          hslToHex(base.h, clamp(base.s - 4, 0, 100), clamp(base.l - 34, 0, 100)),
          hslToHex(base.h, clamp(base.s + 2, 0, 100), clamp(base.l - 10, 0, 100)),
          hslToHex(base.h, clamp(base.s - 12, 0, 100), clamp(base.l + 24, 0, 100)),
        ] as [string, string, string],
        panel: isBright
          ? hslaString(base.h, clamp(base.s * 0.36, 12, 70), 96, 0.76)
          : hslaString(base.h, clamp(base.s * 0.6, 20, 82), 11, 0.72),
        text: isBright ? '#14211c' : '#eff7ff',
      } satisfies Palette;
    }

    const left = colorDefinitions[0].hsl;
    const right = colorDefinitions[1].hsl;
    const accent = hslToHex(mix.h, clamp(mix.s + 6, 0, 100), clamp(mix.l + 4, 0, 100));
    const isBright = mix.l > 60 || (mix.h > 40 && mix.h < 120);

    return {
      name: colors.map((colorId) => COLOR_LIBRARY[colorId].label).join(' + '),
      accent,
      glow: hslaString(mix.h, clamp(mix.s + 12, 0, 100), clamp(mix.l + 10, 0, 100), 0.44),
      background: [
        hslToHex(left.h, clamp(left.s - 10, 0, 100), clamp(left.l - 34, 0, 100)),
        hslToHex(mix.h, clamp(mix.s + 2, 0, 100), clamp(mix.l - 4, 0, 100)),
        hslToHex(right.h, clamp(right.s - 14, 0, 100), clamp(right.l + 12, 0, 100)),
      ] as [string, string, string],
      panel: isBright
        ? hslaString(mix.h, clamp(mix.s * 0.32, 12, 70), 96, 0.76)
        : hslaString(mix.h, clamp(mix.s * 0.56, 20, 84), 12, 0.72),
      text: isBright ? '#152117' : '#f4fbff',
    } satisfies Palette;
  }

  function mixHsl(colors: Hsl[]) {
    const total = colors.length;
    const unitVectors = colors.reduce(
      (sum, color) => {
        const radians = (color.h * Math.PI) / 180;
        return {
          x: sum.x + Math.cos(radians),
          y: sum.y + Math.sin(radians),
        };
      },
      { x: 0, y: 0 },
    );

    const averageHue = ((Math.atan2(unitVectors.y, unitVectors.x) * 180) / Math.PI + 360) % 360;
    const averageSaturation = colors.reduce((sum, color) => sum + color.s, 0) / total;
    const averageLightness = colors.reduce((sum, color) => sum + color.l, 0) / total;

    return {
      h: averageHue,
      s: averageSaturation,
      l: averageLightness,
    } satisfies Hsl;
  }

  function hslToHex(hue: number, saturation: number, lightness: number) {
    const h = ((hue % 360) + 360) % 360;
    const s = clamp(saturation, 0, 100) / 100;
    const l = clamp(lightness, 0, 100) / 100;
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const segment = h / 60;
    const second = chroma * (1 - Math.abs((segment % 2) - 1));
    const match = l - chroma / 2;

    let red = 0;
    let green = 0;
    let blue = 0;

    if (segment >= 0 && segment < 1) {
      red = chroma;
      green = second;
    } else if (segment < 2) {
      red = second;
      green = chroma;
    } else if (segment < 3) {
      green = chroma;
      blue = second;
    } else if (segment < 4) {
      green = second;
      blue = chroma;
    } else if (segment < 5) {
      red = second;
      blue = chroma;
    } else {
      red = chroma;
      blue = second;
    }

    return `#${[red, green, blue]
      .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, '0'))
      .join('')}`;
  }

  function hslaString(hue: number, saturation: number, lightness: number, alpha: number) {
    return `hsla(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%, ${alpha})`;
  }

  function withAlpha(hexColor: string, alpha: number) {
    const safeHex = hexColor.replace('#', '');
    const value = safeHex.length === 3
      ? safeHex.split('').map((character) => character + character).join('')
      : safeHex;

    const red = Number.parseInt(value.slice(0, 2), 16);
    const green = Number.parseInt(value.slice(2, 4), 16);
    const blue = Number.parseInt(value.slice(4, 6), 16);

    return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, alpha))})`;
  }

  function categoryLabel(category: CardCategory) {
    if (category === 'color') {
      return 'Color';
    }

    if (category === 'fx') {
      return 'Effect';
    }

    return 'Sound';
  }

  function formatVisibleLabel(card: CardDefinition) {
    return `${categoryLabel(card.category)}: ${card.label}`;
  }

  // --- Audio ---
  async function testAudioOutput() {
    audioContext = audioContext ?? await ensureAudioContext();

    if (!audioContext) {
      soundStatus.textContent = 'Audio unsupported';
      return;
    }

    const now = audioContext.currentTime;
    const master = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    const low = audioContext.createOscillator();
    const high = audioContext.createOscillator();

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800, now);
    filter.Q.setValueAtTime(0.7, now);

    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.34, now + 0.03);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);

    low.type = 'triangle';
    high.type = 'sine';
    low.frequency.setValueAtTime(261.63, now);
    high.frequency.setValueAtTime(523.25, now);

    low.connect(filter);
    high.connect(filter);
    filter.connect(master);
    master.connect(audioContext.destination);

    low.start(now);
    high.start(now);
    low.stop(now + 0.72);
    high.stop(now + 0.72);

    soundStatus.textContent = 'Test tone';
    window.setTimeout(() => {
      if (soundStatus.textContent === 'Test tone' && !currentComposition.sound) {
        soundStatus.textContent = 'Silent';
      }
    }, 900);
  }

  function updateSoundLayer(nextSound: SoundId | null) {
    if (activeSoundId === nextSound) {
      return;
    }

    activeSoundCleanup?.();
    activeSoundCleanup = null;
    activeSoundId = nextSound;

    if (!audioContext || !nextSound) {
      return;
    }

    activeSoundCleanup = startSoundLayer(audioContext, nextSound);
  }

  function startSoundLayer(context: AudioContext, soundId: SoundId) {
    if (soundId === 'chime') {
      return startChimeLayer(context);
    }

    if (soundId === 'pad') {
      return startPadLayer(context);
    }

    return startLofiLayer(context);
  }

  function createLayerGain(context: AudioContext, peakGain: number) {
    const gain = context.createGain();
    const now = context.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.45);
    gain.connect(context.destination);

    return {
      gain,
      fadeOut: (duration = 0.45) => {
        const fadeNow = context.currentTime;
        gain.gain.cancelScheduledValues(fadeNow);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), fadeNow);
        gain.gain.exponentialRampToValueAtTime(0.0001, fadeNow + duration);
      },
      disconnect: () => {
        gain.disconnect();
      },
    };
  }

  function startChimeLayer(context: AudioContext) {
    const layer = createLayerGain(context, 0.32);
    const notes = [523.25, 587.33, 659.25, 783.99, 880];
    let step = 0;

    const playChime = () => {
      const now = context.currentTime;
      const root = notes[step % notes.length];
      const harmony = notes[(step + 2) % notes.length];
      scheduleBellTone(context, layer.gain, root, now, -0.22);
      scheduleBellTone(context, layer.gain, harmony * 0.5, now + 0.12, 0.22, 0.12);
      step += 1;
    };

    playChime();
    const loopId = window.setInterval(playChime, 1650);

    return () => {
      window.clearInterval(loopId);
      layer.fadeOut(0.65);
      window.setTimeout(() => layer.disconnect(), 760);
    };
  }

  function scheduleBellTone(
    context: AudioContext,
    destination: AudioNode,
    frequency: number,
    startTime: number,
    pan = 0,
    peak = 0.34,
  ) {
    const oscillator = context.createOscillator();
    const overtone = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    const panner = context.createStereoPanner();

    oscillator.type = 'sine';
    overtone.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, startTime);
    overtone.frequency.setValueAtTime(frequency * 2.01, startTime);
    panner.pan.setValueAtTime(pan, startTime);
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(frequency * 2.2, startTime);
    filter.Q.setValueAtTime(4.5, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(peak, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 2.2);

    oscillator.connect(gain);
    overtone.connect(gain);
    gain.connect(filter);
    filter.connect(panner);
    panner.connect(destination);

    oscillator.start(startTime);
    overtone.start(startTime);
    oscillator.stop(startTime + 2.3);
    overtone.stop(startTime + 2.3);
  }

  function startPadLayer(context: AudioContext) {
    const layer = createLayerGain(context, 0.34);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 980;
    filter.Q.value = 0.7;
    filter.connect(layer.gain);

    const tremolo = context.createOscillator();
    const tremoloDepth = context.createGain();
    tremolo.frequency.value = 0.08;
    tremoloDepth.gain.value = 110;
    tremolo.connect(tremoloDepth);
    tremoloDepth.connect(filter.frequency);
    tremolo.start();

    const oscillators = [0, 1, 2].map((index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = index === 1 ? 'sine' : 'triangle';
      gain.gain.value = index === 1 ? 0.22 : 0.14;
      oscillator.connect(gain);
      gain.connect(filter);
      oscillator.start();
      return oscillator;
    });

    const chords = [
      [220, 277.18, 329.63],
      [196, 246.94, 329.63],
      [174.61, 220, 293.66],
    ];
    let chordIndex = 0;

    const retuneChord = () => {
      const now = context.currentTime;
      const chord = chords[chordIndex % chords.length];
      oscillators.forEach((oscillator, index) => {
        oscillator.frequency.cancelScheduledValues(now);
        oscillator.frequency.linearRampToValueAtTime(chord[index], now + 1.8);
      });
      chordIndex += 1;
    };

    retuneChord();
    const loopId = window.setInterval(retuneChord, 6200);

    return () => {
      window.clearInterval(loopId);
      layer.fadeOut(0.8);
      const stopAt = context.currentTime + 0.85;
      tremolo.stop(stopAt);
      oscillators.forEach((oscillator) => oscillator.stop(stopAt));
      window.setTimeout(() => layer.disconnect(), 920);
    };
  }

  function startLofiLayer(context: AudioContext) {
    const layer = createLayerGain(context, 0.38);
    const hissSource = createNoiseSource(context, 1.8);
    const hissFilter = context.createBiquadFilter();
    const hissGain = context.createGain();

    hissFilter.type = 'lowpass';
    hissFilter.frequency.value = 1800;
    hissGain.gain.value = 0.08;
    hissSource.connect(hissFilter);
    hissFilter.connect(hissGain);
    hissGain.connect(layer.gain);
    hissSource.loop = true;
    hissSource.start();

    const bassNotes = [110, 130.81, 98, 123.47];
    let step = 0;

    const playPulse = () => {
      const now = context.currentTime;
      const bass = bassNotes[step % bassNotes.length];
      scheduleLofiPulse(context, layer.gain, bass, now);
      step += 1;
    };

    playPulse();
    const loopId = window.setInterval(playPulse, 900);

    return () => {
      window.clearInterval(loopId);
      layer.fadeOut(0.6);
      hissSource.stop(context.currentTime + 0.65);
      window.setTimeout(() => layer.disconnect(), 760);
    };
  }

  function scheduleLofiPulse(
    context: AudioContext,
    destination: AudioNode,
    frequency: number,
    startTime: number,
  ) {
    const bassOscillator = context.createOscillator();
    const toneOscillator = context.createOscillator();
    const bassGain = context.createGain();
    const toneGain = context.createGain();
    const bassFilter = context.createBiquadFilter();
    const toneFilter = context.createBiquadFilter();

    bassOscillator.type = 'triangle';
    toneOscillator.type = 'sawtooth';
    bassOscillator.frequency.setValueAtTime(frequency, startTime);
    bassOscillator.frequency.exponentialRampToValueAtTime(frequency * 0.92, startTime + 0.32);
    toneOscillator.frequency.setValueAtTime(frequency * 2, startTime);
    toneOscillator.frequency.exponentialRampToValueAtTime(frequency * 1.84, startTime + 0.28);

    bassFilter.type = 'lowpass';
    bassFilter.frequency.setValueAtTime(820, startTime);
    bassFilter.Q.setValueAtTime(0.7, startTime);

    toneFilter.type = 'bandpass';
    toneFilter.frequency.setValueAtTime(900, startTime);
    toneFilter.Q.setValueAtTime(1.1, startTime);

    bassGain.gain.setValueAtTime(0.0001, startTime);
    bassGain.gain.exponentialRampToValueAtTime(0.34, startTime + 0.02);
    bassGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.48);

    toneGain.gain.setValueAtTime(0.0001, startTime);
    toneGain.gain.exponentialRampToValueAtTime(0.18, startTime + 0.015);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.34);

    bassOscillator.connect(bassFilter);
    bassFilter.connect(bassGain);
    bassGain.connect(destination);

    toneOscillator.connect(toneFilter);
    toneFilter.connect(toneGain);
    toneGain.connect(destination);

    bassOscillator.start(startTime);
    toneOscillator.start(startTime);
    bassOscillator.stop(startTime + 0.54);
    toneOscillator.stop(startTime + 0.42);

    const click = createNoiseSource(context, 0.12);
    const clickFilter = context.createBiquadFilter();
    const clickGain = context.createGain();
    clickFilter.type = 'bandpass';
    clickFilter.frequency.setValueAtTime(1400, startTime);
    clickGain.gain.setValueAtTime(0.0001, startTime);
    clickGain.gain.exponentialRampToValueAtTime(0.11, startTime + 0.01);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.16);
    click.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(destination);
    click.start(startTime);
    click.stop(startTime + 0.18);
  }

  // --- Stream cleanup ---
  function stopCurrentStream() {
    if (currentStream) {
      stopStream(currentStream);
      currentStream = null;
      video.srcObject = null;
      cameraReady = false;
    }
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
  const onTestAudio = () => { void testAudioOutput(); };
  const onHueBridgeInput = () => {
    if (getHueBridgeIp() !== huePairedBridgeIp) {
      hueUsername = '';
    }
    saveHueSettings();
    syncHueControls();
  };
  const onHueFind = () => { void findHueBridge(); };
  const onHuePair = () => { void pairHueBridge(); };
  const onHueToggle = () => { void toggleHueLights(); };
  const onHueSync = () => { void toggleHueSceneSync(); };
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
  const onResize = () => { resizeCanvas(); };

  startCameraButton.addEventListener('click', onStartCamera);
  testAudioButton.addEventListener('click', onTestAudio);
  hueBridgeInput.addEventListener('input', onHueBridgeInput);
  hueFindButton.addEventListener('click', onHueFind);
  huePairButton.addEventListener('click', onHuePair);
  hueToggleButton.addEventListener('click', onHueToggle);
  hueSyncButton.addEventListener('click', onHueSync);
  openStudioButton.addEventListener('click', onOpenStudio);
  backToDisplayButton.addEventListener('click', onBackToDisplay);

  cameraSelect.addEventListener('change', onCameraChange);
  printButton.addEventListener('click', onPrint);
  printButtonInline.addEventListener('click', onPrint);
  window.addEventListener('resize', onResize);


  // --- Initialize ---
  loadHueSettings();
  // Restore composition from doc if available
  {
    const doc = handle.doc() as ColorsDoc | undefined;
    if (doc?.activeColors?.length || doc?.activeEffect || doc?.activeSound) {
      currentComposition = createComposition(
        (doc.activeColors ?? []) as ColorId[],
        (doc.activeEffect ?? null) as EffectId | null,
        (doc.activeSound ?? null) as SoundId | null,
      );
    }
  }
  applyComposition(currentComposition, true);
  syncHueControls();
  void renderCards();
  void probeCameraAvailability();

  resizeCanvas();
  rafHandle = window.requestAnimationFrame(renderScene);
  syncIntervalHandle = window.setInterval(syncScannerState, 80);


  // --- Cleanup function ---
  return () => {
    destroyed = true;

    // Stop camera stream
    stopDetectionLoop();
    stopCurrentStream();

    // Stop sound layers
    activeSoundCleanup?.();
    activeSoundCleanup = null;

    // Close audio context
    if (audioContext) {
      void audioContext.close();
      audioContext = null;
    }

    // Cancel rAF
    if (rafHandle) {
      window.cancelAnimationFrame(rafHandle);
      rafHandle = 0;
    }

    // Clear sync interval
    if (syncIntervalHandle) {
      window.clearInterval(syncIntervalHandle);
      syncIntervalHandle = 0;
    }

    // Remove event listeners
    startCameraButton.removeEventListener('click', onStartCamera);
    testAudioButton.removeEventListener('click', onTestAudio);
    hueBridgeInput.removeEventListener('input', onHueBridgeInput);
    hueFindButton.removeEventListener('click', onHueFind);
    huePairButton.removeEventListener('click', onHuePair);
    hueToggleButton.removeEventListener('click', onHueToggle);
    hueSyncButton.removeEventListener('click', onHueSync);
    openStudioButton.removeEventListener('click', onOpenStudio);
    backToDisplayButton.removeEventListener('click', onBackToDisplay);

    cameraSelect.removeEventListener('change', onCameraChange);
    printButton.removeEventListener('click', onPrint);
    printButtonInline.removeEventListener('click', onPrint);
    window.removeEventListener('resize', onResize);
    handle.off("change", onDocChange);

    // Clear DOM
    element.innerHTML = '';
  };
}
