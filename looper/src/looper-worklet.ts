import { NUM_FRAMES_PER_CHUNK } from './constants';
import { getLengthInFrames } from './helpers';
import SharedState from './SharedState';
import { LayerNoSamples, MessageFromWorklet, MessageToWorklet } from './types';

class Looper extends AudioWorkletProcessor implements AudioWorkletProcessorImpl {
  state!: SharedState;
  prevState!: SharedState;
  readonly samplesByLayerId = new Map<number, Float32Array<any>>();
  layers: LayerNoSamples[] = [];
  recordingLayer: LayerNoSamples | null = null;

  constructor() {
    super();
    this.port.onmessage = (msg: MessageEvent<MessageToWorklet>) => this.onMessage(msg.data);
  }

  sendMessage(msg: MessageFromWorklet) {
    this.port.postMessage(msg);
  }

  say(msg: string) {
    this.sendMessage({ event: 'log', payload: msg });
  }

  onMessage(msg: MessageToWorklet) {
    switch (msg.command) {
      case 'init':
        this.init(msg.state, msg.recordingBuffer, msg.layers, msg.layerSamples);
        break;
      case 'update layers':
        this.layers = msg.layers;
        break;
      case 'set layer samples':
        this.samplesByLayerId.set(msg.id, new Float32Array(msg.samples));
        break;
      default:
        console.error('unsupported message', msg);
        throw new Error('unsupported message!');
    }
  }

  init(state: SharedArrayBuffer, recordingBuffer: SharedArrayBuffer, layers: LayerNoSamples[], layerSamples: { id: number; samples: SharedArrayBuffer }[]) {
    this.layers = layers;
    for (const { id, samples } of layerSamples) {
      this.samplesByLayerId.set(id, new Float32Array(samples));
    }
    this.state = SharedState.from(new Float32Array(state), new Float32Array(recordingBuffer));
    this.prevState = SharedState.new();
  }

  startRecording() {
    if (this.recordingLayer) {
      return;
    }

    this.recordingLayer = {
      id: Math.random(),
      lengthInFrames: getLengthInFrames(this.layers) ?? -1,
      frameOffset: this.state.playhead - this.state.latencyOffset * NUM_FRAMES_PER_CHUNK,
      numChannels: 1,
      numFramesRecorded: 0,
      soloed: false,
      muted: false,
      backwards: false,
      gain: 1,
    };
    this.state._recordingBuffer.fill(0);
    this.state.numFramesRecorded = 0;
    this.state.recordingFrameOffset = this.recordingLayer.frameOffset;
    this.samplesByLayerId.set(this.recordingLayer.id, this.state._recordingBuffer);
    this.say('started recording');
  }

  stopRecording() {
    if (!this.recordingLayer) {
      return;
    }

    if (this.recordingLayer.lengthInFrames < 0) {
      // this is the first layer we've recorded, so it determines the length of the loop
      this.recordingLayer.lengthInFrames = this.recordingLayer.numFramesRecorded;
    }
    if (this.layers.length === 0) {
      this.state.playhead = this.state.latencyOffset * NUM_FRAMES_PER_CHUNK;
    }
    const samples = this.state._recordingBuffer.slice(0, this.state.numFramesRecorded * this.recordingLayer.numChannels);
    this.samplesByLayerId.set(this.recordingLayer.id, samples);
    this.sendMessage({ event: 'finished recording', layer: this.recordingLayer, samples: samples.buffer as any });
    this.layers.push(this.recordingLayer);
    this.recordingLayer = null;
    this.say('stopped recording');
  }

  process(inputs: Float32Array[][], [output]: Float32Array[][], _parameters: any) {
    if (!this.state) {
      // wait until we've been initialized
      return true;
    }

    this.handleButtonPresses();

    const input = inputs[0];
    const numFrames = output[0].length;
    const noLayersAreSoloed = !this.layers.some((layer) => layer.soloed);
    for (let frameIdx = 0; frameIdx < numFrames; frameIdx++) {
      if (this.recordingLayer) {
        if (noLayersAreSoloed) {
          this.mixFrameInto(this.recordingLayer, output, frameIdx);
        }
        try {
          this.recordFrame(input, frameIdx);
        } catch (e) {
          console.log('--- ⬇️⬇️⬇️ ---');
          console.log(e);
          console.log('inputs', inputs);
          console.log('--- ⬆️⬆️⬆️ ---');
          throw e;
        }
      }
      for (const l of this.layers) {
        if (l.soloed || (!l.muted && noLayersAreSoloed)) {
          this.mixFrameInto(l, output, frameIdx);
        }
      }
      for (let ch = 0; ch < output.length; ch++) {
        output[ch][frameIdx] *= this.state.masterGain;
      }
      this.advancePlayhead();
    }
    return true;
  }

  handleButtonPresses() {
    if (!this.prevState.recording && this.state.recording) {
      this.startRecording();
    } else if (this.prevState.recording && !this.state.recording) {
      this.stopRecording();
    }
    this.prevState._state.set(this.state._state);
  }

  /**
   * Mixes the frame from this layer that's under the `playhead` into `outputs`.
   *
   * @param output the output buffers (one per channel)
   * @param outputFrameIdx the frame of the output buffers that we'll mix into
   * @param playhead playhead position (frame index) of the looper
   */
  mixFrameInto(layer: LayerNoSamples, output: Float32Array[], outputFrameIdx: number) {
    if (layer.lengthInFrames < 0) {
      return;
    }

    const frameIdx = this.state.playhead % layer.lengthInFrames;
    for (let channel = 0; channel < output.length; channel++) {
      output[channel][outputFrameIdx] += layer.gain * this.getSampleAt(layer, channel, frameIdx);
    }
  }

  /**
   * Returns the layer's contribution to `channel` for the specified frame.
   * @param frameIdx a value between 0 and lengthInFrames
   */
  getSampleAt(layer: LayerNoSamples, channel: number, frameIdx: number) {
    if (layer.numChannels === 1) {
      // If this layer is mono, mix its samples into all channels.
      channel = 0;
    } else if (layer.numChannels <= channel) {
      // This layer doesn't have a contribution for the specified channel.
      return 0;
    }

    let sample = 0;
    let sampleIdx = (frameIdx - layer.frameOffset) * layer.numChannels + channel;
    const numSamples = layer.numFramesRecorded * layer.numChannels;
    const samples = this.samplesByLayerId.get(layer.id);
    if (!samples) {
      // The samples for this layer haven't arrived yet (this will happen when we're running on automerge)
      return 0;
    }

    const numSamplesRecorded = layer.numFramesRecorded / layer.numChannels;
    while (sampleIdx < numSamples) {
      if (sampleIdx >= 0) {
        sample += samples[layer.backwards ? numSamplesRecorded - sampleIdx - 1 : sampleIdx];
      }
      sampleIdx += layer.lengthInFrames * layer.numChannels;
    }

    return sample;
  }

  recordFrame(input: Float32Array[], frameIdx: number) {
    if (!this.recordingLayer) {
      throw new Error('called recordFrame() when recordingLayer was null!');
    }

    if (input.length < this.recordingLayer.numChannels) {
      throw new Error(
        `recording ${this.recordingLayer.numChannels}-channel layer from ${input.length}-channel input`,
      );
    }

    let sampleIdx = this.recordingLayer.numFramesRecorded++ * this.recordingLayer.numChannels;
    const samples = this.samplesByLayerId.get(this.recordingLayer.id)!;
    // TODO: let the user record more than one channel if they want to
    samples[sampleIdx++] = input[this.state.channelToRecord][frameIdx];
    this.state.numFramesRecorded++;
  }

  advancePlayhead() {
    const lengthInFrames = getLengthInFrames(this.layers);
    this.state.playhead = lengthInFrames === null ? 0 : (this.state.playhead + 1) % lengthInFrames;
  }
}

registerProcessor('looper', Looper);