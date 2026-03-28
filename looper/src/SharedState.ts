import { NUM_FRAMES_PER_CHUNK } from "./constants";
import { LayerNoSamples } from "./types";

const MAX_FRAMES_PER_CHANNEL = 1_000_000 * NUM_FRAMES_PER_CHUNK;

const MASTER_GAIN = 0;
const CHANNEL_TO_RECORD = 1;
const LATENCY_OFFSET = 2;
const PLAYHEAD = 3;
const RECORDING = 4;
const RECORDING_FRAME_OFFSET = 5;
const NUM_FRAMES_RECORDED = 6;

export default class SharedState {
  static new() {
    const s = new SharedState(
      new Float32Array(new SharedArrayBuffer(128 * 4)),
      new Float32Array(new SharedArrayBuffer(MAX_FRAMES_PER_CHANNEL * 4)));
    s.masterGain = 1;
    s.channelToRecord = 0;
    s.latencyOffset = 20;
    s.playhead = 0;
    s.recording = false;
    return s;
  }

  static from(state: Float32Array<any>, recordingBuffer: Float32Array<any>) {
    return new SharedState(state, recordingBuffer);
  }


  readonly samplesByLayerId = new Map<number, Float32Array<any>>();
  layers: LayerNoSamples[] = [];

  private constructor(readonly _state: Float32Array<any>, readonly _recordingBuffer: Float32Array<any>) { }

  get masterGain() {
    return this._state[MASTER_GAIN];
  }

  set masterGain(value: number) {
    this._state[MASTER_GAIN] = value;
  }

  get channelToRecord() {
    return this._state[CHANNEL_TO_RECORD];
  }

  set channelToRecord(value: number) {
    this._state[CHANNEL_TO_RECORD] = value;
  }

  get latencyOffset() {
    return this._state[LATENCY_OFFSET];
  }

  set latencyOffset(value: number) {
    this._state[LATENCY_OFFSET] = value;
  }

  get playhead() {
    return this._state[PLAYHEAD];
  }

  set playhead(value: number) {
    this._state[PLAYHEAD] = value;
  }

  get recording() {
    return this._state[RECORDING] === 1;
  }

  set recording(value: boolean) {
    this._state[RECORDING] = value ? 1 : 0;
  }

  get recordingFrameOffset() {
    return this._state[RECORDING_FRAME_OFFSET];
  }

  set recordingFrameOffset(value: number) {
    this._state[RECORDING_FRAME_OFFSET] = value;
  }

  get numFramesRecorded() {
    return this._state[NUM_FRAMES_RECORDED];
  }

  set numFramesRecorded(value: number) {
    this._state[NUM_FRAMES_RECORDED] = value;
  }
}
