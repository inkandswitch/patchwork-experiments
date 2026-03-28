import type { AutomergeUrl } from '@automerge/automerge-repo';
import { useDocHandle } from '@automerge/automerge-repo-react-hooks';
import type { DocHandle } from '@automerge/automerge-repo';
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
import { toolify } from './react-util';
import type {
  Layer,
  LayerNoSamples,
  LooperDoc,
  MessageFromWorklet,
  MessageToWorklet,
  Position,
} from './types';
import { getLengthInFrames, uint8ToSharedArrayBuffer } from './helpers';
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

/** Wire doc ↔ worklet; returns cleanup (removes listener). Caller must disconnect the node to stop audio. */
function initializeWorklet(handle: DocHandle<LooperDoc>): () => void {
  console.log('### initializeWorklet');

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
        console.log(msg.payload);
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
  }

  handle.on('change', (payload) => onChange(payload.doc));
  onChange(handle.doc());

  const layers = handle.doc().layers;
  sendToWorklet({
    command: 'init',
    state: state._state.buffer,
    layers: layers.map(copyWithoutSamples),
    layerSamples: layers.map((layer) => ({
      id: layer.id,
      samples: uint8ToSharedArrayBuffer(layer.samples),
    })),
  });

  return () => {
    handle.off('change', (payload) => onChange(payload.doc));
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
        state.recording = true;
        break;
    }
  }, []);

  const onCanvasKeyUp = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (e.repeat) {
      return;
    }

    switch (e.key) {
      case ' ':
        state.recording = false;
        break;
    }
  }, []);

  const onCanvasPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    // Optional: e.currentTarget.setPointerCapture(e.pointerId) so move/up fire even if pointer leaves canvas
  }, []);

  const onCanvasPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {}, []);

  const onCanvasPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {}, []);

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

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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
      render(ctx, title, width, height);
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
  let sampleIdx = 0;
  while (sampleIdx < samples.length) {
    let maxAmplitudeInChunk = 0;
    for (let f = 0; f < NUM_FRAMES_PER_CHUNK; f++) {
      for (let c = 0; c < layer.numChannels; c++) {
        if (sampleIdx > samples.length) {
          throw new Error('uh-oh: not enough samples in layer w/ id ' + layer.id);
        }
        maxAmplitudeInChunk = Math.max(maxAmplitudeInChunk, Math.abs(samples[sampleIdx++]));
      }
    }
    maxAmplitudesInChunks.push(maxAmplitudeInChunk);
    maxAmplitudeInLayer = Math.max(maxAmplitudeInLayer, maxAmplitudeInChunk);
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

// --- rendering ---

const GAIN_NUBBIN_SPACING = 100;
const LAYER_HEIGHT_IN_PIXELS = 30;
const MASTER_GAIN_SLIDER_WIDTH = 10;

let lengthInFrames: number | null = null;
let pixelsPerFrame = 1;
let layerHeightInPixels = 32;
let unitGainNubbinRadius = layerHeightInPixels / 2;

function render(ctx: CanvasRenderingContext2D, title: string, width: number, height: number) {
  // TODO: calculate this based on the layers: how many are there? how tall is each?
  layerHeightInPixels = LAYER_HEIGHT_IN_PIXELS;
  unitGainNubbinRadius = Math.ceil(layerHeightInPixels / 2);
  lengthInFrames = getLengthInFrames(state.layers);
  if (lengthInFrames !== null) {
    pixelsPerFrame = (width - 2 * GAIN_NUBBIN_SPACING) / lengthInFrames;
  }

  renderLayers();
  renderMasterGainSlider();
  // renderLogs();
  // renderStatus();

  function renderLayers() {
    if (lengthInFrames === null) {
      return;
    }

    let top = LAYER_HEIGHT_IN_PIXELS;
    const x0 = GAIN_NUBBIN_SPACING;
    const x1 = x0 + lengthInFrames * pixelsPerFrame;
    for (const layer of state.layers) {
      const addlInfo = getAddlInfo(layer);
      if (!addlInfo) {
        continue;
      }

      const alpha = layer.muted ? 0.25 : 1;

      // draw samples
      const rgb = layer.soloed ? `50, 75, 117` : `100, 149, 237`;
      const sampleColor = `rgba(${rgb}, ${alpha})`;
      ctx.strokeStyle = sampleColor;
      ctx.lineWidth = NUM_FRAMES_PER_CHUNK * pixelsPerFrame;
      let y = top;
      let x = x0 + ((layer.frameOffset + lengthInFrames) % lengthInFrames) * pixelsPerFrame;
      for (let chunkIdx = 0; chunkIdx < addlInfo.maxAmplitudesInChunks.length; chunkIdx++) {
        if (x >= x1) {
          x = x0;
          y += layerHeightInPixels;
        }
        const amplitude =
          (((addlInfo.maxAmplitudesInChunks[
            layer.backwards ? addlInfo.maxAmplitudesInChunks.length - chunkIdx - 1 : chunkIdx
          ] /
            addlInfo.maxAmplitudeInLayer) *
            layerHeightInPixels) /
            2) *
          layer.gain;
        ctx.beginPath();
        ctx.moveTo(x, y - amplitude / 2);
        ctx.lineTo(x, y + amplitude / 2);
        ctx.stroke();
        x += NUM_FRAMES_PER_CHUNK * pixelsPerFrame;
      }

      const centerX = GAIN_NUBBIN_SPACING / 2;
      const centerY = (top + y) / 2;

      addlInfo.gainNubbinCenterPosition = { x: centerX, y: centerY };
      addlInfo.topY = top - layerHeightInPixels / 2;
      addlInfo.bottomY = y + layerHeightInPixels / 2;

      // draw gain nubbin
      ctx.fillStyle = `rgba(${rgb}, ${alpha / 4})`;
      ctx.beginPath();
      ctx.arc(centerX, centerY, layer.gain * unitGainNubbinRadius, 0, 2 * Math.PI);
      ctx.fill();

      top = y + layerHeightInPixels * 1.15;
    }

    // draw playhead
    const playheadX = GAIN_NUBBIN_SPACING + state.playhead * pixelsPerFrame;
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(playheadX, layerHeightInPixels);
    ctx.lineTo(playheadX, top);
    ctx.stroke();
  }

  function renderMasterGainSlider() {
    const h = state.masterGain * height;
    ctx.fillStyle = 'rgba(100, 149, 237, .25)';
    ctx.fillRect(width - MASTER_GAIN_SLIDER_WIDTH, height - h, MASTER_GAIN_SLIDER_WIDTH, h);
    ctx.fill();
  }
}

// function displayRecordingHelp() {
//   clearLogs();
//   if (recording) {
//     log({ color: 'cornflowerblue', text: 'SPACE' }, ' to ', { color: '#888', text: '■' });
//   } else {
//     log(
//       { color: 'cornflowerblue', text: 'SPACE' },
//       ' to ',
//       { color: 'red', text: '●' },
//       ` channel ${channelToRecord}`,
//     );
//   }

//   log({ color: 'cornflowerblue', text: 'H' }, ' for help');
// }

export const renderLooperEditor = toolify(LooperEditor);
