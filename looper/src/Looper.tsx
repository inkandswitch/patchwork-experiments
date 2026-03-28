import type { AutomergeUrl, DocHandle } from '@automerge/automerge-repo';
import { useDocHandle } from '@automerge/automerge-repo-react-hooks';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  clearStoredInputDeviceId,
  deviceLabel,
  listAudioInputDevices,
  openMicrophone,
  primeMicrophonePermission,
  readStoredInputDeviceId,
  writeStoredInputDeviceId,
  type MicConnection,
} from './audio';
import { NUM_FRAMES_PER_CHUNK, SAMPLE_RATE } from './constants';
import {
  LATENCY_OFFSET_DEFAULT_CHUNKS,
  LATENCY_OFFSET_MAX_CHUNKS,
  LATENCY_OFFSET_MIN_CHUNKS,
  readStoredLatencyOffsetChunks,
  writeStoredLatencyOffsetChunks,
} from './latency';
import { toolify } from './react-util';
import type {
  LayerNoSamples,
  LooperDoc,
  MessageFromWorklet,
  MessageToWorklet,
  Position,
} from './types';
import { clamp, getLengthInFrames, uint8ToSharedArrayBuffer } from './helpers';
import './styles.css';

// @ts-ignore -- not a real error, see https://v3.vitejs.dev/guide/assets.html
import workletUrl from './looper-worklet.ts?worker&url';
import { copyWithoutSamples } from './helpers';
import SharedState from './SharedState';

const context = new AudioContext({
  latencyHint: 'balanced',
  sampleRate: SAMPLE_RATE,
});
await context.audioWorklet.addModule(workletUrl);
const looper = new AudioWorkletNode(context, 'looper');

type InputGatePhase =
  | { kind: 'loading' }
  | { kind: 'need-permission' }
  | { kind: 'pick'; devices: MediaDeviceInfo[]; storedId: string | null };

const state = SharedState.new();
let docHandle: DocHandle<LooperDoc> | null = null;
let ctx: CanvasRenderingContext2D;
let canvasWidth = 0;
let canvasHeight = 0;

/** Wire doc ↔ worklet; returns cleanup (removes listener). Caller must disconnect the node to stop audio. */
function initializeWorklet(handle: DocHandle<LooperDoc>): () => void {
  console.log('### initializeWorklet');

  docHandle = handle;

  const sendToWorklet = (m: MessageToWorklet) => {
    looper.port.postMessage(m);
  };

  looper.port.onmessage = (e: MessageEvent<MessageFromWorklet>) => {
    const msg = e.data;
    switch (msg.event) {
      case 'finished recording': {
        const samples = new Float32Array(msg.samples);
        const layer = msg.layer;
        handle.change((doc) => {
          doc.layers.push({
            ...layer,
            samples: new Uint8Array(samples.buffer),
          });
        });
        break;
      }
      case 'log':
        displayStatus(msg.payload);
        break;
      default:
        console.error('unsupported message from worklet', msg);
    }
  };

  function onChange(doc: LooperDoc) {
    const layers = doc.layers;

    state.layers = layers.map(copyWithoutSamples);
    sendToWorklet({
      command: 'update layers',
      layers: state.layers,
    });

    for (const layer of layers) {
      if (!state.samplesByLayerId.has(layer.id)) {
        state.samplesByLayerId.set(layer.id, new Float32Array(layer.samples.buffer));
        sendToWorklet({
          command: 'set layer samples',
          id: layer.id,
          samples: layer.samples.buffer as any,
        });
      }
    }

    displayRecordingHelp();
  }

  const onDocChange = (payload: { doc: LooperDoc }) => onChange(payload.doc);
  handle.on('change', onDocChange);
  onChange(handle.doc());

  const layers = handle.doc().layers;
  sendToWorklet({
    command: 'init',
    state: state._state.buffer,
    recordingBuffer: state._recordingBuffer.buffer,
    layers: layers.map(copyWithoutSamples),
    layerSamples: layers.map((layer) => ({
      id: layer.id,
      samples: uint8ToSharedArrayBuffer(layer.samples),
    })),
  });

  return () => {
    handle.off('change', onDocChange);
  };
}

export const LooperEditor = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const handle = useDocHandle<LooperDoc>(docUrl, { suspense: true });
  const doc = handle.doc();
  const title = doc.title?.trim() || 'Looper';
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const micRef = useRef<MicConnection | null>(null);
  const [inputPhase, setInputPhase] = useState<InputGatePhase>({ kind: 'loading' });
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const refreshDevices = useCallback(async () => {
    const inputs = await listAudioInputDevices();
    const hasLabels = inputs.some((d) => d.label.trim().length > 0);
    const storedId = readStoredInputDeviceId();

    if (!hasLabels) {
      setInputPhase({ kind: 'need-permission' });
      setSelectedDeviceId(null);
      return;
    }

    setInputPhase({ kind: 'pick', devices: inputs, storedId });

    const preferred =
      storedId && inputs.some((d) => d.deviceId === storedId)
        ? storedId
        : (inputs[0]?.deviceId ?? null);
    setSelectedDeviceId(preferred);
    if (inputs.length === 0) {
      setConnectError('No audio inputs were found. Plug in a microphone and try again.');
    } else {
      setConnectError((prev) =>
        prev === 'No audio inputs were found. Plug in a microphone and try again.' ? null : prev,
      );
    }
  }, []);

  useEffect(() => {
    refreshDevices();
    const md = navigator.mediaDevices;
    md.addEventListener('devicechange', refreshDevices);
    return () => md.removeEventListener('devicechange', refreshDevices);
  }, [docUrl, refreshDevices]);

  useEffect(() => {
    looper.connect(context.destination);
    const stopDocSync = initializeWorklet(handle);
    return () => {
      stopDocSync();
      looper.port.onmessage = null;
      looper.disconnect();
    };
  }, [handle]);

  const connectWithDeviceId = useCallback(
    async (deviceId: string) => {
      setConnectError(null);
      setConnecting(true);
      try {
        const { connection } = await openMicrophone(context, deviceId, micRef.current);
        micRef.current = connection;
        connection.source.connect(looper);
        writeStoredInputDeviceId(deviceId);
        state.latencyOffset = readStoredLatencyOffsetChunks() ?? LATENCY_OFFSET_DEFAULT_CHUNKS;
        displayStatus(`latency offset = ${state.latencyOffset} chunks`);
        setAudioReady(true);
      } catch (e) {
        const name = e instanceof DOMException ? e.name : '';
        if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          clearStoredInputDeviceId();
          setConnectError('That input is no longer available. Pick another one.');
          await refreshDevices();
        } else if (name === 'NotAllowedError') {
          setConnectError(
            'Microphone access was blocked. Allow it in the browser bar and try again.',
          );
        } else {
          setConnectError(e instanceof Error ? e.message : 'Could not open microphone.');
        }
      } finally {
        setConnecting(false);
      }
    },
    [refreshDevices],
  );

  /** Canvas is not focusable by default; keyboard events only fire after focus (Tab or click). */
  const onCanvasKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (e.repeat) {
      return;
    }

    switch (e.key) {
      case ' ':
        state.recording = !state.recording;
        displayRecordingHelp();
        e.preventDefault();
        break;
      case 'Backspace':
        deleteLayer();
        break;
      case 'd':
        duplicateLayer();
        break;
      case 's':
        toggleSoloed();
        break;
      case 'm':
        toggleMuted();
        break;
      case 'b':
        toggleBackwards();
        break;
      case 'Shift':
        onShift('down');
        break;
      case 'Control':
        onControl('down');
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        state.latencyOffset = clamp(
          state.latencyOffset + (e.key === 'ArrowUp' ? 1 : -1),
          LATENCY_OFFSET_MIN_CHUNKS,
          LATENCY_OFFSET_MAX_CHUNKS,
        );
        writeStoredLatencyOffsetChunks(state.latencyOffset);
        displayStatus(`latency offset = ${state.latencyOffset} chunks`);
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        state.channelToRecord = Math.max(
          0,
          Math.min(
            state.channelToRecord + (e.key === 'ArrowLeft' ? -1 : 1),
            micRef.current!.stream.getAudioTracks()[0].getSettings().channelCount! - 1,
          ),
        );
        displayRecordingHelp();
        break;
      case 'h':
        toggleFullHelp();
        break;
    }
  }, []);

  const onCanvasKeyUp = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (e.repeat) {
      return;
    }

    switch (e.key) {
      case 'Shift':
        onShift('up');
        break;
      case 'Control':
        onControl('up');
        break;
    }
  }, []);

  const onCanvasPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    onPointerDown();
  }, []);

  const onCanvasPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    onPointerMove(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
  }, []);

  const onCanvasPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    onPointerUp();
  }, []);

  useEffect(() => {
    return () => {
      const prev = micRef.current;
      if (prev) {
        prev.source.disconnect();
        for (const t of prev.stream.getTracks()) {
          t.stop();
        }
        micRef.current = null;
      }
    };
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const _ctx = canvas.getContext('2d')!;
    if (!_ctx) return;

    ctx = _ctx;

    const draw = () => {
      const dpr = window.devicePixelRatio ?? 1;
      const { width, height } = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(width * dpr));
      const h = Math.max(1, Math.floor(height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      canvasWidth = width;
      canvasHeight = height;
      render();
    };

    let rafId = 0;
    const loop = () => {
      draw();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(rafId);
  }, [title]);

  const showInputOverlay = !audioReady;

  return (
    <div className="relative h-full min-h-0 flex-1 overflow-hidden bg-base-100">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label="Looper"
        className="absolute inset-0 block h-full w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-base-100"
        onKeyDown={onCanvasKeyDown}
        onKeyUp={onCanvasKeyUp}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
      />

      {showInputOverlay ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-base-100/85 p-4 backdrop-blur-md">
          <div className="card border-base-300 bg-base-100 w-full max-w-lg border shadow-2xl">
            <div className="card-body gap-4">
              <div>
                <h2 className="card-title text-lg">Audio input</h2>
                <p className="text-base-content/70 text-sm">
                  Choose the microphone for this looper. Your choice is saved in this browser.
                  Opening the mic still needs a click here once per visit — that satisfies the
                  browser&apos;s security rules for microphone and audio playback.
                </p>
              </div>

              {inputPhase.kind === 'loading' ? (
                <span className="loading loading-spinner loading-md text-primary" />
              ) : null}

              {inputPhase.kind === 'need-permission' ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm">
                    Allow microphone access so we can list your inputs by name. We only use this
                    prompt to discover devices; you pick the exact input next.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={connecting}
                    onClick={() => {
                      void (async () => {
                        setConnectError(null);
                        setConnecting(true);
                        try {
                          await primeMicrophonePermission();
                          await refreshDevices();
                        } catch (e) {
                          const name = e instanceof DOMException ? e.name : '';
                          if (name === 'NotAllowedError') {
                            setConnectError(
                              'Microphone access was blocked. Allow it in the browser bar and try again.',
                            );
                          } else {
                            setConnectError(
                              e instanceof Error ? e.message : 'Could not access microphone.',
                            );
                          }
                        } finally {
                          setConnecting(false);
                        }
                      })();
                    }}
                  >
                    {connecting ? <span className="loading loading-spinner loading-sm" /> : null}
                    Allow microphone access
                  </button>
                </div>
              ) : null}

              {inputPhase.kind === 'pick' ? (
                <div className="flex flex-col gap-3">
                  {inputPhase.storedId &&
                  inputPhase.devices.some((d) => d.deviceId === inputPhase.storedId) ? (
                    <p className="text-base-content/80 text-sm">
                      Using your saved input (
                      {deviceLabel(
                        inputPhase.devices.find((d) => d.deviceId === inputPhase.storedId)!,
                        inputPhase.devices.findIndex((d) => d.deviceId === inputPhase.storedId),
                      )}
                      ). You can switch below or start with one click.
                    </p>
                  ) : null}

                  <ul
                    className="border-base-300 bg-base-200/60 max-h-52 space-y-1 overflow-y-auto rounded-box border p-2"
                    role="listbox"
                    aria-label="Audio input devices"
                  >
                    {inputPhase.devices.map((d, i) => {
                      const selected = selectedDeviceId === d.deviceId;
                      return (
                        <li key={d.deviceId} className="list-none">
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            className={
                              selected
                                ? 'flex w-full items-center gap-3 rounded-lg border-2 border-primary bg-primary px-3 py-2.5 text-left text-sm font-semibold text-primary-content shadow-sm outline-none ring-2 ring-primary/40 ring-offset-2 ring-offset-base-100'
                                : 'flex w-full items-center gap-3 rounded-lg border-2 border-transparent px-3 py-2.5 text-left text-sm text-base-content hover:border-base-300 hover:bg-base-300'
                            }
                            onClick={() => setSelectedDeviceId(d.deviceId)}
                          >
                            <span
                              className={
                                selected
                                  ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-content/25 text-base leading-none text-primary-content'
                                  : 'border-base-300 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-dashed bg-base-100 text-base-content/30'
                              }
                              aria-hidden
                            >
                              {selected ? '✓' : ''}
                            </span>
                            <span className="min-w-0 flex-1 truncate">{deviceLabel(d, i)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  <div className="card-actions flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={connecting || !inputPhase.storedId}
                      onClick={() => {
                        clearStoredInputDeviceId();
                        setInputPhase((p) => (p.kind === 'pick' ? { ...p, storedId: null } : p));
                      }}
                    >
                      Forget saved device
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={connecting || !selectedDeviceId}
                      onClick={() => {
                        if (selectedDeviceId) {
                          void connectWithDeviceId(selectedDeviceId);
                        }
                      }}
                    >
                      {connecting ? <span className="loading loading-spinner loading-sm" /> : null}
                      Start looper
                    </button>
                  </div>
                </div>
              ) : null}

              {connectError ? (
                <div role="alert" className="alert alert-warning text-sm">
                  {connectError}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

// --- operations triggered by the mouse / keyboard ---

function deleteLayer() {
  const id = layerAtPointer();
  if (id !== null) {
    docHandle!.change((doc) => {
      const idx = doc.layers.findIndex((layer) => layer.id === id);
      if (idx >= 0) {
        doc.layers.splice(idx, 1);
      }
    });
  }
}

function duplicateLayer() {
  const id = layerAtPointer();
  if (id !== null) {
    docHandle!.change((doc) => {
      const idx = doc.layers.findIndex((layer) => layer.id === id);
      if (idx < 0) {
        return;
      }
      const layer = doc.layers[idx];
      doc.layers.splice(idx, 0, { ...layer, id: Math.random() });
    });
  }
}

function toggleSoloed() {
  const id = layerAtPointer();
  if (id !== null) {
    docHandle!.change((doc) => {
      const layer = doc.layers.find((layer) => layer.id === id);
      if (layer) {
        layer.soloed = !layer.soloed;
      }
    });
  }
}

function toggleMuted() {
  const id = layerAtPointer();
  if (id !== null) {
    docHandle!.change((doc) => {
      const layer = doc.layers.find((layer) => layer.id === id);
      if (layer) {
        layer.muted = !layer.muted;
      }
    });
  }
}

function toggleBackwards() {
  const id = layerAtPointer();
  if (id !== null) {
    docHandle!.change((doc) => {
      const layer = doc.layers.find((layer) => layer.id === id);
      if (layer) {
        layer.backwards = !layer.backwards;
      }
    });
  }
}

let gainChangeLayerInfo: { id: number; origGain: number; origPos: Position } | null = null;
let changingMasterGain = false;

function onControl(control: 'down' | 'up') {
  if (control === 'up') {
    changingMasterGain = false;
    gainChangeLayerInfo = null;
    return;
  }

  if (pointerPos.x >= canvasWidth - MASTER_GAIN_SLIDER_WIDTH) {
    changingMasterGain = true;
    setMasterGain();
    return;
  }

  const id = layerAtPointer();
  if (id === null) {
    gainChangeLayerInfo = null;
    return;
  }

  const layer = state.layers.find((layer) => layer.id === id)!;
  gainChangeLayerInfo = { id, origGain: layer.gain, origPos: { ...pointerPos } };
}

let offsetChangeLayerInfo: { id: number; origOffset: number; origPos: Position } | null = null;

function onShift(shift: 'down' | 'up') {
  if (shift === 'up') {
    offsetChangeLayerInfo = null;
    return;
  }

  const id = layerAtPointer();
  if (id === null) {
    offsetChangeLayerInfo = null;
    return;
  }

  const layer = state.layers.find((layer) => layer.id === id)!;
  offsetChangeLayerInfo = { id, origOffset: layer.frameOffset, origPos: { ...pointerPos } };
}

// --- mouse controls ---

const pointerPos = { x: -Infinity, y: -Infinity };
let movingPlayhead = false;

function onPointerDown() {
  if (lengthInFrames !== null) {
    movingPlayhead = true;
    movePlayhead();
  }
}

function onPointerUp() {
  movingPlayhead = false;
}

function onPointerMove(x: number, y: number) {
  pointerPos.x = x;
  pointerPos.y = y;

  if (movingPlayhead) {
    movePlayhead();
  }

  if (changingMasterGain) {
    setMasterGain();
  }

  if (gainChangeLayerInfo !== null) {
    const { id, origPos, origGain } = gainChangeLayerInfo;
    docHandle!.change((doc) => {
      const layer = doc.layers.find((layer) => layer.id === id);
      if (layer) {
        const change = -(pointerPos.y - origPos.y);
        layer.gain = Math.max(0, Math.min(origGain + change / unitGainNubbinRadius, 2));
      }
    });
  }

  if (offsetChangeLayerInfo !== null) {
    const { id, origPos, origOffset } = offsetChangeLayerInfo;
    docHandle!.change((doc) => {
      const layer = doc.layers.find((layer) => layer.id === id);
      if (layer) {
        const change = pointerPos.x - origPos.x;
        layer.frameOffset = Math.round(origOffset + change / pixelsPerFrame);
      }
    });
  }
}

function movePlayhead() {
  state.playhead = clamp(
    Math.round((pointerPos.x - GAIN_NUBBIN_SPACING) / pixelsPerFrame),
    0,
    lengthInFrames! - 1,
  );
}

function setMasterGain() {
  state.masterGain = (canvasHeight - pointerPos.y) / canvasHeight;
}

function layerAtPointer() {
  for (const l of state.layers) {
    const addlInfo = getAddlInfo(l);
    if (!addlInfo) {
      continue;
    }
    if (addlInfo.topY <= pointerPos.y && pointerPos.y <= addlInfo.bottomY) {
      return l.id;
    }
  }
  return null;
}

// --- UI-related info for each layer ---

interface AddlLayerInfo {
  maxAmplitudesInChunks: number[];
  maxAmplitudeInLayer: number;
  gainNubbinCenterPosition: Position;
  topY: number;
  bottomY: number;
}

const addlLayerInfoById = new Map<number, AddlLayerInfo>();

function getAddlInfo(layer: LayerNoSamples) {
  let addlInfo = addlLayerInfoById.get(layer.id);
  if (addlInfo) {
    return addlInfo;
  }

  const samples = state.samplesByLayerId.get(layer.id);
  if (!samples) {
    return null;
  }

  const maxAmplitudesInChunks: number[] = [];
  let maxAmplitudeInLayer = 0;
  let frameIdx = 0;
  while (frameIdx < layer.numFramesRecorded) {
    const maxAmplitudeInChunk = getMaxAmplitudeInChunk(
      samples,
      layer.numChannels,
      layer.numFramesRecorded,
      frameIdx,
    );
    maxAmplitudesInChunks.push(maxAmplitudeInChunk);
    maxAmplitudeInLayer = Math.max(maxAmplitudeInLayer, maxAmplitudeInChunk);
    frameIdx += NUM_FRAMES_PER_CHUNK;
  }

  addlInfo = {
    maxAmplitudesInChunks,
    maxAmplitudeInLayer,
    gainNubbinCenterPosition: { x: 0, y: 0 },
    topY: 0,
    bottomY: 0,
  };
  addlLayerInfoById.set(layer.id, addlInfo);
  return addlInfo;
}

function getMaxAmplitudeInChunk(
  samples: Float32Array<any>,
  numChannels: number,
  numFramesRecorded: number,
  chunkStartFrameIdx: number,
) {
  let maxAmplitude = 0;
  let frameIdx = chunkStartFrameIdx;
  let sampleIdx = frameIdx * numChannels;
  for (let f = 0; f < NUM_FRAMES_PER_CHUNK; f++) {
    if (frameIdx >= numFramesRecorded) {
      break;
    }

    for (let c = 0; c < numChannels; c++) {
      maxAmplitude = Math.max(maxAmplitude, Math.abs(samples[sampleIdx++]));
    }
    frameIdx++;
  }
  return maxAmplitude;
}

// --- rendering ---

const GAIN_NUBBIN_SPACING = 100;
const LAYER_HEIGHT_IN_PIXELS = 30;
const MASTER_GAIN_SLIDER_WIDTH = 10;

let lengthInFrames: number | null = null;
/** Horizontal extent of the loop in frames (grows during first-layer recording). */
let timelineFrames: number | null = null;
let pixelsPerFrame = 1;
let layerHeightInPixels = 32;
let unitGainNubbinRadius = layerHeightInPixels / 2;

function render() {
  // TODO: calculate this based on the layers: how many are there? how tall is each?
  layerHeightInPixels = LAYER_HEIGHT_IN_PIXELS;
  unitGainNubbinRadius = Math.ceil(layerHeightInPixels / 2);
  lengthInFrames = getLengthInFrames(state.layers);
  timelineFrames =
    lengthInFrames ?? (state.recording ? Math.max(state.numFramesRecorded, 1) : null);
  if (timelineFrames !== null) {
    pixelsPerFrame = (canvasWidth - 2 * GAIN_NUBBIN_SPACING) / timelineFrames;
  }

  renderLayers();
  renderMasterGainSlider();
  renderLogs();
  renderStatus();
}

const pretendLayerForRecording: LayerNoSamples = {
  id: -1,
  lengthInFrames: 0, // <- loopLen
  frameOffset: 0, // <- state.recordingFrameOffset
  numChannels: 1,
  numFramesRecorded: 0, // <- state.numFramesRecorded
  soloed: false,
  muted: false,
  backwards: false,
  gain: 1,
};

function renderLayers() {
  if (timelineFrames === null) {
    return;
  }

  const loopLen = timelineFrames;
  let top = LAYER_HEIGHT_IN_PIXELS;
  const x0 = GAIN_NUBBIN_SPACING;
  const x1 = x0 + loopLen * pixelsPerFrame;
  const firstLayerFrameOffset =
    state.layers.length > 0
      ? state.layers[0].frameOffset
      : state.recording && state.numFramesRecorded > 0
        ? -state.latencyOffset * NUM_FRAMES_PER_CHUNK
        : 0;

  function renderLayer(layer: LayerNoSamples, addlInfo: AddlLayerInfo, isRecording = false) {
    const alpha = layer.muted ? 0.25 : 1;
    const rgb = isRecording ? '220, 90, 70' : layer.soloed ? '50, 75, 117' : '100, 149, 237';
    const chunkW = NUM_FRAMES_PER_CHUNK * pixelsPerFrame;
    const nChunks = addlInfo.maxAmplitudesInChunks.length;
    const peakMax = Math.max(addlInfo.maxAmplitudeInLayer, 1e-9);
    const bandHalf = layerHeightInPixels * 0.46;

    let x = x0 + ((layer.frameOffset - firstLayerFrameOffset + loopLen) % loopLen) * pixelsPerFrame;
    const rows: { cx: number; raw: number }[][] = [];
    let current: { cx: number; raw: number }[] = [];

    for (let chunkIdx = 0; chunkIdx < nChunks; chunkIdx++) {
      if (x >= x1) {
        if (current.length > 0) {
          rows.push(current);
        }
        current = [];
        x = x0;
      }
      const raw =
        addlInfo.maxAmplitudesInChunks[layer.backwards ? nChunks - 1 - chunkIdx : chunkIdx];
      current.push({ cx: x + chunkW / 2, raw });
      x += chunkW;
    }
    if (current.length > 0) {
      rows.push(current);
    }

    for (let r = 0; r < rows.length; r++) {
      const pts = rows[r];
      const centerY = top + r * layerHeightInPixels;
      renderWaveform(
        pts.map((p) => p.cx),
        pts.map((p) => p.raw),
        peakMax,
        centerY,
        bandHalf,
        chunkW,
        rgb,
        alpha,
        layer.gain,
      );
    }

    const lastCenterY = rows.length > 0 ? top + (rows.length - 1) * layerHeightInPixels : top;
    const centerX = GAIN_NUBBIN_SPACING / 2;
    const gainNubbinCenterY = rows.length > 0 ? (top + lastCenterY) / 2 : top;

    addlInfo.gainNubbinCenterPosition = { x: centerX, y: gainNubbinCenterY };
    addlInfo.topY = top - layerHeightInPixels / 2;
    addlInfo.bottomY = lastCenterY + layerHeightInPixels / 2;

    ctx.fillStyle = `rgba(${rgb}, ${alpha / 4})`;
    ctx.beginPath();
    ctx.arc(centerX, gainNubbinCenterY, layer.gain * unitGainNubbinRadius, 0, 2 * Math.PI);
    ctx.fill();

    top = lastCenterY + layerHeightInPixels * 1.15;
  }

  for (const layer of state.layers) {
    const addlInfo = getAddlInfo(layer);
    if (addlInfo) {
      renderLayer(layer, addlInfo);
    }
  }

  if (state.recording && state.numFramesRecorded > 0) {
    pretendLayerForRecording.lengthInFrames = loopLen;
    pretendLayerForRecording.frameOffset = state.recordingFrameOffset;
    pretendLayerForRecording.numFramesRecorded = state.numFramesRecorded;
    const maxAmplitudesInChunks: number[] = [];
    for (let i = 0; i < state.numFramesRecorded; i += NUM_FRAMES_PER_CHUNK) {
      maxAmplitudesInChunks.push(
        getMaxAmplitudeInChunk(state._recordingBuffer, 1, state.numFramesRecorded, i),
      );
    }
    const addlInfo: AddlLayerInfo = {
      maxAmplitudesInChunks,
      maxAmplitudeInLayer: Math.max(1e-9, ...maxAmplitudesInChunks),
      gainNubbinCenterPosition: { x: 0, y: 0 },
      topY: 0,
      bottomY: 0,
    };
    renderLayer(pretendLayerForRecording, addlInfo, true);
  }

  // draw playhead
  const playheadX =
    GAIN_NUBBIN_SPACING + (lengthInFrames === null ? loopLen : state.playhead) * pixelsPerFrame;
  ctx.strokeStyle = '#999';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(playheadX, layerHeightInPixels);
  ctx.lineTo(playheadX, top);
  ctx.stroke();
}

function renderWaveform(
  centersX: number[],
  rawPeaks: number[],
  peakMax: number,
  centerY: number,
  bandHalfMax: number,
  chunkWidthPx: number,
  rgb: string,
  alpha: number,
  gain: number,
) {
  const n = centersX.length;
  if (n === 0) {
    return;
  }

  const pm = Math.max(peakMax, 1e-9);
  const heights = smoothPeaksBox(
    rawPeaks.map((v) => (v / pm) * gain * bandHalfMax),
    3,
    2,
  ).map((h) => clamp(h, 0, bandHalfMax));

  const topY = (i: number) => centerY - heights[i];
  const botY = (i: number) => centerY + heights[i];

  if (n === 1) {
    const w = Math.max(3, chunkWidthPx * 0.9);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(centersX[0], topY(0));
    ctx.lineTo(centersX[0], botY(0));
    ctx.strokeStyle = `rgba(${rgb}, ${alpha * 0.42})`;
    ctx.lineWidth = w;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centersX[0], topY(0));
    ctx.lineTo(centersX[0], botY(0));
    ctx.strokeStyle = `rgba(${rgb}, ${alpha * 0.95})`;
    ctx.lineWidth = 1.35;
    ctx.stroke();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(centersX[0], centerY + 0.5);
  ctx.lineTo(centersX[n - 1], centerY + 0.5);
  ctx.strokeStyle = `rgba(${rgb}, ${alpha * 0.1})`;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(centersX[0], centerY);
  ctx.lineTo(centersX[0], topY(0));
  for (let i = 0; i < n - 1; i++) {
    const mx = (centersX[i] + centersX[i + 1]) / 2;
    const my = (topY(i) + topY(i + 1)) / 2;
    ctx.quadraticCurveTo(centersX[i], topY(i), mx, my);
  }
  ctx.quadraticCurveTo(centersX[n - 1], topY(n - 1), centersX[n - 1], topY(n - 1));
  ctx.lineTo(centersX[n - 1], centerY);
  ctx.lineTo(centersX[n - 1], botY(n - 1));
  for (let i = n - 1; i > 0; i--) {
    const mx = (centersX[i] + centersX[i - 1]) / 2;
    const my = (botY(i) + botY(i - 1)) / 2;
    ctx.quadraticCurveTo(centersX[i], botY(i), mx, my);
  }
  ctx.quadraticCurveTo(centersX[0], botY(0), centersX[0], botY(0));
  ctx.lineTo(centersX[0], centerY);
  ctx.closePath();

  ctx.fillStyle = `rgba(${rgb}, ${alpha * 0.36})`;
  ctx.fill();
  ctx.strokeStyle = `rgba(${rgb}, ${alpha * 0.9})`;
  ctx.lineWidth = 1.2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** box blur for chunk peak envelopes. */
function smoothPeaksBox(peaks: number[], radius: number, passes: number): number[] {
  if (peaks.length === 0) {
    return peaks;
  }
  let a = peaks.slice();
  const n = a.length;
  for (let p = 0; p < passes; p++) {
    const next = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let c = 0;
      for (let d = -radius; d <= radius; d++) {
        const j = i + d;
        if (j >= 0 && j < n) {
          sum += a[j];
          c++;
        }
      }
      next[i] = sum / c;
    }
    a = next;
  }
  return a;
}

function renderMasterGainSlider() {
  const h = state.masterGain * canvasHeight;
  ctx.fillStyle = 'rgba(100, 149, 237, .25)';
  ctx.fillRect(
    canvasWidth - MASTER_GAIN_SLIDER_WIDTH,
    canvasHeight - h,
    MASTER_GAIN_SLIDER_WIDTH,
    h,
  );
  ctx.fill();
}

function renderStatus() {
  ctx.font = '20px Monaco';
  ctx.fillStyle = statusColor;
  const statusWidth = ctx.measureText(status).width;
  ctx.fillText(
    status,
    canvasWidth - LEFT_MARGIN_FOR_TEXT - statusWidth,
    canvasHeight - BOTTOM_MARGIN_FOR_TEXT,
  );
}

function renderLogs() {
  ctx.font = '20px Monaco';
  let y = canvasHeight - BOTTOM_MARGIN_FOR_TEXT;
  const x0 = LEFT_MARGIN_FOR_TEXT;
  for (const line of logs) {
    let x = x0;
    for (const part of line) {
      const text = typeof part === 'string' ? part : part.text;
      ctx.fillStyle = typeof part === 'string' ? 'black' : part.color;
      ctx.fillText(text, x, y);
      x += ctx.measureText(text).width;
    }
    y -= 25;
  }
}

// --- statuses ---

let status = '';
let statusColor = 'cornflowerblue';
let statusClearTimeMillis = 0;

const LEFT_MARGIN_FOR_TEXT = 40;
const BOTTOM_MARGIN_FOR_TEXT = 40;

function displayStatus(newStatus: string, color = 'cornflowerblue', timeMillis = 3_000) {
  status = newStatus;
  statusColor = color;
  statusClearTimeMillis = Date.now() + timeMillis;
  setTimeout(() => {
    if (Date.now() >= statusClearTimeMillis) {
      status = '';
    }
  }, timeMillis);
}

function displayRecordingHelp() {
  clearLogs();
  if (state.recording) {
    log({ color: 'cornflowerblue', text: 'SPACE' }, ' to ', { color: '#888', text: '■' });
  } else {
    log(
      { color: 'cornflowerblue', text: 'SPACE' },
      ' to ',
      { color: 'red', text: '●' },
      ` channel ${state.channelToRecord}`,
    );
  }

  log({ color: 'cornflowerblue', text: 'H' }, ' for help');
}

// --- logs ---

type LoggedLinePart = { color: string; text: string } | string;
type LoggedLine = LoggedLinePart[];
const logs: LoggedLine[] = [];

function log(...line: LoggedLinePart[]) {
  logs.unshift(line);
}

function clearLogs() {
  logs.length = 0;
}

// --- help ---

let displayingFullHelp = false;

function toggleFullHelp() {
  if (displayingFullHelp) {
    displayRecordingHelp();
  } else {
    displayFullHelp();
  }
  displayingFullHelp = !displayingFullHelp;
}

function displayFullHelp() {
  clearLogs();
  log('To start recording a new layer, press ', b('SPACE'), '.');
  log('To stop recording, press ', b('SPACE'), ' again.');
  log('');
  log('If you point at a layer,');
  log('- hold down ', b('SHIFT'), ' and move mouse left/right to slide layer in time');
  log(
    '- hold down ',
    b('CONTROL'),
    " and move mouse up/down to change the layer's gain (louder/softer)",
  );
  log('- press ', b('BACKSPACE'), ' to delete the layer');
  log('- press ', b('M'), ' to toggle mute');
  log('- press ', b('S'), ' to toggle solo');
  log('- press ', b('B'), ' to toggle backwards');
  log('- press ', b('D'), ' to duplicate the layer');
  log('');
  log('The blue bar at the right margin is the master volume slider.');
  log('Point at it, hold down ', b('CONTROL'), ' and move mouse up/down to adjust it.');
  log();
  log('Press ', b('LEFT'), '/', b('RIGHT'), " to change the channel you're recording from.");
  log();
  log('Press ', b('UP'), '/', b('DOWN'), ' to adjust the latency offset.');
  log();
  log('Press ', b('H'), ' to make this help go away.');

  function b(text: string) {
    return { color: 'cornflowerblue', text };
  }
}

export const renderLooperEditor = toolify(LooperEditor);
