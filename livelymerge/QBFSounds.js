//  QBFSounds -- optional event sounds for the Quick Brown Fox
// ----------------------------------------------------------
// Load this beside QBF.js. While it is loaded, QBFMorph events call into
// QBFSounds through qbfSound(...) (defined in QBF.js). With no QBFSounds.js,
// those calls are quiet no-ops.
//
// Sounds are synthesized with the Web Audio API -- no sample files needed.
// The AudioContext lives in $qbfAudioCtx (per-user / ephemeral) because a
// host AudioContext must never enter the Automerge document.
//
// Events:
//   letterFall   -- ~1.5s descending scream when a tile starts tumbling off the rack
//   letterDrop   -- single trumpet blat; pitch follows the word multiplier
//                  (low for x0/x1, then each step up a major-chord arpeggio)
//   letterUndrop -- short "zzwit" when delete retracts the most recent drop
//   wordCommit   -- two-trumpet ta-da on the same pitch as the last letter drop,
//                  growing louder (and higher with the multiplier) for longer words
//   wordReject   -- flatulent raspberry when the word is invalid / repeated

// PER-USER: the shared AudioContext for this replica. Created lazily on first play.
$qbfAudioCtx = null;

// PER-USER: the audio-unlock listener, kept here so the runtime GC can't collect it.
$qbfAudioUnlock = null;

class QBFSoundsPlayer {
  constructor() {
    /**
     * Major-chord arpeggio offsets in semitones from a low root, keyed by the
     * game's word-length multiplier (0..7). Multipliers 0 and 1 share the root.
     */
    this.chordSteps = {
      0: 0,
      1: 0,
      2: 4, // major third
      3: 7, // perfect fifth
      4: 12, // octave
      5: 16, // octave + third
      6: 19, // octave + fifth
      7: 24, // two octaves
    };
    this.rootHz = 196; // G3 -- a roomy low trumpet root
  }

  ensureContext() {
    if ($qbfAudioCtx) {
      if ($qbfAudioCtx.state === 'suspended') {
        try {
          $qbfAudioCtx.resume();
        } catch (err) {
          /* ignore */
        }
      }
      return $qbfAudioCtx;
    }
    let AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    $qbfAudioCtx = new AC();
    if ($qbfAudioCtx.state === 'suspended') {
      try {
        $qbfAudioCtx.resume();
      } catch (err) {
        /* ignore */
      }
    }
    return $qbfAudioCtx;
  }

  now() {
    let ctx = this.ensureContext();
    return ctx ? ctx.currentTime : 0;
  }

  hzForMultiplier(mult) {
    let steps = this.chordSteps;
    let semis = steps[mult] != null ? steps[mult] : steps[0];
    return this.rootHz * Math.pow(2, semis / 12);
  }

  /** Soft gain envelope: attack, hold, release. */
  envelope(gainNode, t0, peak, attack, hold, release) {
    let g = gainNode.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + attack);
    g.setValueAtTime(Math.max(0.0001, peak), t0 + attack + hold);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
  }

  /**
   * One brassy "trumpet" voice: slightly bright sawtooth through a mild
   * low-pass, with a tiny detuned twin for body.
   * Optional envelopeOverrides: { attack, hold, release } in seconds.
   */
  trumpet(ctx, freq, t0, dur, peak, envelopeOverridesIfAny) {
    let env = envelopeOverridesIfAny || {};
    let attack = env.attack != null ? env.attack : 0.02;
    let release = env.release != null ? env.release : 0.1;
    let hold =
      env.hold != null ? env.hold : Math.max(0.05, dur - attack - release);

    let master = ctx.createGain();
    master.connect(ctx.destination);
    this.envelope(master, t0, peak, attack, hold, release);

    let filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 4, t0);
    filter.Q.setValueAtTime(0.7, t0);
    filter.connect(master);

    let mk = (ratio, level) => {
      let osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq * ratio, t0);
      let g = ctx.createGain();
      g.gain.setValueAtTime(level, t0);
      osc.connect(g);
      g.connect(filter);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    };
    mk(1, 0.55);
    mk(1.003, 0.35); // chorus-ish twin
    mk(2, 0.12); // quiet octave for brass bite
  }

  /** A pair of trumpets a fifth apart -- used for the commit fanfare. */
  trumpetPair(ctx, rootHz, t0, dur, peak, envelopeOverridesIfAny) {
    this.trumpet(ctx, rootHz, t0, dur, peak, envelopeOverridesIfAny);
    this.trumpet(ctx, rootHz * 1.5, t0 + 0.02, dur * 0.9, peak * 0.75, envelopeOverridesIfAny);
  }

  letterFall() {
    /** ~1.5s scream of someone falling off a cliff. */
    let ctx = this.ensureContext();
    if (!ctx) return;
    let t0 = ctx.currentTime;
    let dur = 1.5;

    let master = ctx.createGain();
    master.connect(ctx.destination);
    this.envelope(master, t0, 0.45, 0.06, 0.85, 0.55);

    // Descending "Aaaahh!"
    let voice = ctx.createOscillator();
    voice.type = 'sawtooth';
    voice.frequency.setValueAtTime(880, t0);
    voice.frequency.exponentialRampToValueAtTime(110, t0 + dur);
    let voiceGain = ctx.createGain();
    voiceGain.gain.setValueAtTime(0.35, t0);
    voice.connect(voiceGain);
    voiceGain.connect(master);
    voice.start(t0);
    voice.stop(t0 + dur + 0.05);

    // Air / wind as they fall.
    let bufferSize = Math.floor(ctx.sampleRate * dur);
    let noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    let data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    let noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    let noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(1200, t0);
    noiseFilter.frequency.exponentialRampToValueAtTime(200, t0 + dur);
    noiseFilter.Q.setValueAtTime(0.8, t0);
    let noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.25, t0);
    noiseGain.gain.exponentialRampToValueAtTime(0.05, t0 + dur);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start(t0);
    noise.stop(t0 + dur);
  }

  letterDrop(multIfAny) {
    /**
     * Single trumpet blat when a letter lands in the outbox.
     * Pitch follows the current word multiplier (major-chord steps).
     * Softer, more gradual release than a staccato peep.
     */
    let ctx = this.ensureContext();
    if (!ctx) return;
    let mult = multIfAny != null ? multIfAny : 0;
    let hz = this.hzForMultiplier(mult);
    let t0 = ctx.currentTime;
    this.trumpet(ctx, hz, t0, 0.55, 0.2, { attack: 0.025, hold: 0.12, release: 0.4 });
  }

  letterUndrop() {
    /** A quick "zzwit" when delete retracts the most recent outbox letter. */
    let ctx = this.ensureContext();
    if (!ctx) return;
    let t0 = ctx.currentTime;
    let dur = 0.12;

    let master = ctx.createGain();
    master.connect(ctx.destination);
    this.envelope(master, t0, 0.48, 0.005, 0.04, 0.07);

    // Fast descending chirp.
    let osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1400, t0);
    osc.frequency.exponentialRampToValueAtTime(280, t0 + dur);
    let oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.55, t0);
    osc.connect(oscGain);
    oscGain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);

    // Brief bandpassed noise for the "zz" texture.
    let bufferSize = Math.floor(ctx.sampleRate * dur);
    let noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    let data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    let noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    let noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(2200, t0);
    noiseFilter.frequency.exponentialRampToValueAtTime(600, t0 + dur);
    noiseFilter.Q.setValueAtTime(3, t0);
    let noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.65, t0);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, t0 + dur);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start(t0);
    noise.stop(t0 + dur);
  }

  wordCommit(multIfAny) {
    /**
     * Two-trumpet ta-da on the same pitch as the last letter-drop blat.
     * Louder for higher multipliers -- a six-letter word (x4) should feel grand.
     */
    let ctx = this.ensureContext();
    if (!ctx) return;
    let mult = multIfAny != null ? multIfAny : 1;
    let hz = this.hzForMultiplier(mult);
    // Peak grows with the multiplier; x4 (six letters) is satisfyingly loud.
    let peak = 0.28 + mult * 0.07;
    if (peak > 0.62) peak = 0.62;
    let softEnv = { attack: 0.02, hold: 0.04, release: 0.12 };
    let t0 = ctx.currentTime;
    // "Ta" -- short pickup; pair of trumpets on the drop pitch (root + fifth).
    this.trumpetPair(ctx, hz, t0, 0.16, peak, softEnv);
    // "Daa" -- same pitch restated immediately, louder and longer.
    this.trumpetPair(ctx, hz, t0 + 0.14, 0.85, peak * 1.15, {
      attack: 0.02,
      hold: 0.28,
      release: 0.5,
    });
  }

  wordReject() {
    /** A rude little fart for an invalid or repeated word. */
    let ctx = this.ensureContext();
    if (!ctx) return;
    let t0 = ctx.currentTime;
    let dur = 0.55;

    let master = ctx.createGain();
    master.connect(ctx.destination);
    this.envelope(master, t0, 0.55, 0.01, 0.25, 0.28);

    // Low fluttering oscillator.
    let osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(90, t0);
    osc.frequency.exponentialRampToValueAtTime(45, t0 + dur);
    // Vibrato / sputter.
    let lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(18, t0);
    let lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(25, t0);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    lfo.start(t0);
    lfo.stop(t0 + dur);

    let filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(280, t0);
    filter.frequency.exponentialRampToValueAtTime(80, t0 + dur);
    filter.Q.setValueAtTime(4, t0);

    osc.connect(filter);
    filter.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);

    // A puff of filtered noise for texture.
    let bufferSize = Math.floor(ctx.sampleRate * dur);
    let noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    let data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    let noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    let noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(160, t0);
    noiseFilter.Q.setValueAtTime(2, t0);
    let noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.35, t0);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, t0 + dur);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start(t0);
    noise.stop(t0 + dur);
  }

  static new(...args) {
    return new this(...args);
  }
}

// Singleton used by qbfSound(...). Re-evaluating this file replaces it.
QBFSounds = new QBFSoundsPlayer();

function qbfInstallAudioUnlock() {
  /**
   * Browsers keep an AudioContext suspended until resume() is called inside a
   * real user gesture. LivelyMerge queues DOM events and handles them later in
   * the rAF loop, which the autoplay policy does not count as a gesture -- so
   * without this hook the context would stay suspended and QBF would be mute.
   * These listeners run in the actual gesture and unlock audio the first time
   * the user clicks or types; after that they are effectively no-ops.
   */
  if ($qbfAudioUnlock) return; // already installed (file re-evaluated)
  if (!window.addEventListener) return; // e.g. the Node test harness
  let unlock = () => QBFSounds.ensureContext();
  $qbfAudioUnlock = unlock;
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}
qbfInstallAudioUnlock();
