import BufferLoader from "./bufferloader";
import { Instrument } from "./instrument";

// Import all samples as URLs using Vite's ?url suffix
// These will be resolved relative to the module's base URL
import pianoG2 from "../../assets/samples/instruments/piano/G2.mp3?url";
import pianoG3 from "../../assets/samples/instruments/piano/G3.mp3?url";
import pianoG4 from "../../assets/samples/instruments/piano/G4.mp3?url";
import pianoG5 from "../../assets/samples/instruments/piano/G5.mp3?url";
import epianoG2 from "../../assets/samples/instruments/epiano/G2.mp3?url";
import epianoG3 from "../../assets/samples/instruments/epiano/G3.mp3?url";
import epianoG4 from "../../assets/samples/instruments/epiano/G4.mp3?url";
import epianoG5 from "../../assets/samples/instruments/epiano/G5.mp3?url";
import violaG2 from "../../assets/samples/instruments/viola/G2.mp3?url";
import violaG3 from "../../assets/samples/instruments/viola/G3.mp3?url";
import violaG4 from "../../assets/samples/instruments/viola/G4.mp3?url";
import violaG5 from "../../assets/samples/instruments/viola/G5.mp3?url";
import staccatoG2 from "../../assets/samples/instruments/staccato/G2.mp3?url";
import staccatoG3 from "../../assets/samples/instruments/staccato/G3.mp3?url";
import staccatoG4 from "../../assets/samples/instruments/staccato/G4.mp3?url";
import staccatoG5 from "../../assets/samples/instruments/staccato/G5.mp3?url";

// Drum samples
import cr78HiHat from "../../assets/samples/drums/CR-78/hi-hat.mp3?url";
import cr78Kick from "../../assets/samples/drums/CR-78/kick.mp3?url";
import cr78Snare from "../../assets/samples/drums/CR-78/snare.mp3?url";
import cr78Percussion from "../../assets/samples/drums/CR-78/percussion.mp3?url";
import drumTraksHiHat from "../../assets/samples/drums/drumTraks/hi-hat.mp3?url";
import drumTraksKick from "../../assets/samples/drums/drumTraks/kick.mp3?url";
import drumTraksSnare from "../../assets/samples/drums/drumTraks/snare.mp3?url";
import drumTraksPercussion from "../../assets/samples/drums/drumTraks/percussion.mp3?url";
import linnHiHat from "../../assets/samples/drums/linn/hi-hat.mp3?url";
import linnKick from "../../assets/samples/drums/linn/kick.mp3?url";
import linnSnare from "../../assets/samples/drums/linn/snare.mp3?url";
import linnPercussion from "../../assets/samples/drums/linn/percussion.mp3?url";

// Map from the old relative path format to the imported URLs
const SAMPLES: Record<string, string> = {
  "../../assets/samples/instruments/piano/G2.mp3": pianoG2,
  "../../assets/samples/instruments/piano/G3.mp3": pianoG3,
  "../../assets/samples/instruments/piano/G4.mp3": pianoG4,
  "../../assets/samples/instruments/piano/G5.mp3": pianoG5,
  "../../assets/samples/instruments/epiano/G2.mp3": epianoG2,
  "../../assets/samples/instruments/epiano/G3.mp3": epianoG3,
  "../../assets/samples/instruments/epiano/G4.mp3": epianoG4,
  "../../assets/samples/instruments/epiano/G5.mp3": epianoG5,
  "../../assets/samples/instruments/viola/G2.mp3": violaG2,
  "../../assets/samples/instruments/viola/G3.mp3": violaG3,
  "../../assets/samples/instruments/viola/G4.mp3": violaG4,
  "../../assets/samples/instruments/viola/G5.mp3": violaG5,
  "../../assets/samples/instruments/staccato/G2.mp3": staccatoG2,
  "../../assets/samples/instruments/staccato/G3.mp3": staccatoG3,
  "../../assets/samples/instruments/staccato/G4.mp3": staccatoG4,
  "../../assets/samples/instruments/staccato/G5.mp3": staccatoG5,
  "../../assets/samples/drums/CR-78/hi-hat.mp3": cr78HiHat,
  "../../assets/samples/drums/CR-78/kick.mp3": cr78Kick,
  "../../assets/samples/drums/CR-78/snare.mp3": cr78Snare,
  "../../assets/samples/drums/CR-78/percussion.mp3": cr78Percussion,
  "../../assets/samples/drums/drumTraks/hi-hat.mp3": drumTraksHiHat,
  "../../assets/samples/drums/drumTraks/kick.mp3": drumTraksKick,
  "../../assets/samples/drums/drumTraks/snare.mp3": drumTraksSnare,
  "../../assets/samples/drums/drumTraks/percussion.mp3": drumTraksPercussion,
  "../../assets/samples/drums/linn/hi-hat.mp3": linnHiHat,
  "../../assets/samples/drums/linn/kick.mp3": linnKick,
  "../../assets/samples/drums/linn/snare.mp3": linnSnare,
  "../../assets/samples/drums/linn/percussion.mp3": linnPercussion,
};

export interface SamplePlayerConfig {
  name(): string;
  sampleUrls(): string[];
  sampleIdx(note: string): number;
  modifiedVolume(baseVolume: number, note: string): number;
  attack(note: string): number;
  sustain(note: string): number;
  updateSourcePlaybackRate(
    note: string,
    sampleIdx: number,
    source: AudioBufferSourceNode
  ): void;
}

export class SamplePlayer implements Instrument {
  samplePlayerConfig: SamplePlayerConfig;
  bufferList: any[];
  sampleUrls: string[];
  context: AudioContext | null;
  volumeModifier: number;
  destination: AudioDestinationNode | null;
  bufferLoader: BufferLoader;
  completeLoaded: ((instrument: Instrument) => void) | null;
  scheduledSources: AudioBufferSourceNode[]; // For stopping scheduled events early.

  constructor(samplePlayerConfig: SamplePlayerConfig, volumeModifier: number) {
    this.samplePlayerConfig = samplePlayerConfig;
    this.bufferList = [];
    const rawUrls = this.samplePlayerConfig.sampleUrls();
    console.log("[SamplePlayer] Raw sample URLs from config:", rawUrls);
    this.sampleUrls = rawUrls.map((url) => {
      const resolved = SAMPLES[url];
      if (!resolved) {
        console.error("[SamplePlayer] No SAMPLES entry for:", url);
      }
      return resolved as string;
    });
    console.log("[SamplePlayer] Resolved sample URLs:", this.sampleUrls);
    this.context = null;
    this.volumeModifier = volumeModifier;
    this.destination = null;
    this.bufferLoader = new BufferLoader(
      this.sampleUrls,
      this.finishedLoading().bind(this)
    );
    this.completeLoaded = null;
    this.scheduledSources = []; // For stopping scheduled events early.
  }

  initContext(
    context: AudioContext,
    completeLoaded: (instrument: Instrument) => void
  ) {
    this.context = context;
    this.completeLoaded = completeLoaded;
    let bufferLoader = new BufferLoader(
      this.sampleUrls,
      this.finishedLoading().bind(this)
    );
    bufferLoader.load(this.context);
    this.bufferLoader = bufferLoader;
    this.connect(context.destination);
  }

  name(): string {
    return this.samplePlayerConfig.name();
  }

  finishedLoading(): (bufferList: any[]) => void {
    let samplePlayer: Instrument = this;
    return (bufferList: any[]) => {
      this.bufferList = bufferList;
      if (this.completeLoaded) {
        this.completeLoaded(samplePlayer);
      } else {
        console.log("Something weird happened!");
      }
    };
  }

  connect(destination: AudioDestinationNode) {
    this.destination = destination;
  }

  stop() {
    for (let s of this.scheduledSources) {
      s.stop();
    }
    this.scheduledSources = [];
  }

  updateVolumeModifier(volumeModifier: number) {
    this.volumeModifier = volumeModifier;
  }

  playSound(note: string, time: number, duration: number, origVolume: number) {
    if (!this.context) {
      console.error("SamplePlayer expected AudioContext to be loaded.");
      return;
    }
    if (!this.destination) {
      console.error("SamplePlayer expected destination to be connected.");
      return;
    }
    let source = this.context.createBufferSource();
    this.scheduledSources.push(source);

    let sampleIdx = this.samplePlayerConfig.sampleIdx(note);
    source.buffer = this.bufferList[sampleIdx];
    this.samplePlayerConfig.updateSourcePlaybackRate(note, sampleIdx, source);
    let volume = this.samplePlayerConfig.modifiedVolume(origVolume, note);
    let attack = this.samplePlayerConfig.attack(note);
    let sustain = this.samplePlayerConfig.sustain(note);

    volume = volume * this.volumeModifier;

    let gainNode = this.context.createGain();
    source.connect(gainNode);
    gainNode.connect(this.destination);
    source.start(time);

    let decay = sustain + 0.1;
    gainNode.gain.setValueAtTime(0.0, time);
    gainNode.gain.linearRampToValueAtTime(volume, time + attack);
    gainNode.gain.setValueAtTime(volume, time + duration + sustain);
    gainNode.gain.linearRampToValueAtTime(0.0, time + duration + decay);
    source.stop(time + duration + decay);
  }
}
