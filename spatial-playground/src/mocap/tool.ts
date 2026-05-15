import { listVideoDevices, buildVideoConstraints, waitForVideoReady, stopStream } from '../shared/camera.ts';
import { clamp, average, escapeHtml } from '../shared/utils.ts';
import type { MocapDoc } from '../types.ts';

type Point = { x: number; y: number };

type HolePoseId = 'hands-up' | 't-pose' | 'right-aim' | 'left-aim' | 'crouch' | 'star';
type SpellMode = 'idle' | 'portal' | 'shield' | 'beam' | 'stealth' | 'surge';
type GamePhase = 'calibrating' | 'playing';

type FitScores = Record<HolePoseId, number>;

type PoseFlags = {
  handsUp: boolean;
  tPose: boolean;
  rightAim: boolean;
  leftAim: boolean;
  crouch: boolean;
  star: boolean;
};

type PoseSignal = {
  present: boolean;
  confidence: number;
  label: string;
  bodyCenter: Point;
  rightHand: Point | null;
  leftHand: Point | null;
  bodyHeight: number;
  distanceQuality: number;
  fullBodyVisible: boolean;
  motion: number;
  stillness: number;
  fitScore: number;
  holdProgress: number;
  flags: PoseFlags;
  fitScores: FitScores;
};

type HolePose = {
  id: HolePoseId;
  name: string;
  command: string;
  hint: string;
  spell: SpellMode;
};

type NormalizedLandmark = { x: number; y: number; z: number; visibility?: number };

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const HOLD_TO_SCORE_MS = 620;
const CALIBRATION_HOLD_MS = 1200;
const FIT_THRESHOLD = 0.76;
const MIN_BODY_HEIGHT = 0.42;
const MAX_BODY_HEIGHT = 0.86;
const IDEAL_BODY_HEIGHT = 0.66;
const MOTION_SMOOTHING = 0.72;
const PARTICLE_COUNT = 44;

const HOLE_POSES: HolePose[] = [
  { id: 'hands-up', name: 'Raise the Roof', command: 'HANDS UP', hint: 'Both hands above your shoulders. Make yourself tall.', spell: 'portal' },
  { id: 't-pose', name: 'Human Airplane', command: 'ARMS OUT', hint: 'Arms straight out to both sides. Hold the wings wide.', spell: 'shield' },
  { id: 'right-aim', name: 'Right Arm Laser', command: 'RIGHT ARM OUT', hint: 'Point your right arm sideways like a beam.', spell: 'beam' },
  { id: 'left-aim', name: 'Left Arm Laser', command: 'LEFT ARM OUT', hint: 'Point your left arm sideways like a beam.', spell: 'beam' },
  { id: 'crouch', name: 'Tiny Mode', command: 'CROUCH LOW', hint: 'Crouch down low and stay compact.', spell: 'stealth' },
  { id: 'star', name: 'Star Shape', command: 'BIG STAR', hint: 'Hands high and wide. Big dramatic X shape.', spell: 'surge' },
];

const POSE_CONNECTIONS: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28], [27, 31], [28, 32],
];

const LANDMARKS = {
  leftShoulder: 11, rightShoulder: 12,
  leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
} as const;

const STYLE = `
.mocap-shell {
  --ink: #f7f3e9;
  --muted: rgba(247, 243, 233, 0.64);
  --panel: rgba(7, 11, 15, 0.72);
  --line: rgba(247, 243, 233, 0.14);
  --green: #7bf5cb;
  --gold: #ffd166;
  --red: #ff6b57;
  --spell-a: #7bf5cb;
  --spell-b: #ffd166;
  font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
  color: var(--ink);
  background: #10151d;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  width: 100%;
  height: 100%;
  overflow: hidden;
  padding: 14px;
  margin: 0;
}

.mocap-shell[data-spell="portal"] {
  --spell-a: #7bf5cb;
  --spell-b: #9b5cff;
}

.mocap-shell[data-spell="shield"] {
  --spell-a: #7ad7ff;
  --spell-b: #f7f3e9;
}

.mocap-shell[data-spell="beam"] {
  --spell-a: #ff6b57;
  --spell-b: #ffd166;
}

.mocap-shell[data-spell="stealth"] {
  --spell-a: #9aa4b2;
  --spell-b: #5e6b80;
}

.mocap-shell[data-spell="surge"] {
  --spell-a: #ffd166;
  --spell-b: #7bf5cb;
}

.mocap-shell * {
  box-sizing: border-box;
}

.mocap-shell button,
.mocap-shell select {
  border: 0;
  font: inherit;
  color: inherit;
}

.mocap-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.topbar,
.stage {
  position: relative;
  z-index: 1;
}

.topbar {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(5, 8, 12, 0.72);
  backdrop-filter: blur(18px);
}

.nav-link,
.primary-action,
.secondary-action,
.camera-select {
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  padding: 0 13px;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.06);
}

.primary-action {
  color: #07100d;
  border-color: rgba(255, 255, 255, 0.34);
  background: linear-gradient(135deg, var(--green), var(--gold));
}

.primary-action:disabled,
.secondary-action:disabled,
.camera-select:disabled {
  opacity: 0.56;
  cursor: default;
}

.camera-select {
  min-width: 180px;
  max-width: 280px;
}

.stage {
  height: calc(100% - 74px);
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(340px, 0.85fr);
  gap: 12px;
  padding-top: 12px;
}

.arena-panel,
.sensor-panel {
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--panel);
  box-shadow: 0 22px 80px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(18px);
}

.arena-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  padding: 22px;
}

.arena-copy {
  display: grid;
  gap: 7px;
}

.eyebrow {
  margin: 0;
  color: var(--muted);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  font-size: 0.78rem;
}

.mocap-shell h1 {
  margin: 0;
  max-width: 10ch;
  font-size: clamp(3rem, 7vw, 7rem);
  line-height: 0.86;
  letter-spacing: -0.07em;
}

.mocap-shell p {
  margin: 0;
}

.pose-subtitle {
  color: var(--muted);
  font-size: 1.04rem;
}

.arena {
  --fit: 0;
  --fit-bg-pct: 12%;
  --fit-border-pct: 35%;
  --fit-glow-size: 28px;
  --fit-glow-pct: 24%;
  --fit-wall-opacity: 0.14;
  --fit-part-pct: 28%;
  --fit-part-border-pct: 35%;
  --fit-part-glow-size: 12px;
  --fit-part-glow-pct: 24%;
  --aura-opacity: 0.32;
  --particle-opacity: 0.12;
  --particle-duration: 2.4s;
  --hold: 0;
  position: relative;
  min-height: 0;
  overflow: hidden;
  border-radius: 18px;
  border: 1px solid rgba(247, 243, 233, 0.12);
  background:
    radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--spell-a) var(--fit-bg-pct), transparent), transparent 44%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.015));
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.arena.is-near-fit {
  border-color: color-mix(in srgb, var(--spell-a) 62%, white);
  box-shadow:
    inset 0 0 60px color-mix(in srgb, var(--spell-a) 18%, transparent),
    0 0 70px color-mix(in srgb, var(--spell-a) 18%, transparent);
}

.arena.is-calibrating {
  --spell-a: #7ad7ff;
  --spell-b: #ffd166;
}

.arena-grid {
  position: absolute;
  inset: 0;
  opacity: 0.26;
  background-image:
    linear-gradient(rgba(247, 243, 233, 0.11) 1px, transparent 1px),
    linear-gradient(90deg, rgba(247, 243, 233, 0.11) 1px, transparent 1px);
  background-size: 9% 9%;
  mask-image: radial-gradient(circle at center, black, transparent 78%);
}

.hole-wall {
  --arm-left-rotate: -148deg;
  --arm-right-rotate: 148deg;
  --leg-left-rotate: 10deg;
  --leg-right-rotate: -10deg;
  --torso-y: 35%;
  --torso-h: 25%;
  --head-y: 19%;
  position: absolute;
  z-index: 3;
  left: 50%;
  top: 52%;
  width: min(58%, 500px);
  height: min(88%, 610px);
  translate: -50% -50%;
  border-radius: 44px;
  border: 2px solid color-mix(in srgb, var(--spell-a) var(--fit-border-pct), white);
  background:
    radial-gradient(circle at 50% 50%, rgba(0, 0, 0, 0.18), rgba(0, 0, 0, 0.58)),
    linear-gradient(135deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.015));
  box-shadow:
    inset 0 0 70px rgba(0, 0, 0, 0.55),
    0 0 var(--fit-glow-size) color-mix(in srgb, var(--spell-a) var(--fit-glow-pct), transparent);
  opacity: 0.34;
  transition:
    border-color 140ms ease,
    box-shadow 140ms ease,
    filter 140ms ease;
}

.arena.is-near-fit .hole-wall {
  opacity: 0.62;
  filter: brightness(1.22) saturate(1.18);
}

.hole-wall::before {
  content: '';
  position: absolute;
  inset: 7%;
  border-radius: 32px;
  border: 1px dashed rgba(247, 243, 233, 0.22);
}

.hole-wall::after {
  content: '';
  position: absolute;
  inset: -18%;
  z-index: -1;
  opacity: var(--fit-wall-opacity);
  background: conic-gradient(from 0deg, transparent, var(--spell-a), transparent, var(--spell-b), transparent);
  filter: blur(24px);
  animation: wallSpin 3.8s linear infinite;
}

.hole-part {
  position: absolute;
  left: 50%;
  background:
    radial-gradient(circle at 30% 28%, rgba(255, 255, 255, 0.34), transparent 24%),
    color-mix(in srgb, var(--spell-a) var(--fit-part-pct), #05080c);
  border: 2px solid color-mix(in srgb, var(--spell-b) var(--fit-part-border-pct), white);
  box-shadow:
    inset 0 0 24px rgba(0, 0, 0, 0.58),
    0 0 var(--fit-part-glow-size) color-mix(in srgb, var(--spell-a) var(--fit-part-glow-pct), transparent);
  transition:
    top 220ms ease,
    height 220ms ease,
    width 220ms ease,
    transform 220ms ease,
    border-color 140ms ease,
    box-shadow 140ms ease;
}

.hole-head {
  top: var(--head-y);
  width: 18%;
  aspect-ratio: 1;
  translate: -50% 0;
  border-radius: 999px;
}

.hole-torso {
  top: var(--torso-y);
  width: 20%;
  height: var(--torso-h);
  translate: -50% 0;
  border-radius: 999px 999px 32px 32px;
}

.hole-arm {
  top: calc(var(--torso-y) + 2%);
  width: 9%;
  height: 38%;
  border-radius: 999px;
  transform-origin: 50% 8%;
}

.hole-arm-left {
  transform: translateX(-50%) rotate(var(--arm-left-rotate));
}

.hole-arm-right {
  transform: translateX(-50%) rotate(var(--arm-right-rotate));
}

.hole-leg {
  top: calc(var(--torso-y) + var(--torso-h) - 2%);
  width: 10%;
  height: 32%;
  border-radius: 999px;
  transform-origin: 50% 8%;
}

.hole-leg-left {
  transform: translateX(-50%) rotate(var(--leg-left-rotate));
}

.hole-leg-right {
  transform: translateX(-50%) rotate(var(--leg-right-rotate));
}

.hole-wall[data-hole="t-pose"] {
  --arm-left-rotate: -90deg;
  --arm-right-rotate: 90deg;
  --leg-left-rotate: 5deg;
  --leg-right-rotate: -5deg;
}

.hole-wall[data-hole="right-aim"] {
  --arm-left-rotate: 16deg;
  --arm-right-rotate: 92deg;
}

.hole-wall[data-hole="left-aim"] {
  --arm-left-rotate: -92deg;
  --arm-right-rotate: -16deg;
}

.hole-wall[data-hole="crouch"] {
  --arm-left-rotate: -70deg;
  --arm-right-rotate: 70deg;
  --leg-left-rotate: 48deg;
  --leg-right-rotate: -48deg;
  --torso-y: 43%;
  --torso-h: 18%;
  --head-y: 29%;
}

.hole-wall[data-hole="star"] {
  --arm-left-rotate: -128deg;
  --arm-right-rotate: 128deg;
  --leg-left-rotate: 34deg;
  --leg-right-rotate: -34deg;
}

.target-skeleton {
  --arm-left-rotate: -148deg;
  --arm-right-rotate: 148deg;
  --leg-left-rotate: 12deg;
  --leg-right-rotate: -12deg;
  --skeleton-color: color-mix(in srgb, var(--spell-a) 76%, white);
  position: absolute;
  z-index: 6;
  left: clamp(18px, 4vw, 44px);
  top: clamp(18px, 4vh, 38px);
  width: clamp(120px, 14vw, 190px);
  aspect-ratio: 0.72;
  border: 1px solid rgba(247, 243, 233, 0.18);
  border-radius: 24px;
  background:
    radial-gradient(circle at 50% 34%, color-mix(in srgb, var(--spell-a) 18%, transparent), transparent 44%),
    rgba(0, 0, 0, 0.24);
  box-shadow: 0 0 38px color-mix(in srgb, var(--spell-a) 16%, transparent);
}

.target-skeleton::before {
  content: 'TARGET';
  position: absolute;
  left: 50%;
  top: 8%;
  translate: -50% 0;
  color: var(--muted);
  letter-spacing: 0.18em;
  font-size: 0.64rem;
  font-weight: 800;
}

.target-node,
.target-bone {
  position: absolute;
  left: 50%;
  background: var(--skeleton-color);
  box-shadow: 0 0 22px color-mix(in srgb, var(--spell-a) 44%, transparent);
}

.target-node {
  top: 21%;
  width: 17%;
  aspect-ratio: 1;
  translate: -50% 0;
  border-radius: 999px;
}

.target-bone {
  width: 8%;
  border-radius: 999px;
  transform-origin: 50% 8%;
}

.target-spine {
  top: 35%;
  height: 25%;
  translate: -50% 0;
}

.target-arm {
  top: 35%;
  height: 37%;
}

.target-arm-left {
  transform: translateX(-50%) rotate(var(--arm-left-rotate));
}

.target-arm-right {
  transform: translateX(-50%) rotate(var(--arm-right-rotate));
}

.target-leg {
  top: 58%;
  height: 30%;
}

.target-leg-left {
  transform: translateX(-50%) rotate(var(--leg-left-rotate));
}

.target-leg-right {
  transform: translateX(-50%) rotate(var(--leg-right-rotate));
}

.target-skeleton[data-hole="t-pose"] {
  --arm-left-rotate: -90deg;
  --arm-right-rotate: 90deg;
  --leg-left-rotate: 6deg;
  --leg-right-rotate: -6deg;
}

.target-skeleton[data-hole="right-aim"] {
  --arm-left-rotate: 14deg;
  --arm-right-rotate: 92deg;
}

.target-skeleton[data-hole="left-aim"] {
  --arm-left-rotate: -92deg;
  --arm-right-rotate: -14deg;
}

.target-skeleton[data-hole="crouch"] {
  --arm-left-rotate: -70deg;
  --arm-right-rotate: 70deg;
  --leg-left-rotate: 48deg;
  --leg-right-rotate: -48deg;
}

.target-skeleton[data-hole="star"] {
  --arm-left-rotate: -128deg;
  --arm-right-rotate: 128deg;
  --leg-left-rotate: 34deg;
  --leg-right-rotate: -34deg;
}

.arena.is-calibrating .target-skeleton,
.arena.is-calibrating .hole-wall,
.arena.is-calibrating .pose-card,
.arena.is-calibrating .hold-ring {
  opacity: 0;
  pointer-events: none;
}

.pose-card {
  position: absolute;
  z-index: 5;
  left: 50%;
  top: 50%;
  width: min(84%, 780px);
  min-height: 42%;
  display: grid;
  place-content: center;
  gap: clamp(10px, 2vh, 18px);
  translate: -50% -50%;
  padding: clamp(24px, 5vw, 54px);
  border-radius: 34px;
  border: 2px solid color-mix(in srgb, var(--spell-a) var(--fit-border-pct), white);
  text-align: center;
  background:
    radial-gradient(circle at 50% 15%, rgba(255, 255, 255, 0.13), transparent 28%),
    linear-gradient(135deg, rgba(3, 8, 11, 0.78), rgba(14, 20, 24, 0.54));
  box-shadow:
    inset 0 0 80px rgba(255, 255, 255, 0.035),
    0 0 var(--fit-glow-size) color-mix(in srgb, var(--spell-a) var(--fit-glow-pct), transparent);
  backdrop-filter: blur(5px);
}

.pose-card span {
  display: block;
  color: var(--ink);
  font-size: clamp(4.8rem, 12vw, 12rem);
  font-weight: 950;
  line-height: 0.82;
  letter-spacing: -0.09em;
  text-wrap: balance;
  text-shadow:
    0 0 22px rgba(255, 255, 255, 0.18),
    0 0 60px color-mix(in srgb, var(--spell-a) 28%, transparent);
}

.pose-card small {
  max-width: 52ch;
  margin: 0 auto;
  color: color-mix(in srgb, var(--ink) 72%, var(--spell-a));
  font-size: clamp(1.15rem, 2.1vw, 1.8rem);
  font-weight: 750;
  line-height: 1.14;
  text-wrap: balance;
}

.arena.is-near-fit .pose-card {
  border-color: color-mix(in srgb, var(--green) 82%, white);
  background:
    radial-gradient(circle at 50% 20%, rgba(123, 245, 203, 0.24), transparent 34%),
    linear-gradient(135deg, rgba(8, 34, 27, 0.84), rgba(19, 31, 26, 0.62));
  animation: cardPulse 320ms ease-in-out infinite alternate;
}

.hold-ring {
  position: absolute;
  z-index: 6;
  left: 50%;
  top: 50%;
  width: min(86%, 820px);
  aspect-ratio: 1;
  translate: -50% -50%;
  pointer-events: none;
  opacity: calc(var(--hold) * 0.86);
  border-radius: 999px;
  background:
    conic-gradient(var(--green) calc(var(--hold) * 1turn), transparent 0),
    radial-gradient(circle, transparent 60%, rgba(123, 245, 203, 0.13) 61%, transparent 70%);
  mask-image: radial-gradient(circle, transparent 59%, black 60%, black 69%, transparent 70%);
}

.calibration-panel {
  position: absolute;
  z-index: 8;
  left: 50%;
  top: 50%;
  width: min(86%, 760px);
  display: grid;
  gap: clamp(12px, 2vh, 18px);
  translate: -50% -50%;
  padding: clamp(28px, 5vw, 58px);
  border-radius: 34px;
  border: 2px solid color-mix(in srgb, var(--spell-a) 52%, white);
  text-align: center;
  background:
    radial-gradient(circle at 50% 0%, rgba(122, 215, 255, 0.18), transparent 32%),
    linear-gradient(135deg, rgba(4, 11, 17, 0.88), rgba(16, 21, 29, 0.74));
  box-shadow:
    0 0 80px color-mix(in srgb, var(--spell-a) 18%, transparent),
    inset 0 0 80px rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(7px);
}

.arena:not(.is-calibrating) .calibration-panel {
  display: none;
}

.calibration-panel p {
  color: var(--muted);
  letter-spacing: 0.22em;
  text-transform: uppercase;
  font-size: 0.78rem;
  font-weight: 800;
}

.calibration-panel strong {
  font-size: clamp(3.8rem, 9vw, 9rem);
  line-height: 0.82;
  letter-spacing: -0.08em;
}

.calibration-panel span {
  max-width: 50ch;
  justify-self: center;
  color: color-mix(in srgb, var(--ink) 76%, var(--spell-a));
  font-size: clamp(1.1rem, 2vw, 1.6rem);
  font-weight: 750;
  line-height: 1.16;
}

.distance-meter {
  height: 22px;
  overflow: hidden;
  border-radius: 999px;
  border: 1px solid rgba(247, 243, 233, 0.22);
  background:
    linear-gradient(90deg, rgba(255, 107, 87, 0.28), rgba(255, 209, 102, 0.24), rgba(123, 245, 203, 0.28)),
    rgba(255, 255, 255, 0.06);
}

.distance-meter i {
  display: block;
  width: 0%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--spell-a), var(--green));
  box-shadow: 0 0 26px color-mix(in srgb, var(--spell-a) 42%, transparent);
  transition: width 140ms ease;
}

.calibration-progress {
  color: var(--muted);
  font-size: 0.98rem;
  font-weight: 800;
}

.skip-calibration {
  justify-self: center;
  min-height: 42px;
  padding: 0 16px;
  border: 1px solid rgba(247, 243, 233, 0.18);
  border-radius: 999px;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
}

.calibration-panel[data-status="ready"] {
  border-color: color-mix(in srgb, var(--green) 78%, white);
  box-shadow:
    0 0 90px rgba(123, 245, 203, 0.2),
    inset 0 0 80px rgba(123, 245, 203, 0.06);
}

.fit-flash {
  position: absolute;
  z-index: 7;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  opacity: 0;
  color: #06100d;
  font-size: clamp(5rem, 16vw, 15rem);
  font-weight: 950;
  letter-spacing: -0.08em;
  text-shadow:
    0 0 22px rgba(255, 255, 255, 0.88),
    0 0 90px var(--spell-a);
}

.fit-flash.is-visible {
  animation: fitPop 580ms cubic-bezier(0.1, 0.9, 0.2, 1);
}

.aura {
  --aura-scale: 1;
  position: absolute;
  z-index: 1;
  width: 38%;
  aspect-ratio: 1;
  translate: -50% -50%;
  scale: var(--aura-scale);
  opacity: 0;
  border-radius: 999px;
  background:
    radial-gradient(circle, rgba(255, 255, 255, 0.1), transparent 28%),
    conic-gradient(from 0deg, var(--spell-a), transparent, var(--spell-b), transparent, var(--spell-a));
  filter: blur(0.3px) drop-shadow(0 0 42px color-mix(in srgb, var(--spell-a) 48%, transparent));
  mix-blend-mode: screen;
  animation: auraSpin 3.8s linear infinite;
  transition:
    opacity 130ms ease,
    scale 130ms ease;
}

.aura.is-visible {
  opacity: var(--aura-opacity);
}

.hand-cursor {
  position: absolute;
  z-index: 7;
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  translate: -50% -50%;
  border-radius: 999px;
  color: #06100d;
  background: var(--spell-a);
  box-shadow:
    0 0 30px color-mix(in srgb, var(--spell-a) 50%, transparent),
    0 0 80px color-mix(in srgb, var(--spell-a) 24%, transparent);
  font-weight: 900;
  opacity: 0;
  transition: opacity 90ms ease;
}

.left-hand {
  background: var(--spell-b);
}

.hand-cursor.is-visible {
  opacity: 1;
}

.particle-field {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  mix-blend-mode: screen;
}

.particle-field i {
  position: absolute;
  left: var(--x);
  top: var(--y);
  width: var(--size);
  height: var(--size);
  border-radius: 999px;
  background: var(--spell-a);
  opacity: var(--particle-opacity);
  animation: particleFloat var(--particle-duration) ease-in-out infinite;
  animation-delay: var(--delay);
  box-shadow: 0 0 20px color-mix(in srgb, var(--spell-a) 58%, transparent);
}

.sensor-panel {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto auto auto;
  gap: 12px;
  padding: 14px;
}

.camera-frame {
  --camera-aspect: 16 / 9;
  position: relative;
  min-height: 0;
  aspect-ratio: var(--camera-aspect);
  align-self: center;
  overflow: hidden;
  border-radius: 12px;
  background: #04070a;
  border: 1px solid rgba(247, 243, 233, 0.1);
}

.camera-frame video,
.pose-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.camera-frame video {
  object-fit: contain;
}

.pose-overlay {
  pointer-events: none;
  filter: drop-shadow(0 0 12px rgba(123, 245, 203, 0.28));
}

.signal-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.signal-grid article,
.debug-panel {
  border: 1px solid rgba(247, 243, 233, 0.1);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.055);
}

.signal-grid article {
  min-width: 0;
  display: grid;
  gap: 4px;
  padding: 10px;
}

.signal-grid span,
.debug-panel span {
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.13em;
  font-size: 0.68rem;
}

.signal-grid strong,
.debug-panel strong {
  min-width: 0;
  overflow-wrap: anywhere;
}

.debug-panel {
  display: grid;
  gap: 8px;
  padding: 11px;
}

.debug-panel div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.debug-panel p {
  color: var(--muted);
  line-height: 1.35;
}

.gesture-help {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.gesture-help span {
  padding: 8px 9px;
  border: 1px solid rgba(247, 243, 233, 0.1);
  border-radius: 8px;
  color: var(--muted);
  background: rgba(255, 255, 255, 0.045);
  font-size: 0.78rem;
}

@keyframes wallSpin {
  to { rotate: 1turn; }
}

@keyframes auraSpin {
  to { rotate: 1turn; }
}

@keyframes fitPop {
  0% { opacity: 0; scale: 0.68; filter: blur(10px); }
  34% { opacity: 1; scale: 1; filter: blur(0); }
  100% { opacity: 0; scale: 1.28; filter: blur(8px); }
}

@keyframes cardPulse {
  from { scale: 1; }
  to { scale: 1.025; }
}

@keyframes particleFloat {
  0%, 100% { transform: translate3d(0, 0, 0) scale(0.7); }
  50% { transform: translate3d(18px, -30px, 0) scale(1.8); }
}

@media (max-width: 920px) {
  .mocap-shell {
    overflow: auto;
    height: auto;
    min-height: 100%;
  }

  .topbar {
    flex-wrap: wrap;
  }

  .stage {
    height: auto;
    grid-template-columns: 1fr;
  }

  .arena {
    min-height: 62%;
  }
}
`;

export default function MocapTool(handle: any, element: HTMLElement) {
  // -- DOM setup ---------------------------------------------------------------

  element.innerHTML = `
    <main class="mocap-shell">
      <canvas id="mocap-bg" class="mocap-bg" aria-hidden="true"></canvas>

      <header class="topbar">
        <button id="start-camera" class="primary-action" type="button">Start Camera</button>
        <select id="camera-select" class="camera-select" aria-label="Camera"></select>
        <button id="reset-target" class="secondary-action" type="button">New Shape</button>
        <button id="toggle-fullscreen" class="secondary-action" type="button">Fullscreen</button>
      </header>

      <section class="stage">
        <section class="arena-panel">
          <div class="arena-copy">
            <p class="eyebrow">Hole in the Wall</p>
            <h1 id="pose-title">Make the shape</h1>
            <p id="pose-subtitle" class="pose-subtitle">Match the glowing cutout with your body. When it turns green, freeze for a beat.</p>
          </div>

          <div id="arena" class="arena" aria-label="Body shape arena">
            <div id="hole-wall" class="hole-wall" aria-hidden="true">
              <div class="hole-part hole-head"></div>
              <div class="hole-part hole-torso"></div>
              <div class="hole-part hole-arm hole-arm-left"></div>
              <div class="hole-part hole-arm hole-arm-right"></div>
              <div class="hole-part hole-leg hole-leg-left"></div>
              <div class="hole-part hole-leg hole-leg-right"></div>
            </div>
            <div id="target-skeleton" class="target-skeleton" aria-hidden="true">
              <i class="target-node target-head"></i>
              <i class="target-bone target-spine"></i>
              <i class="target-bone target-arm target-arm-left"></i>
              <i class="target-bone target-arm target-arm-right"></i>
              <i class="target-bone target-leg target-leg-left"></i>
              <i class="target-bone target-leg target-leg-right"></i>
            </div>
            <div id="pose-card" class="pose-card" aria-live="polite">
              <span id="pose-command">HANDS UP</span>
              <small id="pose-card-hint">Both hands above your shoulders.</small>
            </div>
            <div id="calibration-panel" class="calibration-panel" aria-live="polite">
              <p>Calibration</p>
              <strong id="calibration-title">Step into frame</strong>
              <span id="calibration-message">Stand where the camera can see your whole body.</span>
              <div class="distance-meter" aria-hidden="true">
                <i id="distance-fill"></i>
              </div>
              <small id="calibration-progress" class="calibration-progress">0%</small>
              <button id="skip-calibration" class="skip-calibration" type="button">Start Anyway</button>
            </div>
            <div id="hold-ring" class="hold-ring" aria-hidden="true"></div>
            <div id="fit-flash" class="fit-flash">FIT!</div>
            <div id="aura" class="aura"></div>
            <div id="left-hand-cursor" class="hand-cursor left-hand">L</div>
            <div id="right-hand-cursor" class="hand-cursor right-hand">R</div>
            <div id="particle-field" class="particle-field" aria-hidden="true"></div>
            <div class="arena-grid" aria-hidden="true"></div>
          </div>
        </section>

        <aside class="sensor-panel">
          <div class="camera-frame">
            <video id="camera" autoplay muted playsinline></video>
            <canvas id="pose-overlay" class="pose-overlay"></canvas>
          </div>

          <section class="signal-grid">
            <article><span>Player</span><strong id="person-status">No person</strong></article>
            <article><span>Shape Fit</span><strong id="fit-status">0%</strong></article>
            <article><span>Detected</span><strong id="pose-status">None</strong></article>
            <article><span>Hold</span><strong id="hold-status">0%</strong></article>
          </section>

          <section class="debug-panel">
            <div><span>Score</span><strong id="score-status">0</strong></div>
            <div><span>Streak</span><strong id="streak-status">0</strong></div>
            <p id="runtime-status">Model not loaded.</p>
          </section>

          <section class="gesture-help">
            <span>Big shapes work best</span>
            <span>Stand 1.5-3m back</span>
            <span>Keep your whole body visible</span>
            <span>Freeze when it turns green</span>
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

  // -- Query helpers -----------------------------------------------------------

  function q<T extends Element>(selector: string): T {
    const el = element.querySelector<T>(selector);
    if (!el) throw new Error(`Missing element: ${selector}`);
    return el;
  }

  function ctx2d(canvas: HTMLCanvasElement) {
    const c = canvas.getContext('2d');
    if (!c) throw new Error('Unable to create 2d context');
    return c;
  }

  // -- Element refs ------------------------------------------------------------

  const shell = q<HTMLElement>('.mocap-shell');
  const backgroundCanvas = q<HTMLCanvasElement>('#mocap-bg');
  const backgroundContext = ctx2d(backgroundCanvas);
  const startCameraButton = q<HTMLButtonElement>('#start-camera');
  const cameraSelect = q<HTMLSelectElement>('#camera-select');
  const resetTargetButton = q<HTMLButtonElement>('#reset-target');
  const fullscreenButton = q<HTMLButtonElement>('#toggle-fullscreen');
  const video = q<HTMLVideoElement>('#camera');
  const overlay = q<HTMLCanvasElement>('#pose-overlay');
  const overlayContext = ctx2d(overlay);
  const arena = q<HTMLDivElement>('#arena');
  const holeWall = q<HTMLDivElement>('#hole-wall');
  const targetSkeleton = q<HTMLDivElement>('#target-skeleton');
  const poseCommand = q<HTMLElement>('#pose-command');
  const poseCardHint = q<HTMLElement>('#pose-card-hint');
  const calibrationPanel = q<HTMLDivElement>('#calibration-panel');
  const calibrationTitle = q<HTMLElement>('#calibration-title');
  const calibrationMessage = q<HTMLElement>('#calibration-message');
  const calibrationProgress = q<HTMLElement>('#calibration-progress');
  const distanceFill = q<HTMLElement>('#distance-fill');
  const skipCalibrationButton = q<HTMLButtonElement>('#skip-calibration');
  const fitFlash = q<HTMLDivElement>('#fit-flash');
  const leftHandCursor = q<HTMLDivElement>('#left-hand-cursor');
  const rightHandCursor = q<HTMLDivElement>('#right-hand-cursor');
  const aura = q<HTMLDivElement>('#aura');
  const particleField = q<HTMLDivElement>('#particle-field');
  const poseTitle = q<HTMLElement>('#pose-title');
  const poseSubtitle = q<HTMLElement>('#pose-subtitle');
  const personStatus = q<HTMLElement>('#person-status');
  const fitStatus = q<HTMLElement>('#fit-status');
  const poseStatus = q<HTMLElement>('#pose-status');
  const holdStatus = q<HTMLElement>('#hold-status');
  const scoreStatus = q<HTMLElement>('#score-status');
  const streakStatus = q<HTMLElement>('#streak-status');
  const runtimeStatus = q<HTMLElement>('#runtime-status');

  // -- State -------------------------------------------------------------------

  let poseLandmarker: any = null;
  let currentStream: MediaStream | null = null;
  let selectedCameraId: string | null = null;
  let cameraReady = false;
  let cameraStarting = false;
  let detectLoopHandle = 0;
  let bgAnimHandle = 0;
  let lastVideoTime = -1;
  let previousSignal: PoseSignal | null = null;
  let smoothedMotion = 0;
  let currentHoleIndex = 0;
  let fitEnteredAt = 0;
  let calibrationEnteredAt = 0;
  let gamePhase: GamePhase = 'calibrating';
  let score = 0;
  let streak = 0;
  let disposed = false;

  // -- MediaPipe ---------------------------------------------------------------

  async function ensurePoseLandmarker() {
    if (poseLandmarker) return poseLandmarker;

    const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.48,
      minPosePresenceConfidence: 0.48,
      minTrackingConfidence: 0.48,
    });
    return poseLandmarker;
  }

  // -- Camera ------------------------------------------------------------------

  async function startCamera(deviceId?: string) {
    if (cameraStarting || disposed) return;

    cameraStarting = true;
    startCameraButton.disabled = true;
    startCameraButton.textContent = cameraReady ? 'Switching...' : 'Starting...';
    runtimeStatus.textContent = 'Loading pose model...';

    try {
      await ensurePoseLandmarker();
      stopDetectLoop();
      stopCurrentStream();

      selectedCameraId = deviceId ?? selectedCameraId;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: buildVideoConstraints(selectedCameraId, { width: 1280, height: 720 }),
      });

      currentStream = stream;
      video.srcObject = stream;
      await waitForVideoReady(video);
      await video.play();

      selectedCameraId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? selectedCameraId;
      cameraReady = true;
      resizeCanvases();
      await populateCameraSelect();
      resetCalibration();
      startDetectLoop();

      runtimeStatus.textContent = 'Pose model ready. Step back until your whole body is visible.';
      startCameraButton.textContent = 'Camera Ready';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runtimeStatus.textContent = message;
      startCameraButton.textContent = 'Retry Camera';
      cameraReady = false;
      stopCurrentStream();
    } finally {
      startCameraButton.disabled = false;
      cameraStarting = false;
    }
  }

  async function populateCameraSelect() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      cameraSelect.disabled = true;
      cameraSelect.innerHTML = '<option>No camera API</option>';
      return;
    }

    const devices = await listVideoDevices().catch(() => [] as MediaDeviceInfo[]);
    const cameras = devices.map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Camera ${index + 1}`,
    }));

    cameraSelect.innerHTML = cameras.length
      ? cameras.map((c) => `<option value="${escapeHtml(c.deviceId)}">${escapeHtml(c.label)}</option>`).join('')
      : '<option>Default camera</option>';
    cameraSelect.disabled = cameras.length <= 1;

    if (selectedCameraId && cameras.some((c) => c.deviceId === selectedCameraId)) {
      cameraSelect.value = selectedCameraId;
    }
  }

  function stopCurrentStream() {
    stopStream(currentStream);
    currentStream = null;
    video.srcObject = null;
    cameraReady = false;
  }

  // -- Detect loop -------------------------------------------------------------

  function startDetectLoop() {
    stopDetectLoop();
    detectLoopHandle = window.requestAnimationFrame(detectFrame);
  }

  function stopDetectLoop() {
    if (detectLoopHandle) {
      window.cancelAnimationFrame(detectLoopHandle);
      detectLoopHandle = 0;
    }
  }

  function detectFrame(timestamp: number) {
    if (disposed) return;

    if (!cameraReady || !poseLandmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      detectLoopHandle = window.requestAnimationFrame(detectFrame);
      return;
    }

    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const result = poseLandmarker.detectForVideo(video, timestamp);
      const landmarks: NormalizedLandmark[] | null = result.landmarks[0] ?? null;

      if (landmarks) {
        const signal = analyzePose(landmarks);
        renderSkeleton(landmarks);
        if (gamePhase === 'calibrating') {
          updateCalibration(signal, timestamp);
        } else {
          updateHoleGame(signal, timestamp);
        }
        renderSignal(signal);
        previousSignal = signal;
      } else {
        fitEnteredAt = 0;
        calibrationEnteredAt = 0;
        streak = 0;
        previousSignal = null;
        smoothedMotion = 0;
        clearOverlay();
        renderSignal(emptySignal());
      }
    }

    detectLoopHandle = window.requestAnimationFrame(detectFrame);
  }

  // -- Pose analysis -----------------------------------------------------------

  function visibleLandmark(landmark: NormalizedLandmark | undefined, threshold = 0.48): Point | null {
    if (!landmark || (landmark.visibility ?? 0) < threshold) return null;
    return { x: clamp(landmark.x, 0, 1), y: clamp(landmark.y, 0, 1) };
  }

  function handDelta(next: Point | null, previous: Point | null) {
    if (!next || !previous) return 0;
    return Math.hypot(next.x - previous.x, next.y - previous.y);
  }

  function analyzePose(landmarks: NormalizedLandmark[]): PoseSignal {
    const leftShoulder = landmarks[LANDMARKS.leftShoulder];
    const rightShoulder = landmarks[LANDMARKS.rightShoulder];
    const leftWrist = visibleLandmark(landmarks[LANDMARKS.leftWrist]);
    const rightWrist = visibleLandmark(landmarks[LANDMARKS.rightWrist]);
    const leftHip = landmarks[LANDMARKS.leftHip];
    const rightHip = landmarks[LANDMARKS.rightHip];
    const leftKnee = landmarks[LANDMARKS.leftKnee];
    const rightKnee = landmarks[LANDMARKS.rightKnee];
    const leftKneePoint = visibleLandmark(leftKnee, 0.34);
    const rightKneePoint = visibleLandmark(rightKnee, 0.34);
    const leftAnkle = visibleLandmark(landmarks[LANDMARKS.leftAnkle], 0.34);
    const rightAnkle = visibleLandmark(landmarks[LANDMARKS.rightAnkle], 0.34);

    const visiblePoints = landmarks
      .map((lm) => visibleLandmark(lm, 0.34))
      .filter((p): p is Point => Boolean(p));
    const minY = Math.min(...visiblePoints.map((p) => p.y));
    const maxY = Math.max(...visiblePoints.map((p) => p.y));
    const bodyHeight = visiblePoints.length ? clamp(maxY - minY, 0, 1) : 0;
    const distanceQuality = clamp(1 - Math.abs(bodyHeight - IDEAL_BODY_HEIGHT) / 0.28, 0, 1);
    const fullBodyVisible = Boolean(leftWrist && rightWrist && leftKneePoint && rightKneePoint && leftAnkle && rightAnkle);

    const bodyCenter = {
      x: average([leftShoulder.x, rightShoulder.x, leftHip.x, rightHip.x]),
      y: average([leftShoulder.y, rightShoulder.y, leftHip.y, rightHip.y]),
    };
    const shoulderWidth = Math.max(0.05, Math.abs(leftShoulder.x - rightShoulder.x));
    const shoulderY = average([leftShoulder.y, rightShoulder.y]);
    const hipY = average([leftHip.y, rightHip.y]);
    const kneeY = average([leftKnee.y, rightKnee.y]);

    const leftUp = leftWrist ? clamp((shoulderY - leftWrist.y + 0.02) / 0.24, 0, 1) : 0;
    const rightUp = rightWrist ? clamp((shoulderY - rightWrist.y + 0.02) / 0.24, 0, 1) : 0;
    const leftSpread = leftWrist ? clamp((leftShoulder.x - leftWrist.x) / (shoulderWidth * 1.1), 0, 1) : 0;
    const rightSpread = rightWrist ? clamp((rightWrist.x - rightShoulder.x) / (shoulderWidth * 1.1), 0, 1) : 0;
    const leftLevel = leftWrist ? clamp(1 - Math.abs(leftWrist.y - shoulderY) / 0.22, 0, 1) : 0;
    const rightLevel = rightWrist ? clamp(1 - Math.abs(rightWrist.y - shoulderY) / 0.22, 0, 1) : 0;
    const leftStar = leftWrist ? clamp(((leftShoulder.x - leftWrist.x) / (shoulderWidth * 0.9)) * 0.56 + ((shoulderY - leftWrist.y + 0.08) / 0.34) * 0.44, 0, 1) : 0;
    const rightStar = rightWrist ? clamp(((rightWrist.x - rightShoulder.x) / (shoulderWidth * 0.9)) * 0.56 + ((shoulderY - rightWrist.y + 0.08) / 0.34) * 0.44, 0, 1) : 0;
    const crouchFit = clamp((0.3 - (kneeY - hipY)) / 0.14, 0, 1);

    const fitScores: FitScores = {
      'hands-up': average([leftUp, rightUp]),
      't-pose': average([leftSpread, rightSpread, leftLevel, rightLevel]),
      'right-aim': average([rightSpread, rightLevel]),
      'left-aim': average([leftSpread, leftLevel]),
      crouch: crouchFit,
      star: average([leftStar, rightStar]),
    };

    const flags: PoseFlags = {
      handsUp: fitScores['hands-up'] > 0.76,
      tPose: fitScores['t-pose'] > 0.74,
      rightAim: fitScores['right-aim'] > 0.74,
      leftAim: fitScores['left-aim'] > 0.74,
      crouch: fitScores.crouch > 0.72,
      star: fitScores.star > 0.64,
    };

    const rawMotion = previousSignal
      ? Math.hypot(bodyCenter.x - previousSignal.bodyCenter.x, bodyCenter.y - previousSignal.bodyCenter.y)
        + handDelta(rightWrist, previousSignal.rightHand)
        + handDelta(leftWrist, previousSignal.leftHand)
      : 0;
    smoothedMotion = smoothedMotion * MOTION_SMOOTHING + rawMotion * (1 - MOTION_SMOOTHING);
    const motion = clamp(smoothedMotion * 16, 0, 1);
    const stillness = clamp(1 - motion * 1.45, 0, 1);
    const label = poseLabel(flags, motion);
    const confidence = average(landmarks.map((lm) => lm.visibility ?? 0));

    return {
      present: true,
      confidence,
      label,
      bodyCenter,
      rightHand: rightWrist,
      leftHand: leftWrist,
      bodyHeight,
      distanceQuality,
      fullBodyVisible,
      motion,
      stillness,
      fitScore: 0,
      holdProgress: 0,
      flags,
      fitScores,
    };
  }

  // -- Calibration & game ------------------------------------------------------

  function updateCalibration(signal: PoseSignal, timestamp: number) {
    const ready = signal.fullBodyVisible
      && signal.bodyHeight >= MIN_BODY_HEIGHT
      && signal.bodyHeight <= MAX_BODY_HEIGHT
      && signal.stillness > 0.18;

    if (!ready) {
      calibrationEnteredAt = 0;
      signal.holdProgress = 0;
      return;
    }

    if (!calibrationEnteredAt) calibrationEnteredAt = timestamp;

    signal.holdProgress = clamp((timestamp - calibrationEnteredAt) / CALIBRATION_HOLD_MS, 0, 1);
    if (signal.holdProgress >= 1) {
      startGame();
      signal.holdProgress = 0;
    }
  }

  function updateHoleGame(signal: PoseSignal, timestamp: number) {
    const hole = currentHole();
    signal.fitScore = signal.fitScores[hole.id];
    const fitThreshold = poseFitThreshold(hole);
    const stableEnough = signal.stillness > 0.16 || signal.fitScore > 0.9;
    const fitted = signal.fitScore >= fitThreshold && stableEnough;

    if (!fitted) {
      fitEnteredAt = 0;
      signal.holdProgress = 0;
      if (signal.fitScore < 0.42) streak = 0;
      return;
    }

    if (!fitEnteredAt) fitEnteredAt = timestamp;

    signal.holdProgress = clamp((timestamp - fitEnteredAt) / HOLD_TO_SCORE_MS, 0, 1);
    if (signal.holdProgress >= 1) {
      score += 1 + Math.min(streak, 4);
      streak += 1;
      scoreStatus.textContent = String(score);
      streakStatus.textContent = String(streak);
      persistHighScore();
      flashFit();
      nextHole();
      signal.holdProgress = 0;
    }
  }

  function persistHighScore() {
    try {
      handle.change((doc: MocapDoc) => {
        if (!doc.highScores) doc.highScores = [];
        // Keep top 10 by score
        doc.highScores.push({ score, streak, date: Date.now() });
        doc.highScores.sort((a: any, b: any) => b.score - a.score);
        if (doc.highScores.length > 10) doc.highScores.length = 10;
      });
    } catch {
      // handle may not support change yet
    }
  }

  // -- Rendering ---------------------------------------------------------------

  function renderSignal(signal: PoseSignal) {
    const hole = currentHole();
    const fitThreshold = poseFitThreshold(hole);

    shell.dataset.spell = signal.present && gamePhase === 'playing' ? hole.spell : 'idle';
    arena.dataset.hole = hole.id;
    targetSkeleton.dataset.hole = hole.id;

    arena.style.setProperty('--fit', String(signal.fitScore));
    arena.style.setProperty('--fit-bg-pct', `${12 + signal.fitScore * 16}%`);
    arena.style.setProperty('--fit-border-pct', `${35 + signal.fitScore * 48}%`);
    arena.style.setProperty('--fit-glow-size', `${28 + signal.fitScore * 80}px`);
    arena.style.setProperty('--fit-glow-pct', `${24 + signal.fitScore * 36}%`);
    arena.style.setProperty('--fit-wall-opacity', String(0.14 + signal.fitScore * 0.72));
    arena.style.setProperty('--fit-part-pct', `${28 + signal.fitScore * 60}%`);
    arena.style.setProperty('--fit-part-border-pct', `${35 + signal.fitScore * 45}%`);
    arena.style.setProperty('--fit-part-glow-size', `${12 + signal.fitScore * 34}px`);
    arena.style.setProperty('--fit-part-glow-pct', `${24 + signal.fitScore * 44}%`);
    arena.style.setProperty('--aura-opacity', String(0.32 + signal.fitScore * 0.46));
    arena.style.setProperty('--particle-opacity', String(0.12 + signal.fitScore * 0.58));
    arena.style.setProperty('--particle-duration', `${2.4 - signal.fitScore}s`);
    arena.style.setProperty('--hold', String(signal.holdProgress));

    arena.classList.toggle('is-calibrating', gamePhase === 'calibrating');
    arena.classList.toggle('is-near-fit', gamePhase === 'playing' && signal.fitScore >= fitThreshold);

    personStatus.textContent = signal.present
      ? `${Math.round(signal.confidence * 100)}% tracked`
      : 'No person';
    fitStatus.textContent = gamePhase === 'calibrating'
      ? `${Math.round(signal.distanceQuality * 100)}% distance`
      : `${Math.round(signal.fitScore * 100)}%`;
    poseStatus.textContent = signal.label;
    holdStatus.textContent = `${Math.round(signal.holdProgress * 100)}%`;
    scoreStatus.textContent = String(score);
    streakStatus.textContent = String(streak);

    if (gamePhase === 'calibrating') {
      renderCalibration(signal);
      updateHandCursor(leftHandCursor, signal.leftHand);
      updateHandCursor(rightHandCursor, signal.rightHand);
      updateAura(signal);
      return;
    }

    poseTitle.textContent = signal.present
      ? signal.fitScore >= fitThreshold ? 'Freeze!' : hole.name
      : 'Step into frame';
    poseSubtitle.textContent = signal.present
      ? `${hole.hint} Current read: ${signal.label}.`
      : 'Start the camera, stand back, and keep your whole body visible.';
    poseCommand.textContent = signal.present && signal.fitScore >= fitThreshold ? 'FREEZE!' : hole.command;
    poseCardHint.textContent = signal.present
      ? signal.fitScore >= fitThreshold ? 'Hold still for one beat.' : hole.hint
      : 'Start camera and step fully into frame.';

    updateHandCursor(leftHandCursor, signal.leftHand);
    updateHandCursor(rightHandCursor, signal.rightHand);
    updateAura(signal);
  }

  function renderCalibration(signal: PoseSignal) {
    const status = calibrationStatus(signal);
    const distancePercent = Math.round(signal.distanceQuality * 100);

    poseTitle.textContent = 'Calibrate';
    poseSubtitle.textContent = 'First, stand where the camera can see your whole body at a useful size.';
    poseCommand.textContent = status.command;
    poseCardHint.textContent = status.message;
    calibrationTitle.textContent = status.command;
    calibrationMessage.textContent = status.message;
    calibrationProgress.textContent = signal.present
      ? `${Math.round(signal.holdProgress * 100)}% hold`
      : '0% hold';
    distanceFill.style.width = `${signal.present ? distancePercent : 0}%`;
    calibrationPanel.dataset.status = status.kind;
  }

  function calibrationStatus(signal: PoseSignal) {
    if (!signal.present) {
      return { kind: 'missing', command: 'STEP INTO FRAME', message: 'Stand where the camera can see you.' };
    }
    if (!signal.fullBodyVisible) {
      return { kind: 'body', command: 'SHOW WHOLE BODY', message: 'Move back until your hands, legs, and feet are visible.' };
    }
    if (signal.bodyHeight > MAX_BODY_HEIGHT) {
      return { kind: 'close', command: 'STEP BACK', message: 'You are too close. Make your whole body smaller in the camera.' };
    }
    if (signal.bodyHeight < MIN_BODY_HEIGHT) {
      return { kind: 'far', command: 'STEP CLOSER', message: 'You are too far away. Make your body bigger in the camera.' };
    }
    if (signal.stillness <= 0.18) {
      return { kind: 'moving', command: 'HOLD STILL', message: 'Distance looks good. Freeze for one second to lock it in.' };
    }
    return { kind: 'ready', command: 'HOLD STILL', message: 'Distance looks good. Keep holding to start.' };
  }

  function updateHandCursor(cursor: HTMLElement, hand: Point | null) {
    if (!hand) {
      cursor.classList.remove('is-visible');
      return;
    }
    cursor.classList.add('is-visible');
    cursor.style.left = `${hand.x * 100}%`;
    cursor.style.top = `${hand.y * 100}%`;
  }

  function updateAura(signal: PoseSignal) {
    if (!signal.present) {
      aura.classList.remove('is-visible');
      return;
    }
    aura.classList.add('is-visible');
    aura.style.left = `${signal.bodyCenter.x * 100}%`;
    aura.style.top = `${signal.bodyCenter.y * 100}%`;
    aura.style.setProperty('--aura-scale', String(0.82 + signal.fitScore * 0.82));
  }

  function renderSkeleton(landmarks: NormalizedLandmark[]) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = overlay.clientWidth;
    const height = overlay.clientHeight;

    overlay.width = Math.max(1, Math.floor(width * dpr));
    overlay.height = Math.max(1, Math.floor(height * dpr));
    overlayContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    overlayContext.clearRect(0, 0, width, height);
    overlayContext.lineCap = 'round';
    overlayContext.lineJoin = 'round';

    for (const [from, to] of POSE_CONNECTIONS) {
      const a = visibleLandmark(landmarks[from], 0.38);
      const b = visibleLandmark(landmarks[to], 0.38);
      if (!a || !b) continue;

      overlayContext.strokeStyle = 'rgba(123, 245, 203, 0.9)';
      overlayContext.lineWidth = 5;
      overlayContext.beginPath();
      overlayContext.moveTo(a.x * width, a.y * height);
      overlayContext.lineTo(b.x * width, b.y * height);
      overlayContext.stroke();
    }

    landmarks.forEach((landmark, index) => {
      const point = visibleLandmark(landmark, 0.38);
      if (!point) return;

      const isHand = index === LANDMARKS.leftWrist || index === LANDMARKS.rightWrist;
      overlayContext.fillStyle = isHand ? '#ffd166' : '#f7f3e9';
      overlayContext.strokeStyle = 'rgba(4, 8, 10, 0.72)';
      overlayContext.lineWidth = 2;
      overlayContext.beginPath();
      overlayContext.arc(point.x * width, point.y * height, isHand ? 8 : 5, 0, Math.PI * 2);
      overlayContext.fill();
      overlayContext.stroke();
    });
  }

  function clearOverlay() {
    overlayContext.clearRect(0, 0, overlay.width, overlay.height);
  }

  function renderParticles() {
    particleField.innerHTML = Array.from({ length: PARTICLE_COUNT }, (_, index) => {
      const x = 5 + ((index * 37) % 90);
      const y = 8 + ((index * 53) % 84);
      const delay = -((index * 137) % 1100);
      const size = 4 + (index % 6);
      return `<i style="--x:${x}%;--y:${y}%;--delay:${delay}ms;--size:${size}px"></i>`;
    }).join('');
  }

  // -- Hole / pose helpers -----------------------------------------------------

  function poseLabel(flags: PoseFlags, motion: number) {
    if (flags.star) return 'Star';
    if (flags.tPose) return 'T-Pose';
    if (flags.handsUp) return 'Hands Up';
    if (flags.rightAim) return 'Right Aim';
    if (flags.leftAim) return 'Left Aim';
    if (flags.crouch) return 'Crouch';
    if (motion > 0.34) return 'Moving';
    return 'Ready';
  }

  function currentHole() {
    return HOLE_POSES[currentHoleIndex];
  }

  function poseFitThreshold(hole: HolePose) {
    return hole.id === 'star' ? 0.64 : FIT_THRESHOLD;
  }

  function nextHole() {
    const nextIndex = (currentHoleIndex + 1 + Math.floor(Math.random() * (HOLE_POSES.length - 1))) % HOLE_POSES.length;
    setHole(nextIndex);
  }

  function setHole(index: number) {
    currentHoleIndex = index;
    fitEnteredAt = 0;
    const hole = currentHole();
    holeWall.dataset.hole = hole.id;
    targetSkeleton.dataset.hole = hole.id;
    arena.dataset.hole = hole.id;
    poseTitle.textContent = hole.name;
    poseSubtitle.textContent = hole.hint;
    poseCommand.textContent = hole.command;
    poseCardHint.textContent = hole.hint;
  }

  function resetCalibration() {
    gamePhase = 'calibrating';
    calibrationEnteredAt = 0;
    fitEnteredAt = 0;
    streak = 0;
    arena.classList.add('is-calibrating');
    resetTargetButton.textContent = 'Skip Calibration';
    runtimeStatus.textContent = 'Calibration: stand back until your whole body is visible.';
  }

  function startGame() {
    gamePhase = 'playing';
    calibrationEnteredAt = 0;
    fitEnteredAt = 0;
    arena.classList.remove('is-calibrating');
    resetTargetButton.textContent = 'New Shape';
    runtimeStatus.textContent = 'Game ready. Match the big prompt, then freeze.';
    setHole(currentHoleIndex);
  }

  function flashFit() {
    fitFlash.classList.remove('is-visible');
    void fitFlash.offsetWidth;
    fitFlash.classList.add('is-visible');
    window.setTimeout(() => fitFlash.classList.remove('is-visible'), 580);
  }

  function emptySignal(): PoseSignal {
    return {
      present: false,
      confidence: 0,
      label: 'None',
      bodyCenter: { x: 0.5, y: 0.5 },
      rightHand: null,
      leftHand: null,
      bodyHeight: 0,
      distanceQuality: 0,
      fullBodyVisible: false,
      motion: 0,
      stillness: 1,
      fitScore: 0,
      holdProgress: 0,
      flags: { handsUp: false, tPose: false, rightAim: false, leftAim: false, crouch: false, star: false },
      fitScores: { 'hands-up': 0, 't-pose': 0, 'right-aim': 0, 'left-aim': 0, crouch: 0, star: 0 },
    };
  }

  // -- Fullscreen --------------------------------------------------------------

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

  // -- Background canvas -------------------------------------------------------

  function resizeCanvases() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = element.clientWidth || window.innerWidth;
    const height = element.clientHeight || window.innerHeight;

    backgroundCanvas.width = Math.floor(width * dpr);
    backgroundCanvas.height = Math.floor(height * dpr);
    backgroundCanvas.style.width = `${width}px`;
    backgroundCanvas.style.height = `${height}px`;
    backgroundContext.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (video.videoWidth && video.videoHeight) {
      video.parentElement?.style.setProperty('--camera-aspect', `${video.videoWidth} / ${video.videoHeight}`);
    }
  }

  function drawBackground(timestamp: number) {
    if (disposed) return;

    const width = element.clientWidth || window.innerWidth;
    const height = element.clientHeight || window.innerHeight;
    const time = timestamp * 0.001;

    backgroundContext.clearRect(0, 0, width, height);
    const gradient = backgroundContext.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#10151d');
    gradient.addColorStop(0.5, '#1d2c27');
    gradient.addColorStop(1, '#111827');
    backgroundContext.fillStyle = gradient;
    backgroundContext.fillRect(0, 0, width, height);

    backgroundContext.save();
    backgroundContext.globalCompositeOperation = 'screen';
    for (let index = 0; index < 10; index += 1) {
      const x = width * ((index + 0.3) / 10) + Math.sin(time * 0.32 + index) * 58;
      const y = height * (0.16 + (index % 4) * 0.2) + Math.cos(time * 0.35 + index) * 45;
      const radius = 190 + (index % 3) * 88;
      const glow = backgroundContext.createRadialGradient(x, y, 0, x, y, radius);
      glow.addColorStop(0, index % 2 === 0 ? 'rgba(123,245,203,0.16)' : 'rgba(255,209,102,0.14)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      backgroundContext.fillStyle = glow;
      backgroundContext.fillRect(0, 0, width, height);
    }
    backgroundContext.restore();

    bgAnimHandle = requestAnimationFrame(drawBackground);
  }

  // -- Event wiring ------------------------------------------------------------

  startCameraButton.addEventListener('click', () => void startCamera());

  cameraSelect.addEventListener('change', () => {
    if (cameraSelect.value) void startCamera(cameraSelect.value);
  });

  resetTargetButton.addEventListener('click', () => {
    if (gamePhase === 'calibrating') {
      startGame();
      return;
    }
    nextHole();
  });

  skipCalibrationButton.addEventListener('click', () => startGame());

  fullscreenButton.addEventListener('click', () => void toggleFullscreen());

  const onResize = () => resizeCanvases();
  const onFullscreenChange = () => syncFullscreenButton();

  window.addEventListener('resize', onResize);
  document.addEventListener('fullscreenchange', onFullscreenChange);

  // -- Init --------------------------------------------------------------------

  resizeCanvases();
  renderParticles();
  setHole(0);
  renderSignal(emptySignal());
  bgAnimHandle = requestAnimationFrame(drawBackground);

  void populateCameraSelect();
  syncFullscreenButton();

  // -- Cleanup -----------------------------------------------------------------

  return () => {
    disposed = true;
    stopDetectLoop();
    stopCurrentStream();

    if (bgAnimHandle) {
      cancelAnimationFrame(bgAnimHandle);
      bgAnimHandle = 0;
    }

    poseLandmarker?.close();
    poseLandmarker = null;

    window.removeEventListener('resize', onResize);
    document.removeEventListener('fullscreenchange', onFullscreenChange);

    element.innerHTML = '';
  };
}
