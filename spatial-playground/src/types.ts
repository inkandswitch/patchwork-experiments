export type Point = {
  x: number;
  y: number;
};

// -- Colors --

export type ColorId = 'red' | 'blue' | 'yellow';
export type SoundId = 'chime' | 'pad' | 'lofi';

export type ColorsDoc = {
  '@patchwork': { type: 'spatial-colors' };
  title: string;
  activeColors: ColorId[];
  activeRegions: { colorId: ColorId; corners: number[][] }[] | null;
  cameraAspect: number | null;
};

// -- Instrument --

export type NoteId = 'chime' | 'bell' | 'pluck';
export type DrumId = 'kick' | 'snare' | 'hat' | 'shaker';

export type StepEvent = {
  payload: string;
  label: string;
  category: string;
  pitchIndex: number | null;
  velocity: number;
};

export type PatternColumn = {
  x: number;
  melodies: StepEvent[];
  drums: StepEvent[];
  rest: boolean;
};

export type SavedLoop = {
  id: string;
  name: string;
  createdAt: number;
  columns: PatternColumn[];
  stepCount: number;
  key: string;
};

export type InstrumentDoc = {
  '@patchwork': { type: 'spatial-instrument' };
  title: string;
  savedLoops: SavedLoop[];
  tempo: number;
};

// -- Mocap --

export type HolePoseId = 'hands-up' | 't-pose' | 'right-aim' | 'left-aim' | 'crouch' | 'star';

export type MocapDoc = {
  '@patchwork': { type: 'spatial-mocap' };
  title: string;
  highScores: Array<{ score: number; streak: number; date: number }>;
};

// -- Puppet --

export type RecordedFrame = {
  t: number;
  landmarks: Array<{ x: number; y: number; z: number; visibility?: number }>;
};

export type PuppetDoc = {
  '@patchwork': { type: 'spatial-puppet' };
  title: string;
  avatarUrl: string;
  recordedFrames: RecordedFrame[];
};

// -- Battle --

export type UnitId = 'all' | 'infantry' | 'archers' | 'cavalry';
export type CommandId = 'move' | 'attack' | 'hold' | 'flank' | 'rally';
export type StanceId = 'line' | 'wedge' | 'shield';

export type BattleDoc = {
  '@patchwork': { type: 'spatial-battle' };
  title: string;
  waveNumber: number;
};

// -- Clap --

export type ClapDoc = {
  '@patchwork': { type: 'spatial-clap' };
  title: string;
  thresholdConfig: {
    peakThreshold: number;
    windowMs: number;
  };
  hueConfig: {
    bridgeIp: string;
    username: string;
    lightsOn: boolean;
  } | null;
};
