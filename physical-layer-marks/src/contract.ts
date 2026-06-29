/**
 * Inlined physical-frame contract (kept local so this layer package is
 * self-contained — no cross-package source import). Structurally identical to
 * physical-frame's `physical-layer.ts` + `spatial-source.ts` + `providers.ts`:
 * the frame matches by shape, not by nominal type.
 */

import { accept } from "@inkandswitch/patchwork-providers";

export const PHYSICAL_LAYER_PLUGIN_TYPE = "physical:sensor";

export type FramePoint = { x: number; y: number };

export interface CameraFrame {
  gray: Uint8Array;
  w: number;
  h: number;
  scale: number;
  backgroundGray: Uint8Array | null;
  mapPointToBox(px: FramePoint): [number, number] | null;
  now: number;
}

export type ReaderStatus = "idle" | "loading" | "ready" | "error";

export interface Reader {
  ensure(): Promise<void>;
  process(cameraFrame: CameraFrame): void;
  stop(): void;
  readonly status: ReaderStatus;
}

/** Minimal Emitter surface the frame passes to `createReader` (set + value). */
export interface EmitterLike<T> {
  value: T;
  set(value: T): void;
}

export interface PhysicalLayer<Result = unknown> {
  readonly selector: string;
  readonly providerComponentId: string;
  readonly name: string;
  initialResult(): Result;
  createReader(emitter: EmitterLike<Result>): Reader;
}

// ---- Relay provider (matches physical-frame's makeRelayProvider) -----------

export const SPATIAL_REGISTRY_KEY = "__spatialRegistry";

type RegistryHost = HTMLElement & {
  [SPATIAL_REGISTRY_KEY]?: Map<string, { value: unknown; subscribe(fn: (v: unknown) => void): () => void }>;
};

type SubscribeEvent = CustomEvent<{
  selector?: { type?: string };
  port: MessagePort;
}>;

/** Relay whichever Emitter the frame registered for `selectorType` on THIS element. */
export function makeRelayProvider(selectorType: string) {
  return (element: RegistryHost) => {
    const onSubscribe = (event: Event) => {
      const e = event as SubscribeEvent;
      if (e.detail?.selector?.type !== selectorType) return;
      const emitter = element[SPATIAL_REGISTRY_KEY]?.get(selectorType);
      if (!emitter) return; // not our frame's wrapper / not ready → let it bubble
      accept(e as never, ((respond: (value: unknown) => void) => {
        respond(emitter.value);
        return emitter.subscribe(respond);
      }) as never);
    };
    element.addEventListener("patchwork:subscribe", onSubscribe);
    return () => element.removeEventListener("patchwork:subscribe", onSubscribe);
  };
}
