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
import { SAMPLE_RATE } from './constants';
import { toolify } from './react-util';
import type { LooperDoc, MessageFromWorklet, MessageToWorklet } from './types';
import { uint8ToSharedArrayBuffer } from './helpers';
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
looper.connect(context.destination);

type InputGatePhase =
  | { kind: 'loading' }
  | { kind: 'need-permission' }
  | { kind: 'pick'; devices: MediaDeviceInfo[]; storedId: string | null };

const state = SharedState.new();
let initialized = false;

function initializeWorklet(handle: DocHandle<LooperDoc>) {
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
          doc.layers = [
            ...(doc.layers ?? []),
            {
              ...layer,
              samples: new Uint8Array(samples.buffer),
            },
          ];
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

  handle.on('change', (payload) => {
    const layers = payload.doc.layers ?? [];

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
  });

  const layers = handle.doc().layers ?? [];
  sendToWorklet({
    command: 'init',
    state: state._state.buffer,
    layers: layers.map(copyWithoutSamples),
    layerSamples: layers.map((layer) => ({
      id: layer.id,
      samples: uint8ToSharedArrayBuffer(layer.samples),
    })),
  });
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
    if (!initialized) {
      initialized = true;
      initializeWorklet(handle);
    }
  }, [docUrl]);

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

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [title]);

  const showInputOverlay = !audioReady;

  return (
    <div className="relative h-full min-h-0 flex-1 overflow-hidden bg-base-100">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />

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

function render(ctx: CanvasRenderingContext2D, title: string, width: number, height: number) {
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '16px system-ui, sans-serif';
  ctx.fillText(title, width / 2, height / 2);
}

export const renderLooperEditor = toolify(LooperEditor);
