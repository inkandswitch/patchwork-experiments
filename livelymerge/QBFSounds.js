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
//   letterFall   -- ~3s descending scream when a tile starts tumbling off the rack
//   letterDrop   -- brassy single-note boop; pitch follows word length
//                  (low for lengths 1–2; rises from length 3 through a major chord)
//   letterUndrop -- short "zzwit" when delete retracts the most recent drop
//   wordCommit   -- two-trumpet ta-da on the same pitch as the last letter drop,
//                  growing louder for longer words
//   wordReject   -- flatulent raspberry when the word is invalid / repeated

// PER-USER: the shared AudioContext for this replica. Created lazily on first play.
$qbfAudioCtx = null;

// PER-USER: the audio-unlock listener, kept here so the runtime GC can't collect it.
$qbfAudioUnlock = null;

class QBFSoundsPlayer {
  constructor() {
    /**
     * Semitone offsets from root, indexed by outbox word length.
     * Lengths 1–2 stay on the root; length 3 begins the major-chord climb.
     * Stored as an array (not an object with numeric keys) so LivelyMerge
     * indexing is reliable.
     */
    this.pitchByLength = [0, 0, 0, 4, 7, 12, 16, 19, 24, 28];
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

  hzForWordLength(lenIfAny) {
    let steps = this.pitchByLength;
    let len = lenIfAny != null ? lenIfAny : 0;
    if (len < 0) len = 0;
    if (len >= steps.length) len = steps.length - 1;
    return this.rootHz * Math.pow(2, steps[len] / 12);
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
   * One brassy "trumpet" voice for fanfares: sawtooth through a mild low-pass,
   * with a tiny detuned twin for body.
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

  /**
   * Brassy single-note "boop" for letter drops -- brighter and buzzier than the
   * fanfare voice (which reads more mellow / piano-like when alone).
   */
  brassBoop(ctx, freq, t0, dur, peak) {
    let master = ctx.createGain();
    master.connect(ctx.destination);
    this.envelope(master, t0, peak, 0.012, Math.max(0.04, dur * 0.25), dur * 0.65);

    // Bright bandpass keeps the brass edge without going thin.
    let filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq * 2.2, t0);
    filter.Q.setValueAtTime(0.9, t0);
    filter.connect(master);

    let mk = (type, ratio, level) => {
      let osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq * ratio, t0);
      let g = ctx.createGain();
      g.gain.setValueAtTime(level, t0);
      osc.connect(g);
      g.connect(filter);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    };
    // Square + saw = brassier than soft saw alone.
    mk('square', 1, 0.4);
    mk('sawtooth', 1.002, 0.35);
    mk('sawtooth', 2, 0.22); // strong octave harmonic
    mk('square', 3, 0.08); // odd harmonic bite

    // Short "lip buzz" noise at the attack.
    let buzzLen = Math.floor(ctx.sampleRate * 0.04);
    let noiseBuffer = ctx.createBuffer(1, buzzLen, ctx.sampleRate);
    let data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < buzzLen; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    let noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    let noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(freq * 3, t0);
    noiseFilter.Q.setValueAtTime(1.5, t0);
    let noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.35, t0);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start(t0);
    noise.stop(t0 + 0.06);
  }

  /** A pair of trumpets a fifth apart -- used for the commit fanfare. */
  trumpetPair(ctx, rootHz, t0, dur, peak, envelopeOverridesIfAny) {
    this.trumpet(ctx, rootHz, t0, dur, peak, envelopeOverridesIfAny);
    this.trumpet(ctx, rootHz * 1.5, t0 + 0.02, dur * 0.9, peak * 0.75, envelopeOverridesIfAny);
  }

  letterFall() {
    /** ~3s scream of someone falling off a cliff. */
    let ctx = this.ensureContext();
    if (!ctx) return;
    let t0 = ctx.currentTime;
    let dur = 3.0;

    let master = ctx.createGain();
    master.connect(ctx.destination);
    this.envelope(master, t0, 0.45, 0.08, 1.8, 1.0);

    // Descending "Aaaahh!"
    let voice = ctx.createOscillator();
    voice.type = 'sawtooth';
    voice.frequency.setValueAtTime(880, t0);
    voice.frequency.exponentialRampToValueAtTime(90, t0 + dur);
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
    noiseFilter.frequency.exponentialRampToValueAtTime(160, t0 + dur);
    noiseFilter.Q.setValueAtTime(0.8, t0);
    let noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.25, t0);
    noiseGain.gain.exponentialRampToValueAtTime(0.04, t0 + dur);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start(t0);
    noise.stop(t0 + dur);
  }

  letterDrop(wordLengthIfAny) {
    /**
     * Brassy single-note boop when a letter lands in the outbox.
     * Pitch follows word length: low for 1–2, rising from 3 onward.
     */
    let ctx = this.ensureContext();
    if (!ctx) return;
    let len = wordLengthIfAny != null ? wordLengthIfAny : 0;
    let hz = this.hzForWordLength(len);
    let t0 = ctx.currentTime;
    this.brassBoop(ctx, hz, t0, 0.5, 0.28);
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

  wordCommit(wordLengthIfAny) {
    /**
     * Two-trumpet ta-da on the same pitch as the last letter-drop boop.
     * Louder for longer words -- a six-letter word should feel grand.
     */
    let ctx = this.ensureContext();
    if (!ctx) return;
    let len = wordLengthIfAny != null ? wordLengthIfAny : 1;
    let hz = this.hzForWordLength(len);
    // Peak grows with length past 2; six letters is satisfyingly loud.
    let peak = 0.26 + Math.max(0, len - 2) * 0.07;
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
