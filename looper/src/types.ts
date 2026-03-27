export type LooperDoc = {
  '@patchwork': { type: 'looper' };
  title: string;
  layers: Layer[];
};

export interface Position {
  x: number;
  y: number;
}

export interface Layer extends LayerNoSamples {
  // this is actually a bunch of 32-bit floating point numbers, channels are interleaved
  // to convert to array of 32-bit floats: `Float32Array.from(myLoop.samples)`
  samples: Uint8Array;
}

export interface LayerNoSamples {
  id: number;
  lengthInFrames: number;
  frameOffset: number;
  numChannels: number;
  numFramesRecorded: number;
  soloed: boolean;
  muted: boolean;
  backwards: boolean;
  gain: number;
}

export type MessageToWorklet =
  | {
    command: 'init';
    state: SharedArrayBuffer;
    layers: LayerNoSamples[];
    layerSamples: { id: number; samples: SharedArrayBuffer }[];
  }
  | { command: 'update layers'; layers: LayerNoSamples[] }
  | { command: 'set layer samples'; id: number; samples: SharedArrayBuffer }
  ;

export type MessageFromWorklet =
  | { event: 'finished recording'; layer: LayerNoSamples; samples: SharedArrayBuffer }
  | { event: 'log'; payload: any };

export interface InputDeviceInfo {
  id: string;
  numChannels: number;
  useMidiPedal: boolean;
}
