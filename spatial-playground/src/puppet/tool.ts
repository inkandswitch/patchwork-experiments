import { listVideoDevices, buildVideoConstraints, waitForVideoReady, stopStream } from '../shared/camera.ts';
import { escapeHtml } from '../shared/utils.ts';
import type { PuppetDoc, RecordedFrame } from '../types.ts';

type Vec3 = { x: number; y: number; z: number };

type NormalizedLandmark = { x: number; y: number; z: number; visibility?: number };

type AvatarRecord = {
  id: string;
  name: string;
  project_id: string;
  model_file_url: string;
  thumbnail_url?: string;
};

type AvatarOption = {
  id: string;
  label: string;
  project: string;
  url: string;
};

type LandmarkRef = number | [number, number];

type VrmMotionTarget = {
  bone: import('three').Object3D;
  from: LandmarkRef;
  to: LandmarkRef;
  restDirection: import('three').Vector3;
  restWorldQuaternion: import('three').Quaternion;
};

type VrmRig = {
  vrm: import('@pixiv/three-vrm').VRM;
  targets: VrmMotionTarget[];
};

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const AVATAR_FILES = [
  '100avatars-r1.json',
  '100avatars-r2.json',
  '100avatars-r3.json',
];
const AVATAR_BASE_URL = 'https://raw.githubusercontent.com/ToxSam/open-source-avatars/main/data/avatars/';

const LANDMARKS = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

const CONNECTIONS: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28],
];

const STYLE = `
.puppet-shell {
  --ink: #f8f1df;
  --muted: rgba(248, 241, 223, 0.68);
  --panel: rgba(8, 13, 17, 0.78);
  --line: rgba(248, 241, 223, 0.16);
  --hot: #ff8f5b;
  --mint: #8fffe0;
  --gold: #ffd36f;
  font-family: "Trebuchet MS", "Segoe UI", sans-serif;
  color: var(--ink);
  background:
    radial-gradient(circle at 24% 18%, rgba(143, 255, 224, 0.16), transparent 30%),
    radial-gradient(circle at 82% 26%, rgba(255, 143, 91, 0.13), transparent 28%),
    linear-gradient(135deg, #071013, #141b1b 58%, #0a1016);
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  margin: 0;
  overflow: hidden;
  min-height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 14px;
  padding: 14px;
}

.puppet-shell * {
  box-sizing: border-box;
}

.puppet-shell button,
.puppet-shell select,
.puppet-shell a {
  color: inherit;
  font: inherit;
}

.topbar {
  position: relative;
  z-index: 3;
  display: grid;
  grid-template-columns: repeat(6, auto) minmax(180px, 1fr) minmax(180px, 1fr) repeat(5, auto);
  gap: 10px;
  align-items: center;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: rgba(8, 13, 17, 0.84);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(16px);
}

.nav-action,
.control-button,
.primary-button,
.camera-select,
.avatar-select {
  min-height: 44px;
  border: 1px solid rgba(248, 241, 223, 0.18);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  text-decoration: none;
  padding: 10px 14px;
}

.nav-action:hover,
.control-button:hover,
.camera-select:hover {
  border-color: rgba(248, 241, 223, 0.34);
}

.primary-button {
  border-color: rgba(255, 211, 111, 0.44);
  color: #16120a;
  background: linear-gradient(135deg, #ffda78, #ff9a66);
  font-weight: 900;
}

.control-button.active {
  border-color: rgba(143, 255, 224, 0.7);
  background: rgba(143, 255, 224, 0.16);
}

.camera-select {
  min-width: 220px;
  color: var(--ink);
}

.avatar-select {
  min-width: 220px;
  color: var(--ink);
}

.experience {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(340px, 0.65fr);
  gap: 14px;
}

.stage-panel,
.sensor-panel,
.timeline-panel {
  border: 1px solid var(--line);
  border-radius: 20px;
  background: var(--panel);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}

.stage-panel {
  position: relative;
  min-height: 0;
}

.robot-stage {
  width: 100%;
  height: 100%;
  display: block;
}

.stage-hud {
  position: absolute;
  inset: 18px auto auto 18px;
  max-width: 520px;
  pointer-events: none;
}

.eyebrow {
  margin: 0 0 8px;
  color: var(--gold);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-size: 0.78rem;
  font-weight: 900;
}

.puppet-shell h1 {
  margin: 0;
  font-size: clamp(3rem, 7vw, 7.8rem);
  line-height: 0.82;
  letter-spacing: -0.08em;
  text-shadow: 0 12px 38px rgba(0, 0, 0, 0.45);
}

.stage-hud p:last-child {
  max-width: 42rem;
  margin: 14px 0 0;
  color: var(--muted);
  line-height: 1.35;
}

.record-dot {
  position: absolute;
  inset: 20px 20px auto auto;
  display: inline-flex;
  gap: 9px;
  align-items: center;
  padding: 10px 13px;
  border: 1px solid rgba(255, 143, 91, 0.32);
  border-radius: 999px;
  color: rgba(248, 241, 223, 0.9);
  background: rgba(10, 8, 8, 0.58);
}

.record-dot::before {
  content: "";
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #46372d;
}

.record-dot.is-recording::before {
  background: #ff4f3e;
  box-shadow: 0 0 22px #ff4f3e;
  animation: pulse 900ms ease-in-out infinite;
}

.side-stack {
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 14px;
}

.sensor-panel {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
}

.camera-frame {
  position: relative;
  min-height: 0;
  margin: 12px;
  border-radius: 16px;
  overflow: hidden;
  background: #020405;
}

.puppet-camera,
.pose-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.pose-overlay {
  pointer-events: none;
}

.readouts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  padding: 0 12px 12px;
}

.readout {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.04);
}

.readout span {
  display: block;
  color: var(--muted);
  font-size: 0.78rem;
}

.readout strong {
  display: block;
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timeline-panel {
  padding: 14px;
}

.timeline-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: baseline;
  margin-bottom: 10px;
}

.timeline-head strong {
  font-size: 1.15rem;
}

.timeline-head span {
  color: var(--muted);
}

.timeline-track {
  position: relative;
  height: 46px;
  overflow: hidden;
  border: 1px solid rgba(248, 241, 223, 0.12);
  border-radius: 999px;
  background:
    linear-gradient(90deg, transparent 0 9%, rgba(143, 255, 224, 0.16) 9% 10%, transparent 10% 19%, rgba(255, 211, 111, 0.16) 19% 20%, transparent 20%),
    rgba(255, 255, 255, 0.04);
  background-size: 20% 100%;
}

.timeline-fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0%;
  background: linear-gradient(90deg, rgba(143, 255, 224, 0.28), rgba(255, 143, 91, 0.2));
  transition: width 80ms linear;
}

.timeline-playhead {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 0%;
  width: 3px;
  border-radius: 999px;
  background: var(--ink);
  box-shadow: 0 0 18px rgba(248, 241, 223, 0.82);
}

@keyframes pulse {
  0%, 100% { opacity: 0.45; transform: scale(0.84); }
  50% { opacity: 1; transform: scale(1.12); }
}

@media (max-width: 1180px) {
  .puppet-shell {
    overflow: auto;
    min-height: 100%;
  }

  .topbar {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .experience {
    grid-template-columns: 1fr;
  }

  .stage-panel {
    min-height: 62%;
  }

  .side-stack {
    min-height: 76%;
  }
}

@media (max-width: 680px) {
  .topbar {
    grid-template-columns: 1fr 1fr;
  }

  .camera-select {
    min-width: 0;
  }

  .readouts {
    grid-template-columns: 1fr;
  }
}
`;

export default function PuppetTool(handle: any, element: HTMLElement) {
  /* ── DOM ───────────────────────────────────────────────── */

  element.innerHTML = `
    <main class="puppet-shell">
      <header class="topbar">
        <select id="camera-select" class="camera-select" aria-label="Camera"></select>
        <select id="avatar-select" class="avatar-select" aria-label="Avatar">
          <option>Loading avatars...</option>
        </select>
        <button id="start-camera" class="primary-button" type="button">Start Camera</button>
        <button id="record" class="control-button" type="button">Record</button>
        <button id="replay" class="control-button" type="button">Replay</button>
        <button id="clear" class="control-button" type="button">Clear</button>
        <button id="fullscreen" class="control-button" type="button">Fullscreen</button>
      </header>

      <section class="experience">
        <section class="stage-panel">
          <canvas id="robot-stage" class="robot-stage"></canvas>
          <div class="stage-hud">
            <p class="eyebrow">VRM Avatar Puppet</p>
            <h1 id="mode-title">Live mocap</h1>
            <p id="mode-detail">Choose a CC0 100Avatars VRM, record your body motion, then replay it on that avatar.</p>
          </div>
          <div id="record-dot" class="record-dot">Idle</div>
        </section>

        <section class="side-stack">
          <aside class="sensor-panel">
            <div class="camera-frame">
              <video id="camera" class="puppet-camera" autoplay muted playsinline></video>
              <canvas id="pose-overlay" class="pose-overlay"></canvas>
            </div>
            <div class="readouts">
              <div class="readout">
                <span>Pose</span>
                <strong id="pose-status">Waiting</strong>
              </div>
              <div class="readout">
                <span>Recording</span>
                <strong id="record-status">0 frames</strong>
              </div>
              <div class="readout">
                <span>Avatar</span>
                <strong id="model-status">Loading list</strong>
              </div>
            </div>
          </aside>

          <aside class="timeline-panel">
            <div class="timeline-head">
              <strong>Captured Motion</strong>
              <span id="duration-label">0.0s</span>
            </div>
            <div class="timeline-track">
              <i id="timeline-fill" class="timeline-fill"></i>
              <i id="timeline-playhead" class="timeline-playhead"></i>
            </div>
          </aside>
        </section>
      </section>
    </main>
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  element.prepend(styleEl);
  element.style.position = 'relative';
  element.style.overflow = 'hidden';

  const q = <T extends Element>(sel: string) => element.querySelector<T>(sel)!;

  const video = q<HTMLVideoElement>('#camera');
  const overlay = q<HTMLCanvasElement>('#pose-overlay');
  const overlayContext = overlay.getContext('2d')!;
  const cameraSelect = q<HTMLSelectElement>('#camera-select');
  const avatarSelect = q<HTMLSelectElement>('#avatar-select');
  const startButton = q<HTMLButtonElement>('#start-camera');
  const recordButton = q<HTMLButtonElement>('#record');
  const replayButton = q<HTMLButtonElement>('#replay');
  const clearButton = q<HTMLButtonElement>('#clear');
  const fullscreenButton = q<HTMLButtonElement>('#fullscreen');
  const modeTitle = q<HTMLHeadingElement>('#mode-title');
  const modeDetail = q<HTMLParagraphElement>('#mode-detail');
  const recordDot = q<HTMLDivElement>('#record-dot');
  const poseStatus = q<HTMLElement>('#pose-status');
  const recordStatus = q<HTMLElement>('#record-status');
  const modelStatus = q<HTMLElement>('#model-status');
  const durationLabel = q<HTMLElement>('#duration-label');
  const timelineFill = q<HTMLElement>('#timeline-fill');
  const timelinePlayhead = q<HTMLElement>('#timeline-playhead');
  const stageCanvas = q<HTMLCanvasElement>('#robot-stage');

  /* ── Heavy dynamic imports ─────────────────────────────── */

  let THREE: typeof import('three');
  let GLTFLoader: typeof import('three/examples/jsm/loaders/GLTFLoader.js').GLTFLoader;
  let VRM: typeof import('@pixiv/three-vrm').VRM;
  let VRMHumanBoneName: typeof import('@pixiv/three-vrm').VRMHumanBoneName;
  let VRMLoaderPlugin: typeof import('@pixiv/three-vrm').VRMLoaderPlugin;
  let VRMUtils: typeof import('@pixiv/three-vrm').VRMUtils;
  let PoseLandmarker: typeof import('@mediapipe/tasks-vision').PoseLandmarker;
  let FilesetResolver: typeof import('@mediapipe/tasks-vision').FilesetResolver;

  /* ── Mutable state ─────────────────────────────────────── */

  let disposed = false;
  let stream: MediaStream | null = null;
  let landmarker: import('@mediapipe/tasks-vision').PoseLandmarker | null = null;
  let lastVideoTime = -1;
  let latestLandmarks: NormalizedLandmark[] | null = null;
  let cameraRunning = false;
  let isRecording = false;
  let isCountingDown = false;
  let countdownStart = 0;
  let countdownTimer = 0;
  let isReplaying = false;
  let recordStart = 0;
  let replayStart = 0;
  let recordedFrames: RecordedFrame[] = [];
  let activeLandmarks: NormalizedLandmark[] | null = null;
  let smoothedPoints: Map<number, Vec3> = new Map();
  let avatarCatalog: AvatarOption[] = [];
  let currentAvatar: import('@pixiv/three-vrm').VRM | null = null;
  let currentRig: VrmRig | null = null;
  let lastRenderTime = performance.now();
  let rafId = 0;
  let scanRafId = 0;

  // Three.js objects (initialised after dynamic import)
  let scene: import('three').Scene;
  let renderer: import('three').WebGLRenderer;
  let threeCamera: import('three').PerspectiveCamera;
  let avatarRoot: import('three').Group;
  let gltfLoader: InstanceType<typeof import('three/examples/jsm/loaders/GLTFLoader.js').GLTFLoader>;

  /* ── Hydrate from doc ──────────────────────────────────── */

  const doc: PuppetDoc | undefined = handle.doc?.();
  if (doc?.recordedFrames?.length) {
    recordedFrames = doc.recordedFrames;
  }

  /* ── Persist helpers ───────────────────────────────────── */

  function persistRecording() {
    handle.change((doc: PuppetDoc) => {
      doc.recordedFrames = recordedFrames;
    });
  }

  function persistAvatarUrl(url: string) {
    handle.change((doc: PuppetDoc) => {
      doc.avatarUrl = url;
    });
  }

  /* ── Init (async) ──────────────────────────────────────── */

  const initPromise = init();

  async function init() {
    // Dynamic imports
    const [threeModule, gltfModule, vrmModule, mediapipeModule] = await Promise.all([
      import('three'),
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('@pixiv/three-vrm'),
      import('@mediapipe/tasks-vision'),
    ]);

    if (disposed) return;

    THREE = threeModule;
    GLTFLoader = gltfModule.GLTFLoader;
    VRM = vrmModule.VRM;
    VRMHumanBoneName = vrmModule.VRMHumanBoneName;
    VRMLoaderPlugin = vrmModule.VRMLoaderPlugin;
    VRMUtils = vrmModule.VRMUtils;
    PoseLandmarker = mediapipeModule.PoseLandmarker;
    FilesetResolver = mediapipeModule.FilesetResolver;

    // Three.js scene
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x071013, 0.07);
    renderer = new THREE.WebGLRenderer({ canvas: stageCanvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    threeCamera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    threeCamera.position.set(0, 1.35, 5.4);
    avatarRoot = new THREE.Group();
    avatarRoot.position.set(0, -1.7, 0);
    avatarRoot.rotation.y = Math.PI;
    scene.add(avatarRoot);

    gltfLoader = new GLTFLoader();
    gltfLoader.setCrossOrigin('anonymous');
    gltfLoader.register((parser: any) => new VRMLoaderPlugin(parser));

    setupLights();
    setupEnvironment();
    resizeStage();
    void refreshCameras();
    void loadAvatarCatalog();
    rafId = requestAnimationFrame(render);
  }

  /* ── Event listeners ───────────────────────────────────── */

  startButton.addEventListener('click', () => {
    void startCamera();
  });

  cameraSelect.addEventListener('change', () => {
    if (cameraRunning) void startCamera();
  });

  avatarSelect.addEventListener('change', () => {
    const avatar = avatarCatalog.find((o) => o.id === avatarSelect.value);
    if (avatar) void loadAvatar(avatar);
  });

  recordButton.addEventListener('click', () => {
    if (!cameraRunning) void startCamera();
    if (isRecording) { stopRecording(); return; }
    if (isCountingDown) { cancelCountdown(); return; }
    isReplaying = false;
    startCountdown();
  });

  replayButton.addEventListener('click', () => {
    if (recordedFrames.length === 0) {
      updateMode('No recording yet', 'Press Record, perform a short movement, then replay it on the selected avatar.');
      return;
    }
    if (isReplaying) {
      isReplaying = false;
      replayButton.classList.remove('active');
      updateMode('Live mocap', 'Replay stopped. Move in front of the camera to drive the avatar live.');
      return;
    }
    isRecording = false;
    cancelCountdown();
    isReplaying = true;
    replayStart = performance.now();
    recordButton.classList.remove('active');
    recordButton.textContent = 'Record';
    replayButton.classList.add('active');
    recordDot.classList.remove('is-recording');
    updateMode('Replay loop', 'Your captured motion is now looping on the selected VRM avatar.');
  });

  clearButton.addEventListener('click', () => {
    recordedFrames = [];
    isRecording = false;
    cancelCountdown();
    isReplaying = false;
    recordButton.classList.remove('active');
    recordButton.textContent = 'Record';
    replayButton.classList.remove('active');
    recordDot.classList.remove('is-recording');
    timelineFill.style.width = '0%';
    timelinePlayhead.style.left = '0%';
    updateMode('Live mocap', 'Recording cleared. Capture a new avatar performance.');
    updateRecordingReadout();
    persistRecording();
  });

  fullscreenButton.addEventListener('click', () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void element.requestFullscreen();
  });

  const onResize = () => resizeStage();
  window.addEventListener('resize', onResize);

  /* ── Avatar catalog ────────────────────────────────────── */

  async function loadAvatarCatalog() {
    try {
      const collections = await Promise.all(
        AVATAR_FILES.map(async (file) => {
          const avatars = await fetch(`${AVATAR_BASE_URL}${file}`).then((r) => r.json() as Promise<AvatarRecord[]>);
          return avatars.map<AvatarOption>((a) => ({
            id: a.id ?? `${a.project_id}:${a.name}`,
            label: `${a.project_id.replace('100avatars-', '').toUpperCase()} - ${a.name}`,
            project: a.project_id,
            url: a.model_file_url,
          }));
        }),
      );
      if (disposed) return;
      avatarCatalog = collections.flat();
      avatarSelect.innerHTML = avatarCatalog
        .map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.label)}</option>`)
        .join('');
      modelStatus.textContent = `${avatarCatalog.length} VRMs`;

      // If doc already has a saved avatar URL, try to select it
      const savedUrl = doc?.avatarUrl;
      const savedAvatar = savedUrl ? avatarCatalog.find((a) => a.url === savedUrl) : null;
      const firstAvatar = savedAvatar ?? avatarCatalog[0];

      if (firstAvatar) {
        avatarSelect.value = firstAvatar.id;
        await loadAvatar(firstAvatar);
      }
    } catch (error) {
      console.error(error);
      modelStatus.textContent = 'List failed';
      updateMode('Avatar list failed', 'The GitHub metadata could not load. Check network access and reload this page.');
    }
  }

  async function loadAvatar(avatar: AvatarOption) {
    modelStatus.textContent = 'Loading VRM';
    updateMode('Loading avatar', avatar.label);
    disposeCurrentAvatar();

    try {
      const vrm = await new Promise<import('@pixiv/three-vrm').VRM>((resolve, reject) => {
        gltfLoader.load(
          avatar.url,
          (gltf: any) => {
            const loadedVrm = gltf.userData.vrm as import('@pixiv/three-vrm').VRM | undefined;
            if (!loadedVrm) { reject(new Error('No VRM data found in file')); return; }
            resolve(loadedVrm);
          },
          undefined,
          reject,
        );
      });

      if (disposed) return;

      VRMUtils.rotateVRM0(vrm);
      currentAvatar = vrm;
      prepareAvatar(vrm);
      avatarRoot.add(vrm.scene);
      currentRig = createVrmRig(vrm);
      modelStatus.textContent = currentRig ? avatar.label : 'Rig missing';
      updateMode('Live mocap', `Playing with ${avatar.label}. Press Record for a five second countdown.`);
      persistAvatarUrl(avatar.url);
    } catch (error) {
      console.error(error);
      modelStatus.textContent = 'Load failed';
      updateMode('Avatar failed', 'This VRM did not load through the browser. Try another avatar from the list.');
    }
  }

  function disposeCurrentAvatar() {
    if (!currentAvatar) return;
    avatarRoot.remove(currentAvatar.scene);
    VRMUtils.deepDispose(currentAvatar.scene);
    currentAvatar = null;
    currentRig = null;
    smoothedPoints = new Map();
  }

  function prepareAvatar(vrm: import('@pixiv/three-vrm').VRM) {
    vrm.scene.traverse((child: any) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.frustumCulled = false;
      }
    });

    vrm.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const size = box.getSize(new THREE.Vector3());
    const scale = size.y > 0 ? 2.95 / size.y : 1;
    vrm.scene.scale.setScalar(scale);
    vrm.scene.updateMatrixWorld(true);
    const scaledBox = new THREE.Box3().setFromObject(vrm.scene);
    const center = scaledBox.getCenter(new THREE.Vector3());
    vrm.scene.position.x -= center.x;
    vrm.scene.position.z -= center.z;
    vrm.scene.position.y -= scaledBox.min.y;
    vrm.scene.updateMatrixWorld(true);
  }

  /* ── Camera / Pose ─────────────────────────────────────── */

  async function startCamera() {
    startButton.textContent = 'Starting...';
    startButton.disabled = true;

    try {
      landmarker ??= await createLandmarker();
      stopStream(stream);
      const deviceId = cameraSelect.value;
      stream = await navigator.mediaDevices.getUserMedia({
        video: buildVideoConstraints(deviceId || null, { width: 1280, height: 720 }),
        audio: false,
      });
      video.srcObject = stream;
      await waitForVideoReady(video);
      await video.play();
      cameraRunning = true;
      startButton.textContent = 'Camera Ready';
      await refreshCameras();
      scanRafId = requestAnimationFrame(scanPose);
    } catch (error) {
      console.error(error);
      startButton.textContent = 'Camera Failed';
      updateMode('Camera blocked', 'Allow camera access in the browser, then press Start Camera again.');
    } finally {
      startButton.disabled = false;
    }
  }

  async function refreshCameras() {
    try {
      const devices = await listVideoDevices();
      const cameras = devices.map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Camera ${index + 1}`,
      }));

      const current = cameraSelect.value;
      cameraSelect.innerHTML = cameras
        .map((o) => `<option value="${o.deviceId}">${escapeHtml(o.label)}</option>`)
        .join('');

      if (cameras.some((o) => o.deviceId === current)) {
        cameraSelect.value = current;
      }
    } catch { /* ignore */ }
  }

  async function createLandmarker() {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    return PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.48,
      minPosePresenceConfidence: 0.48,
      minTrackingConfidence: 0.44,
    });
  }

  function scanPose() {
    if (disposed || !cameraRunning || !landmarker) return;

    if (video.currentTime !== lastVideoTime && video.videoWidth > 0 && video.videoHeight > 0) {
      lastVideoTime = video.currentTime;
      const result = landmarker.detectForVideo(video, performance.now());
      latestLandmarks = (result.landmarks[0] as NormalizedLandmark[] | undefined) ?? null;
      drawOverlay(latestLandmarks);

      if (latestLandmarks && isRecording) {
        recordedFrames.push({
          t: performance.now() - recordStart,
          landmarks: cloneLandmarks(latestLandmarks),
        });
      }
    }

    scanRafId = requestAnimationFrame(scanPose);
  }

  /* ── Render loop ───────────────────────────────────────── */

  function render(now: number) {
    if (disposed) return;

    resizeStage();
    const deltaSeconds = Math.min(0.05, (now - lastRenderTime) / 1000);
    lastRenderTime = now;
    activeLandmarks = chooseActiveLandmarks(now);

    if (activeLandmarks) {
      applyPose(activeLandmarks);
      poseStatus.textContent = isReplaying ? 'Replay' : 'Tracked';
    } else {
      idleAvatar(now);
      poseStatus.textContent = cameraRunning ? 'Searching' : 'Waiting';
    }

    currentAvatar?.update(deltaSeconds);
    updateRecordingReadout(now);
    renderer.render(scene, threeCamera);
    rafId = requestAnimationFrame(render);
  }

  function chooseActiveLandmarks(now: number) {
    if (!isReplaying) return latestLandmarks;

    const duration = getRecordingDuration();
    if (duration <= 0 || recordedFrames.length === 0) return latestLandmarks;

    const t = (now - replayStart) % duration;
    const frame = recordedFrames.find((f) => f.t >= t) ?? recordedFrames[recordedFrames.length - 1];
    const progress = Math.min(1, t / duration);
    timelinePlayhead.style.left = `${progress * 100}%`;
    return frame.landmarks as NormalizedLandmark[];
  }

  /* ── Recording ─────────────────────────────────────────── */

  function stopRecording() {
    isRecording = false;
    recordButton.classList.remove('active');
    recordButton.textContent = 'Record';
    recordDot.classList.remove('is-recording');
    updateMode('Captured', 'Press Replay to loop the captured movement on the avatar.');
    updateRecordingReadout();
    persistRecording();
  }

  function startCountdown() {
    isCountingDown = true;
    countdownStart = performance.now();
    window.clearInterval(countdownTimer);
    countdownTimer = window.setInterval(updateCountdown, 120);
    recordButton.classList.add('active');
    recordButton.textContent = 'Cancel';
    replayButton.classList.remove('active');
    recordDot.classList.remove('is-recording');
    timelineFill.style.width = '0%';
    timelinePlayhead.style.left = '0%';
    updateCountdown();
  }

  function updateCountdown() {
    const elapsed = performance.now() - countdownStart;
    if (elapsed >= 5000) {
      window.clearInterval(countdownTimer);
      isCountingDown = false;
      beginRecording();
      return;
    }
    const remaining = Math.ceil((5000 - elapsed) / 1000);
    recordDot.textContent = `Recording in ${remaining}`;
    updateMode(`${remaining}`, 'Get into position. Recording starts after the countdown.');
  }

  function beginRecording() {
    isRecording = true;
    recordStart = performance.now();
    recordedFrames = [];
    recordButton.classList.add('active');
    recordButton.textContent = 'Stop';
    replayButton.classList.remove('active');
    recordDot.classList.add('is-recording');
    timelineFill.style.width = '0%';
    timelinePlayhead.style.left = '0%';
    updateMode('Recording', 'Move clearly. The avatar will replay this exact captured landmark motion.');
  }

  function cancelCountdown() {
    if (!isCountingDown) return;
    window.clearInterval(countdownTimer);
    isCountingDown = false;
    recordButton.classList.remove('active');
    recordButton.textContent = 'Record';
    recordDot.textContent = isReplaying ? 'Replay' : 'Idle';
    updateMode('Live mocap', 'Countdown cancelled. Press Record when you are ready.');
  }

  /* ── UI helpers ────────────────────────────────────────── */

  function updateMode(title: string, detail: string) {
    modeTitle.textContent = title;
    modeDetail.textContent = detail;
  }

  function updateRecordingReadout(now = performance.now()) {
    const duration = getRecordingDuration();
    const liveDuration = isCountingDown ? 0 : isRecording ? now - recordStart : duration;
    const seconds = liveDuration / 1000;
    recordStatus.textContent = `${recordedFrames.length} frames`;
    durationLabel.textContent = `${seconds.toFixed(1)}s`;
    const countdownProgress = Math.min(100, ((now - countdownStart) / 5000) * 100);
    timelineFill.style.width = isCountingDown ? `${countdownProgress}%` : duration > 0 ? '100%' : `${Math.min(100, seconds * 18)}%`;
    if (!isReplaying) {
      timelinePlayhead.style.left = isCountingDown ? `${countdownProgress}%` : isRecording ? `${(Math.sin(now * 0.006) * 0.5 + 0.5) * 100}%` : '0%';
    }
    if (!isCountingDown) {
      recordDot.textContent = isRecording ? 'Recording' : isReplaying ? 'Replay' : 'Idle';
    }
  }

  function getRecordingDuration() {
    return recordedFrames.at(-1)?.t ?? 0;
  }

  /* ── Pose helpers ──────────────────────────────────────── */

  function cloneLandmarks(landmarks: NormalizedLandmark[]): NormalizedLandmark[] {
    return landmarks.map((l) => ({ ...l }));
  }

  function drawOverlay(landmarks: NormalizedLandmark[] | null) {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width === 0 || height === 0) return;

    overlay.width = width;
    overlay.height = height;
    overlayContext.clearRect(0, 0, width, height);
    overlayContext.lineWidth = Math.max(4, width * 0.004);
    overlayContext.lineCap = 'round';
    overlayContext.strokeStyle = 'rgba(143, 255, 224, 0.95)';
    overlayContext.fillStyle = 'rgba(255, 211, 111, 0.95)';

    if (!landmarks) return;

    for (const [fromIndex, toIndex] of CONNECTIONS) {
      const from = landmarks[fromIndex];
      const to = landmarks[toIndex];
      if (!isVisible(from) || !isVisible(to)) continue;
      overlayContext.beginPath();
      overlayContext.moveTo(from.x * width, from.y * height);
      overlayContext.lineTo(to.x * width, to.y * height);
      overlayContext.stroke();
    }

    for (const landmark of landmarks) {
      if (!isVisible(landmark)) continue;
      overlayContext.beginPath();
      overlayContext.arc(landmark.x * width, landmark.y * height, Math.max(4, width * 0.005), 0, Math.PI * 2);
      overlayContext.fill();
    }
  }

  function applyPose(landmarks: NormalizedLandmark[]) {
    const points = new Map<number, Vec3>();
    for (const index of Object.values(LANDMARKS)) {
      const landmark = landmarks[index];
      if (isVisible(landmark)) {
        points.set(index, smoothPoint(index, landmarkToWorld(landmark)));
      }
    }

    const leftShoulder = points.get(LANDMARKS.leftShoulder);
    const rightShoulder = points.get(LANDMARKS.rightShoulder);
    const leftHip = points.get(LANDMARKS.leftHip);
    const rightHip = points.get(LANDMARKS.rightHip);
    if (leftShoulder && rightShoulder && leftHip && rightHip) {
      const center = midpoint(midpoint(leftShoulder, rightShoulder), midpoint(leftHip, rightHip));
      avatarRoot.position.x = -center.x * 0.12;
    }

    applyVrmPose(points);
  }

  function applyVrmPose(points: Map<number, Vec3>) {
    if (!currentRig) return;

    currentRig.vrm.humanoid.resetNormalizedPose();
    currentRig.vrm.scene.updateMatrixWorld(true);

    for (const target of currentRig.targets) {
      const from = pointFromRef(target.from, points);
      const to = pointFromRef(target.to, points);
      if (!from || !to) continue;

      const desiredDirection = vectorFromPoints(from, to);
      if (desiredDirection.lengthSq() < 0.0001) continue;

      aimBoneAtDirection(target, desiredDirection.normalize());
      target.bone.updateMatrixWorld(true);
    }

    currentRig.vrm.humanoid.update();
  }

  function idleAvatar(now: number) {
    if (!currentRig || activeLandmarks) return;

    currentRig.vrm.humanoid.resetNormalizedPose();
    const leftArm = currentRig.targets.find((t) => t.bone.name.toLowerCase().includes('leftupperarm'));
    const rightArm = currentRig.targets.find((t) => t.bone.name.toLowerCase().includes('rightupperarm'));
    if (leftArm) {
      aimBoneAtDirection(leftArm, new THREE.Vector3(-0.62, 0.18 + Math.sin(now * 0.003) * 0.18, 0.08).normalize());
    }
    if (rightArm) {
      aimBoneAtDirection(rightArm, new THREE.Vector3(0.62, 0.18 + Math.cos(now * 0.003) * 0.18, 0.08).normalize());
    }
    currentRig.vrm.humanoid.update();
  }

  /* ── VRM rig ───────────────────────────────────────────── */

  function createVrmRig(vrm: import('@pixiv/three-vrm').VRM): VrmRig | null {
    const specs: Array<{
      bone: import('@pixiv/three-vrm').VRMHumanBoneName;
      target: import('@pixiv/three-vrm').VRMHumanBoneName;
      from: LandmarkRef;
      to: LandmarkRef;
    }> = [
      { bone: VRMHumanBoneName.Hips, target: VRMHumanBoneName.Chest, from: [LANDMARKS.leftHip, LANDMARKS.rightHip], to: [LANDMARKS.leftShoulder, LANDMARKS.rightShoulder] },
      { bone: VRMHumanBoneName.Chest, target: VRMHumanBoneName.Head, from: [LANDMARKS.leftHip, LANDMARKS.rightHip], to: LANDMARKS.nose },
      { bone: VRMHumanBoneName.Neck, target: VRMHumanBoneName.Head, from: [LANDMARKS.leftShoulder, LANDMARKS.rightShoulder], to: LANDMARKS.nose },
      { bone: VRMHumanBoneName.LeftUpperArm, target: VRMHumanBoneName.LeftLowerArm, from: LANDMARKS.leftShoulder, to: LANDMARKS.leftElbow },
      { bone: VRMHumanBoneName.LeftLowerArm, target: VRMHumanBoneName.LeftHand, from: LANDMARKS.leftElbow, to: LANDMARKS.leftWrist },
      { bone: VRMHumanBoneName.RightUpperArm, target: VRMHumanBoneName.RightLowerArm, from: LANDMARKS.rightShoulder, to: LANDMARKS.rightElbow },
      { bone: VRMHumanBoneName.RightLowerArm, target: VRMHumanBoneName.RightHand, from: LANDMARKS.rightElbow, to: LANDMARKS.rightWrist },
      { bone: VRMHumanBoneName.LeftUpperLeg, target: VRMHumanBoneName.LeftLowerLeg, from: LANDMARKS.leftHip, to: LANDMARKS.leftKnee },
      { bone: VRMHumanBoneName.LeftLowerLeg, target: VRMHumanBoneName.LeftFoot, from: LANDMARKS.leftKnee, to: LANDMARKS.leftAnkle },
      { bone: VRMHumanBoneName.RightUpperLeg, target: VRMHumanBoneName.RightLowerLeg, from: LANDMARKS.rightHip, to: LANDMARKS.rightKnee },
      { bone: VRMHumanBoneName.RightLowerLeg, target: VRMHumanBoneName.RightFoot, from: LANDMARKS.rightKnee, to: LANDMARKS.rightAnkle },
    ];

    vrm.humanoid.resetNormalizedPose();
    vrm.scene.updateMatrixWorld(true);
    const targets: VrmMotionTarget[] = [];

    for (const spec of specs) {
      const bone = vrm.humanoid.getNormalizedBoneNode(spec.bone);
      const target = vrm.humanoid.getNormalizedBoneNode(spec.target);
      if (!bone || !target) continue;

      const bonePosition = new THREE.Vector3();
      const targetPosition = new THREE.Vector3();
      bone.getWorldPosition(bonePosition);
      target.getWorldPosition(targetPosition);
      const restDirection = targetPosition.sub(bonePosition).normalize();
      if (restDirection.lengthSq() < 0.0001) continue;

      targets.push({
        bone,
        from: spec.from,
        to: spec.to,
        restDirection,
        restWorldQuaternion: bone.getWorldQuaternion(new THREE.Quaternion()),
      });
    }

    return targets.length > 0 ? { vrm, targets } : null;
  }

  /* ── Math / geometry helpers ───────────────────────────── */

  function pointFromRef(ref: LandmarkRef, points: Map<number, Vec3>) {
    if (typeof ref === 'number') return points.get(ref) ?? null;
    const first = points.get(ref[0]);
    const second = points.get(ref[1]);
    if (!first || !second) return null;
    return midpoint(first, second);
  }

  function vectorFromPoints(from: Vec3, to: Vec3) {
    return new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
  }

  function aimBoneAtDirection(target: VrmMotionTarget, desiredDirection: import('three').Vector3) {
    const correction = new THREE.Quaternion().setFromUnitVectors(target.restDirection, desiredDirection);
    const targetWorldQuaternion = correction.multiply(target.restWorldQuaternion);
    const parentWorldQuaternion = new THREE.Quaternion();
    target.bone.parent?.getWorldQuaternion(parentWorldQuaternion);
    const localQuaternion = parentWorldQuaternion.invert().multiply(targetWorldQuaternion);
    target.bone.quaternion.copy(localQuaternion);
  }

  function landmarkToWorld(landmark: NormalizedLandmark): Vec3 {
    return {
      x: (landmark.x - 0.5) * 4,
      y: (0.5 - landmark.y) * 3.9,
      z: -(landmark.z ?? 0) * 1.7,
    };
  }

  function smoothPoint(index: number, next: Vec3) {
    const previous = smoothedPoints.get(index);
    if (!previous) { smoothedPoints.set(index, next); return next; }
    const smoothed = {
      x: previous.x * 0.58 + next.x * 0.42,
      y: previous.y * 0.58 + next.y * 0.42,
      z: previous.z * 0.58 + next.z * 0.42,
    };
    smoothedPoints.set(index, smoothed);
    return smoothed;
  }

  function midpoint(a: Vec3, b: Vec3): Vec3 {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  }

  function isVisible(landmark: NormalizedLandmark | undefined) {
    return Boolean(landmark && (landmark.visibility ?? 1) > 0.42);
  }

  /* ── Three.js environment ──────────────────────────────── */

  function setupLights() {
    const ambient = new THREE.HemisphereLight(0x9cfbe2, 0x24110a, 2.1);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(2.8, 5, 4.5);
    key.castShadow = true;
    scene.add(key);
    const rim = new THREE.PointLight(0xff8f5b, 6.5, 9);
    rim.position.set(-3.4, 1.2, 2.2);
    scene.add(rim);
  }

  function setupEnvironment() {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(4.4, 80),
      new THREE.MeshStandardMaterial({
        color: 0x0d1718, roughness: 0.8, metalness: 0.02,
        emissive: 0x06100f, emissiveIntensity: 0.55,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.72;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(8.8, 18, 0x8fffe0, 0x1f3a39);
    grid.position.y = -1.7;
    scene.add(grid);

    for (let index = 0; index < 28; index += 1) {
      const particle = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.025 + (index % 4) * 0.012, 0),
        new THREE.MeshBasicMaterial({ color: index % 2 === 0 ? 0x8fffe0 : 0xffd36f, transparent: true, opacity: 0.5 }),
      );
      particle.position.set(
        (Math.random() - 0.5) * 7,
        Math.random() * 4.2 - 0.7,
        Math.random() * -3.2,
      );
      scene.add(particle);
    }
  }

  function resizeStage() {
    if (!renderer) return;
    const bounds = stageCanvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(bounds.width));
    const height = Math.max(1, Math.floor(bounds.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nextWidth = Math.floor(width * dpr);
    const nextHeight = Math.floor(height * dpr);

    if (stageCanvas.width !== nextWidth || stageCanvas.height !== nextHeight) {
      renderer.setSize(width, height, false);
      threeCamera.aspect = width / height;
      threeCamera.updateProjectionMatrix();
    }
  }

  /* ── Cleanup ───────────────────────────────────────────── */

  return () => {
    disposed = true;

    // Cancel animation frames
    cancelAnimationFrame(rafId);
    cancelAnimationFrame(scanRafId);

    // Stop countdown timer
    window.clearInterval(countdownTimer);

    // Stop camera stream
    cameraRunning = false;
    stopStream(stream);
    stream = null;

    // Close PoseLandmarker
    landmarker?.close();
    landmarker = null;

    // Dispose VRM / Three.js
    disposeCurrentAvatar();
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
    }
    if (scene) {
      scene.traverse((child: any) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m: any) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    }

    // Remove resize listener
    window.removeEventListener('resize', onResize);

    // Clear DOM
    element.innerHTML = '';
  };
}
