/**
 * Sound Editor — GoldWave-inspired waveform editor with full DSP effects.
 *
 * All effects are implemented as pure JS DSP on Float32Arrays — no external
 * dependencies. Features: zoom, scroll, selection, cut/copy/paste/mix-paste,
 * trim, silence, fade in/out, reverse, invert, amplify, echo, speed change,
 * normalize, undo/redo, loop playback, time ruler, flanger, phaser, comb
 * filter, chorus, tremolo, vibrato, bitcrusher, ring modulator, compressor,
 * noise gate, biquad filters (LP/HP/BP/notch/peak/shelf), distortion,
 * algorithmic reverb, DC offset removal, wahwah, pitch shift, LPC vocoder.
 */

import {subscribe} from "@inkandswitch/patchwork-providers"

const DPI = window.devicePixelRatio || 1

const STYLES = `
	.sound-editor {
		width: 100%;
		height: 100%;
		background: #0a0a14;
		display: flex;
		flex-direction: column;
		user-select: none;
		-webkit-user-select: none;
		position: relative;
		overflow: hidden;
		font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
		color: #ccc;
	}

	/* ── Menubar ── */
	.se-menubar {
		display: flex;
		gap: 0;
		background: #1a1a2e;
		border-bottom: 1px solid #333;
		flex-shrink: 0;
		font-size: 12px;
		position: relative;
		z-index: 100;
	}
	.se-menu-item {
		position: relative;
		padding: 4px 10px;
		cursor: pointer;
		color: #bbb;
	}
	.se-menu-item:hover, .se-menu-item.open {
		background: #2a2a4e;
		color: #fff;
	}
	.se-menu-dropdown {
		display: none;
		position: absolute;
		left: 0;
		top: 100%;
		background: #1e1e32;
		border: 1px solid #444;
		min-width: 220px;
		z-index: 200;
		box-shadow: 0 4px 12px rgba(0,0,0,0.5);
		max-height: 80vh;
		overflow-y: auto;
	}
	.se-menu-item {
		position: relative;
	}
	.se-menu-item.open > .se-menu-dropdown {
		display: block;
	}
	.se-menu-dropdown .se-menu-action {
		display: flex;
		justify-content: space-between;
		padding: 5px 12px;
		cursor: pointer;
		color: #ccc;
		white-space: nowrap;
	}
	.se-menu-dropdown .se-menu-action:hover {
		background: #3a3a5e;
		color: #fff;
	}
	.se-menu-dropdown .se-menu-action[data-disabled="true"] {
		opacity: 0.35;
		pointer-events: none;
	}
	.se-menu-dropdown .se-menu-action .shortcut {
		color: #777;
		margin-left: 24px;
		font-size: 11px;
	}
	.se-menu-sep {
		height: 1px;
		background: #333;
		margin: 2px 0;
	}
	.se-menu-header {
		padding: 4px 12px 2px;
		font-size: 10px;
		color: #666;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	/* ── Transport toolbar ── */
	.se-transport {
		display: flex;
		gap: 2px;
		padding: 4px 8px;
		background: #12122a;
		border-bottom: 1px solid #222;
		flex-shrink: 0;
		align-items: center;
	}
	.se-transport button {
		background: #1e1e3a;
		border: 1px solid #3a3a5e;
		color: #aaf;
		width: 32px;
		height: 28px;
		border-radius: 3px;
		cursor: pointer;
		font-size: 14px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
	}
	.se-transport button:hover {
		background: #2e2e5a;
		color: #ccf;
	}
	.se-transport button:active, .se-transport button.active {
		background: #4444aa;
		color: #fff;
	}
	.se-transport button[disabled] {
		opacity: 0.3;
		cursor: default;
	}
	.se-transport .sep {
		width: 12px;
	}
	.se-transport button.rec-active {
		background: #c0392b;
		color: #fff;
		border-color: #e74c3c;
		animation: se-rec-blink 1s ease-in-out infinite;
	}
	@keyframes se-rec-blink {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.6; }
	}

	/* ── Position display ── */
	.se-position {
		background: #000;
		border: 1px solid #333;
		padding: 2px 10px;
		margin: 0 8px;
		font-family: "Consolas", "SF Mono", monospace;
		font-size: 13px;
		color: #0f0;
		min-width: 180px;
		text-align: center;
		border-radius: 2px;
	}

	/* ── Canvas area ── */
	.se-canvas-area {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		position: relative;
	}

	.se-ruler {
		height: 22px;
		background: #16162e;
		border-bottom: 1px solid #333;
		flex-shrink: 0;
		position: relative;
		overflow: hidden;
	}
	.se-ruler canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.se-waveform-wrap {
		flex: 1;
		position: relative;
		cursor: text;
		min-height: 0;
	}
	.se-waveform-wrap canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	/* ── Overview (minimap) ── */
	.se-overview {
		height: 40px;
		background: #0e0e1e;
		border-top: 1px solid #333;
		flex-shrink: 0;
		position: relative;
		cursor: pointer;
	}
	.se-overview canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	.se-overview .se-viewport-indicator {
		position: absolute;
		top: 0;
		bottom: 0;
		background: rgba(100, 100, 255, 0.15);
		border-left: 1px solid rgba(100, 100, 255, 0.5);
		border-right: 1px solid rgba(100, 100, 255, 0.5);
		pointer-events: none;
	}

	/* ── Scrollbar ── */
	.se-scrollbar {
		height: 14px;
		background: #111;
		border-top: 1px solid #222;
		flex-shrink: 0;
		position: relative;
		cursor: pointer;
	}
	.se-scrollbar-thumb {
		position: absolute;
		top: 2px;
		bottom: 2px;
		background: #3a3a6e;
		border-radius: 4px;
		min-width: 20px;
		cursor: grab;
	}
	.se-scrollbar-thumb:hover {
		background: #5555aa;
	}

	/* ── Status bar ── */
	.se-status {
		display: flex;
		gap: 16px;
		padding: 3px 10px;
		background: #16162e;
		border-top: 1px solid #333;
		flex-shrink: 0;
		font-size: 11px;
		color: #888;
		font-family: "Consolas", "SF Mono", monospace;
	}
	.se-status span {
		white-space: nowrap;
	}

	.se-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		color: #555;
		font-size: 14px;
		height: 100%;
	}

	/* ── Dialog overlay ── */
	.se-dialog-overlay {
		position: absolute;
		inset: 0;
		background: rgba(0,0,0,0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}
	.se-dialog {
		background: #1e1e32;
		border: 1px solid #555;
		border-radius: 6px;
		padding: 16px 20px;
		min-width: 300px;
		max-width: 420px;
		box-shadow: 0 8px 24px rgba(0,0,0,0.5);
	}
	.se-dialog h3 {
		margin: 0 0 12px 0;
		font-size: 14px;
		color: #ddd;
	}
	.se-dialog label {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
		font-size: 12px;
		color: #bbb;
	}
	.se-dialog input[type="range"] {
		flex: 1;
	}
	.se-dialog input[type="number"], .se-dialog select {
		background: #111;
		border: 1px solid #444;
		color: #ddd;
		padding: 3px 6px;
		border-radius: 3px;
		font-size: 12px;
		width: 70px;
	}
	.se-dialog .se-dialog-buttons {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
		margin-top: 14px;
		align-items: center;
	}
	.se-dialog .se-dialog-buttons .se-preview-group {
		display: flex;
		gap: 4px;
		margin-right: auto;
	}
	.se-dialog button {
		background: #2a2a5e;
		border: 1px solid #555;
		color: #ccc;
		padding: 5px 16px;
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
	}
	.se-dialog button:hover {
		background: #3a3a7e;
		color: #fff;
	}
	.se-dialog button.primary {
		background: #4444aa;
		color: #fff;
	}
	.se-dialog button.primary:hover {
		background: #5555cc;
	}
	.se-dialog button.preview-btn {
		background: #2a5e2a;
		border-color: #4a4;
		color: #afa;
	}
	.se-dialog button.preview-btn:hover {
		background: #3a7e3a;
		color: #fff;
	}
	.se-dialog button.preview-btn.playing {
		background: #5a3a1a;
		border-color: #a84;
		color: #fda;
	}
	.se-dialog button.stop-btn {
		background: #5e2a2a;
		border-color: #a44;
		color: #faa;
	}
	.se-dialog button.stop-btn:hover {
		background: #7e3a3a;
		color: #fff;
	}
	.se-dialog .se-dialog-desc {
		font-size: 11px;
		color: #777;
		margin-bottom: 10px;
		line-height: 1.4;
	}

	/* ── Peer presence labels ── */
	.se-peer-label {
		position: absolute;
		top: 2px;
		font-size: 9px;
		padding: 1px 4px;
		border-radius: 2px;
		color: #fff;
		pointer-events: none;
		white-space: nowrap;
		z-index: 10;
		font-family: "Segoe UI", system-ui, sans-serif;
		opacity: 0.85;
	}
`

// ══════════════════════════════════════════════════════════════════════════════
// DSP LIBRARY — pure Float32Array processing, no Web Audio API needed
// ══════════════════════════════════════════════════════════════════════════════

function clamp(v, lo, hi) {
	return v < lo ? lo : v > hi ? hi : v
}

// ── Biquad filter (Direct Form II Transposed) ──
// Used by: lowpass, highpass, bandpass, notch, peaking, lowshelf, highshelf,
//          phaser (allpass stages), wahwah

function biquadCoeffs(type, sr, freq, Q, gainDb) {
	const w0 = 2 * Math.PI * freq / sr
	const cosw0 = Math.cos(w0)
	const sinw0 = Math.sin(w0)
	const alpha = sinw0 / (2 * Q)
	const A = gainDb !== undefined ? Math.pow(10, gainDb / 40) : 1

	let b0, b1, b2, a0, a1, a2
	switch (type) {
		case "lowpass":
			b0 = (1 - cosw0) / 2; b1 = 1 - cosw0; b2 = b0
			a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha; break
		case "highpass":
			b0 = (1 + cosw0) / 2; b1 = -(1 + cosw0); b2 = b0
			a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha; break
		case "bandpass":
			b0 = alpha; b1 = 0; b2 = -alpha
			a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha; break
		case "notch":
			b0 = 1; b1 = -2 * cosw0; b2 = 1
			a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha; break
		case "allpass":
			b0 = 1 - alpha; b1 = -2 * cosw0; b2 = 1 + alpha
			a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha; break
		case "peaking": {
			const alphaA = alpha * A
			const alphaDA = alpha / A
			b0 = 1 + alphaA; b1 = -2 * cosw0; b2 = 1 - alphaA
			a0 = 1 + alphaDA; a1 = -2 * cosw0; a2 = 1 - alphaDA; break
		}
		case "lowshelf": {
			const sq = 2 * Math.sqrt(A) * alpha
			b0 = A * ((A + 1) - (A - 1) * cosw0 + sq)
			b1 = 2 * A * ((A - 1) - (A + 1) * cosw0)
			b2 = A * ((A + 1) - (A - 1) * cosw0 - sq)
			a0 = (A + 1) + (A - 1) * cosw0 + sq
			a1 = -2 * ((A - 1) + (A + 1) * cosw0)
			a2 = (A + 1) + (A - 1) * cosw0 - sq; break
		}
		case "highshelf": {
			const sq = 2 * Math.sqrt(A) * alpha
			b0 = A * ((A + 1) + (A - 1) * cosw0 + sq)
			b1 = -2 * A * ((A - 1) + (A + 1) * cosw0)
			b2 = A * ((A + 1) + (A - 1) * cosw0 - sq)
			a0 = (A + 1) - (A - 1) * cosw0 + sq
			a1 = 2 * ((A - 1) - (A + 1) * cosw0)
			a2 = (A + 1) - (A - 1) * cosw0 - sq; break
		}
		default:
			b0 = 1; b1 = 0; b2 = 0; a0 = 1; a1 = 0; a2 = 0
	}
	return {
		b0: b0 / a0, b1: b1 / a0, b2: b2 / a0,
		a1: a1 / a0, a2: a2 / a0,
	}
}

function applyBiquad(data, s, e, coeffs) {
	const {b0, b1, b2, a1, a2} = coeffs
	let z1 = 0, z2 = 0
	for (let i = s; i < e; i++) {
		const x = data[i]
		const y = b0 * x + z1
		z1 = b1 * x - a1 * y + z2
		z2 = b2 * x - a2 * y
		data[i] = y
	}
}

// ── Flanger ──
// Short modulated delay (1-10ms) + feedback, mixed with dry signal

function dspFlanger(data, s, e, sr, rate, depth, feedback, mix) {
	const maxDelay = Math.floor(0.01 * sr) // 10ms max
	const buf = new Float32Array(maxDelay + 1)
	let writeIdx = 0
	for (let i = s; i < e; i++) {
		const lfo = (1 + Math.sin(2 * Math.PI * rate * (i - s) / sr)) / 2
		const delaySamples = 1 + lfo * depth * maxDelay
		const readIdx = writeIdx - delaySamples
		let readPos = readIdx % buf.length
		if (readPos < 0) readPos += buf.length
		const lo = Math.floor(readPos)
		const hi = (lo + 1) % buf.length
		const frac = readPos - lo
		const delayed = buf[lo] * (1 - frac) + buf[hi] * frac
		const wet = data[i] + delayed * feedback
		buf[writeIdx % buf.length] = clamp(wet, -1, 1)
		writeIdx++
		data[i] = clamp(data[i] * (1 - mix) + delayed * mix, -1, 1)
	}
}

// ── Phaser ──
// Chain of allpass filters with LFO-modulated center frequency

function dspPhaser(data, s, e, sr, rate, depth, feedback, stages) {
	const minFreq = 200
	const maxFreq = 4000
	// State for each allpass stage
	const state = Array.from({length: stages}, () => ({z1: 0, z2: 0}))
	let fbSample = 0
	for (let i = s; i < e; i++) {
		const lfo = (1 + Math.sin(2 * Math.PI * rate * (i - s) / sr)) / 2
		const freq = minFreq + lfo * depth * (maxFreq - minFreq)
		const w0 = 2 * Math.PI * freq / sr
		const cosw0 = Math.cos(w0)
		const sinw0 = Math.sin(w0)
		const alpha = sinw0 / (2 * 0.707)
		// Allpass coefficients
		const apB0 = (1 - alpha) / (1 + alpha)
		const apB1 = (-2 * cosw0) / (1 + alpha)
		const apA1 = apB1
		const apA2 = apB0

		let x = data[i] + fbSample * feedback
		// Process through allpass chain (1st order approximation for speed)
		for (let st = 0; st < stages; st++) {
			const ss = state[st]
			const y = apB0 * x + ss.z1
			ss.z1 = apB1 * x - apA1 * y + ss.z2
			ss.z2 = x - apA2 * y // simplified 2nd order allpass
			x = y
		}
		fbSample = x
		data[i] = clamp((data[i] + x) * 0.5, -1, 1)
	}
}

// ── Comb filter ──
// Feedforward + feedback comb filter

function dspComb(data, s, e, sr, delayMs, feedforward, feedback) {
	const delaySamples = Math.max(1, Math.floor(delayMs / 1000 * sr))
	const buf = new Float32Array(delaySamples)
	let idx = 0
	for (let i = s; i < e; i++) {
		const delayed = buf[idx]
		const input = data[i]
		buf[idx] = clamp(input + delayed * feedback, -1, 1)
		idx = (idx + 1) % delaySamples
		data[i] = clamp(input * (1 - feedforward) + delayed * feedforward, -1, 1)
	}
}

// ── Chorus ──
// Multiple detuned delay lines mixed together

function dspChorus(data, s, e, sr, rate, depth, voices, mix) {
	const maxDelay = Math.floor(0.03 * sr) // 30ms
	const bufs = Array.from({length: voices}, () => new Float32Array(maxDelay + 1))
	const writeIdxs = new Array(voices).fill(0)
	const out = new Float32Array(e - s)
	for (let i = 0; i < e - s; i++) {
		let wet = 0
		for (let v = 0; v < voices; v++) {
			const phase = (2 * Math.PI * rate * i / sr) + (v * 2 * Math.PI / voices)
			const lfo = (1 + Math.sin(phase)) / 2
			const delaySamples = 5 + lfo * depth * maxDelay
			bufs[v][writeIdxs[v] % bufs[v].length] = data[s + i]
			const readIdx = writeIdxs[v] - delaySamples
			let readPos = readIdx % bufs[v].length
			if (readPos < 0) readPos += bufs[v].length
			const lo = Math.floor(readPos)
			const hi = (lo + 1) % bufs[v].length
			const frac = readPos - lo
			wet += bufs[v][lo] * (1 - frac) + bufs[v][hi] * frac
			writeIdxs[v]++
		}
		out[i] = wet / voices
	}
	for (let i = 0; i < e - s; i++) {
		data[s + i] = clamp(data[s + i] * (1 - mix) + out[i] * mix, -1, 1)
	}
}

// ── Tremolo ──
// Amplitude modulation by LFO

function dspTremolo(data, s, e, sr, rate, depth) {
	for (let i = s; i < e; i++) {
		const lfo = (1 + Math.sin(2 * Math.PI * rate * (i - s) / sr)) / 2
		const gain = 1 - depth + lfo * depth
		data[i] *= gain
	}
}

// ── Vibrato ──
// Pitch modulation via variable delay

function dspVibrato(data, s, e, sr, rate, depth) {
	const maxDelay = Math.floor(0.01 * sr) // 10ms
	const buf = new Float32Array(maxDelay * 2 + 1)
	let writeIdx = 0
	const out = new Float32Array(e - s)
	for (let i = 0; i < e - s; i++) {
		buf[writeIdx % buf.length] = data[s + i]
		const lfo = Math.sin(2 * Math.PI * rate * i / sr)
		const delaySamples = maxDelay + lfo * depth * maxDelay
		const readIdx = writeIdx - delaySamples
		let readPos = readIdx % buf.length
		if (readPos < 0) readPos += buf.length
		const lo = Math.floor(readPos)
		const hi = (lo + 1) % buf.length
		const frac = readPos - lo
		out[i] = buf[lo] * (1 - frac) + buf[hi] * frac
		writeIdx++
	}
	for (let i = 0; i < e - s; i++) data[s + i] = out[i]
}

// ── Bitcrusher ──
// Reduce bit depth and effective sample rate

function dspBitcrusher(data, s, e, sr, bits, downsample) {
	const levels = Math.pow(2, bits)
	let hold = 0
	for (let i = s; i < e; i++) {
		if ((i - s) % downsample === 0) {
			hold = Math.round(data[i] * levels) / levels
		}
		data[i] = clamp(hold, -1, 1)
	}
}

// ── Ring modulator ──
// Multiply signal by carrier oscillator

function dspRingMod(data, s, e, sr, freq, mix) {
	for (let i = s; i < e; i++) {
		const carrier = Math.sin(2 * Math.PI * freq * (i - s) / sr)
		data[i] = clamp(data[i] * (1 - mix) + data[i] * carrier * mix, -1, 1)
	}
}

// ── Compressor ──
// Simple envelope-following compressor

function dspCompressor(data, s, e, sr, thresholdDb, ratio, attackMs, releaseMs, makeupDb) {
	const threshold = Math.pow(10, thresholdDb / 20)
	const attack = Math.exp(-1 / (attackMs / 1000 * sr))
	const release = Math.exp(-1 / (releaseMs / 1000 * sr))
	const makeup = Math.pow(10, makeupDb / 20)
	let env = 0
	for (let i = s; i < e; i++) {
		const abs = Math.abs(data[i])
		if (abs > env) env = attack * env + (1 - attack) * abs
		else env = release * env + (1 - release) * abs
		let gain = 1
		if (env > threshold) {
			const overDb = 20 * Math.log10(env / threshold)
			const compressedDb = overDb / ratio
			gain = Math.pow(10, (compressedDb - overDb) / 20)
		}
		data[i] = clamp(data[i] * gain * makeup, -1, 1)
	}
}

// ── Noise gate ──

function dspNoiseGate(data, s, e, sr, thresholdDb, attackMs, releaseMs) {
	const threshold = Math.pow(10, thresholdDb / 20)
	const attack = Math.exp(-1 / (attackMs / 1000 * sr))
	const release = Math.exp(-1 / (releaseMs / 1000 * sr))
	let env = 0
	let gateGain = 0
	for (let i = s; i < e; i++) {
		const abs = Math.abs(data[i])
		if (abs > env) env = attack * env + (1 - attack) * abs
		else env = release * env + (1 - release) * abs
		const target = env > threshold ? 1 : 0
		// Smooth the gate
		if (target > gateGain) gateGain += (1 - attack) * (target - gateGain)
		else gateGain += (1 - release) * (target - gateGain)
		data[i] *= gateGain
	}
}

// ── Distortion/Overdrive ──
// Waveshaping with adjustable drive

function dspDistortion(data, s, e, drive, mix) {
	const k = drive * 50
	for (let i = s; i < e; i++) {
		const x = data[i]
		// Soft clipping transfer function
		const shaped = (1 + k) * x / (1 + k * Math.abs(x))
		data[i] = clamp(x * (1 - mix) + shaped * mix, -1, 1)
	}
}

// ── Algorithmic Reverb (Schroeder) ──
// 4 parallel comb filters + 2 series allpass filters

function dspReverb(data, s, e, sr, roomSize, damping, mix) {
	const len = e - s
	const dry = new Float32Array(len)
	for (let i = 0; i < len; i++) dry[i] = data[s + i]

	// Comb filter delays (tuned for ~48kHz, scaled)
	const scale = sr / 48000
	const combDelays = [
		Math.floor(1557 * scale * roomSize),
		Math.floor(1617 * scale * roomSize),
		Math.floor(1491 * scale * roomSize),
		Math.floor(1422 * scale * roomSize),
	]
	const allpassDelays = [
		Math.floor(225 * scale),
		Math.floor(556 * scale),
	]

	const out = new Float32Array(len)

	// Process each comb filter
	for (const delay of combDelays) {
		const buf = new Float32Array(delay)
		let filterStore = 0
		let idx = 0
		for (let i = 0; i < len; i++) {
			const delayed = buf[idx]
			filterStore = delayed * (1 - damping) + filterStore * damping
			buf[idx] = clamp(dry[i] + filterStore * 0.8, -1, 1)
			out[i] += delayed
			idx = (idx + 1) % delay
		}
	}

	// Normalize comb output
	for (let i = 0; i < len; i++) out[i] /= combDelays.length

	// Process allpass filters
	for (const delay of allpassDelays) {
		const buf = new Float32Array(delay)
		let idx = 0
		for (let i = 0; i < len; i++) {
			const delayed = buf[idx]
			const input = out[i]
			buf[idx] = input + delayed * 0.5
			out[i] = delayed - input * 0.5
			idx = (idx + 1) % delay
		}
	}

	// Mix
	for (let i = 0; i < len; i++) {
		data[s + i] = clamp(dry[i] * (1 - mix) + out[i] * mix, -1, 1)
	}
}

// ── DC offset removal ──
// Simple high-pass at ~5Hz

function dspRemoveDC(data, s, e) {
	let prevIn = 0, prevOut = 0
	const R = 0.995 // close to 1 = lower cutoff
	for (let i = s; i < e; i++) {
		const x = data[i]
		prevOut = x - prevIn + R * prevOut
		prevIn = x
		data[i] = prevOut
	}
}

// ── Wahwah ──
// Swept bandpass filter controlled by LFO

function dspWahwah(data, s, e, sr, rate, depth, resonance) {
	const minFreq = 200
	const maxFreq = 4000
	let z1 = 0, z2 = 0
	for (let i = s; i < e; i++) {
		const lfo = (1 + Math.sin(2 * Math.PI * rate * (i - s) / sr)) / 2
		const freq = minFreq + lfo * depth * (maxFreq - minFreq)
		const Q = 1 + resonance * 10
		const c = biquadCoeffs("bandpass", sr, freq, Q, 0)
		// Apply single-sample biquad (recalculating coeffs per sample for sweep)
		const x = data[i]
		const y = c.b0 * x + z1
		z1 = c.b1 * x - c.a1 * y + z2
		z2 = c.b2 * x - c.a2 * y
		data[i] = clamp(y, -1, 1)
	}
}

// ── Pitch shift (simple resampling) ──
// Changes pitch without preserving duration

function dspPitchShift(data, s, e, factor) {
	const len = e - s
	const newLen = Math.floor(len / factor)
	const shifted = new Float32Array(newLen)
	for (let i = 0; i < newLen; i++) {
		const srcIdx = i * factor
		const lo = Math.floor(srcIdx)
		const hi = Math.min(lo + 1, len - 1)
		const frac = srcIdx - lo
		shifted[i] = data[s + lo] * (1 - frac) + data[s + hi] * frac
	}
	return shifted // returns new buffer (changes length)
}

// ══════════════════════════════════════════════════════════════════════════════
// LPC (Linear Predictive Coding) Vocoder
// ══════════════════════════════════════════════════════════════════════════════
//
// Decomposes audio into LPC filter coefficients + residual per frame,
// then resynthesizes. Can be used as an effect by modifying the resynthesis
// (e.g., using impulse train for robotic voice, or white noise for whisper).
//
// Parameters:
//   order     — number of LPC coefficients (10-50, speech typically 10-16)
//   frameSize — samples per analysis frame (256-4096)
//   mode      — "resynth" (clean resynth), "robot" (impulse train excitation),
//               "whisper" (noise excitation), "residual" (output just the residual)

function dspLPC(data, s, e, sr, order, frameSize, mode) {
	const len = e - s
	const hopSize = frameSize // no overlap for simplicity
	const output = new Float32Array(len)

	for (let frameStart = 0; frameStart < len; frameStart += hopSize) {
		const frameEnd = Math.min(frameStart + frameSize, len)
		const n = frameEnd - frameStart
		if (n < order + 1) continue

		// Extract frame
		const frame = new Float32Array(n)
		for (let i = 0; i < n; i++) frame[i] = data[s + frameStart + i]

		// Apply Hamming window
		for (let i = 0; i < n; i++) {
			frame[i] *= 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (n - 1))
		}

		// Compute autocorrelation
		const R = new Float64Array(order + 1)
		for (let lag = 0; lag <= order; lag++) {
			let sum = 0
			for (let i = 0; i < n - lag; i++) sum += frame[i] * frame[i + lag]
			R[lag] = sum
		}

		// Levinson-Durbin recursion to find LPC coefficients
		const a = new Float64Array(order + 1) // LPC coefficients
		const aTemp = new Float64Array(order + 1)
		let E = R[0]
		if (E === 0) {
			// Silence frame — output zeros
			continue
		}

		for (let m = 1; m <= order; m++) {
			let lambda = 0
			for (let j = 1; j < m; j++) lambda += a[j] * R[m - j]
			lambda = (R[m] - lambda) / E

			aTemp[m] = lambda
			for (let j = 1; j < m; j++) aTemp[j] = a[j] - lambda * a[m - j]
			for (let j = 1; j <= m; j++) a[j] = aTemp[j]

			E *= (1 - lambda * lambda)
			if (E <= 0) break
		}

		// Compute gain (RMS of residual)
		const gain = Math.sqrt(Math.max(0, E))

		// Compute residual for this frame (inverse filter)
		const residual = new Float32Array(n)
		const origFrame = new Float32Array(n)
		for (let i = 0; i < n; i++) origFrame[i] = data[s + frameStart + i]

		for (let i = 0; i < n; i++) {
			let predicted = 0
			for (let j = 1; j <= order && i - j >= 0; j++) {
				predicted += a[j] * origFrame[i - j]
			}
			residual[i] = origFrame[i] - predicted
		}

		// Estimate pitch period for robot mode (simple autocorrelation peak)
		let pitchPeriod = 0
		if (mode === "robot") {
			const minPeriod = Math.floor(sr / 500) // 500Hz max
			const maxPeriod = Math.floor(sr / 60)  // 60Hz min
			let bestCorr = 0
			for (let lag = minPeriod; lag < maxPeriod && lag < n; lag++) {
				let corr = 0
				for (let i = 0; i < n - lag; i++) corr += origFrame[i] * origFrame[i + lag]
				if (corr > bestCorr) { bestCorr = corr; pitchPeriod = lag }
			}
			if (pitchPeriod === 0) pitchPeriod = Math.floor(sr / 150)
		}

		// Generate excitation signal
		const excitation = new Float32Array(n)
		if (mode === "residual") {
			// Output just residual
			for (let i = 0; i < n; i++) output[frameStart + i] = residual[i]
			continue
		} else if (mode === "robot") {
			// Impulse train at estimated pitch
			for (let i = 0; i < n; i++) {
				excitation[i] = (i % pitchPeriod === 0) ? gain : 0
			}
		} else if (mode === "whisper") {
			// White noise excitation
			for (let i = 0; i < n; i++) {
				excitation[i] = (Math.random() * 2 - 1) * gain
			}
		} else {
			// "resynth" — use original residual
			for (let i = 0; i < n; i++) excitation[i] = residual[i]
		}

		// Resynthesize: filter excitation through LPC synthesis filter
		const synth = new Float32Array(n)
		for (let i = 0; i < n; i++) {
			let val = excitation[i]
			for (let j = 1; j <= order && i - j >= 0; j++) {
				val += a[j] * synth[i - j]
			}
			synth[i] = val
		}

		// Overlap-add output (simple replace since hop = frameSize)
		for (let i = 0; i < n; i++) {
			output[frameStart + i] = synth[i]
		}
	}

	for (let i = 0; i < len; i++) data[s + i] = clamp(output[i], -1, 1)
}


// ══════════════════════════════════════════════════════════════════════════════
// Encoding helpers
// ══════════════════════════════════════════════════════════════════════════════

function encodeWav(channelData, sampleRate) {
	const numSamples = channelData.length
	const bytesPerSample = 2
	const dataSize = numSamples * bytesPerSample
	const buffer = new ArrayBuffer(44 + dataSize)
	const view = new DataView(buffer)
	const w = (o, s) => {
		for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i))
	}
	w(0, "RIFF")
	view.setUint32(4, 36 + dataSize, true)
	w(8, "WAVE")
	w(12, "fmt ")
	view.setUint32(16, 16, true)
	view.setUint16(20, 1, true)
	view.setUint16(22, 1, true)
	view.setUint32(24, sampleRate, true)
	view.setUint32(28, sampleRate * bytesPerSample, true)
	view.setUint16(32, bytesPerSample, true)
	view.setUint16(34, 16, true)
	w(36, "data")
	view.setUint32(40, dataSize, true)
	let offset = 44
	for (let i = 0; i < numSamples; i++) {
		const s = Math.max(-1, Math.min(1, channelData[i]))
		view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
		offset += 2
	}
	return new Uint8Array(buffer)
}

async function encodeFlac(channelData, sampleRate) {
	if (typeof AudioEncoder === "undefined") return null
	try {
		const support = await AudioEncoder.isConfigSupported({
			codec: "flac", sampleRate, numberOfChannels: 1,
		})
		if (!support.supported) return null
	} catch { return null }
	const chunks = []
	const encoder = new AudioEncoder({
		output(chunk) {
			const buf = new ArrayBuffer(chunk.byteLength)
			chunk.copyTo(buf)
			chunks.push(new Uint8Array(buf))
		},
		error(e) { console.error("FLAC encode error:", e) },
	})
	encoder.configure({codec: "flac", sampleRate, numberOfChannels: 1})
	const frameSize = Math.floor(sampleRate * 0.5)
	for (let offset = 0; offset < channelData.length; offset += frameSize) {
		const end = Math.min(offset + frameSize, channelData.length)
		const frameData = new Float32Array(end - offset)
		frameData.set(channelData.subarray(offset, end))
		const audioData = new AudioData({
			format: "f32-planar", sampleRate,
			numberOfFrames: frameData.length, numberOfChannels: 1,
			timestamp: Math.round((offset / sampleRate) * 1_000_000),
			data: frameData,
		})
		encoder.encode(audioData)
		audioData.close()
	}
	await encoder.flush()
	encoder.close()
	const totalLen = chunks.reduce((sum, c) => sum + c.length, 0)
	const bytes = new Uint8Array(totalLen)
	let pos = 0
	for (const c of chunks) { bytes.set(c, pos); pos += c.length }
	return {bytes, mimeType: "audio/flac", extension: "flac"}
}

function formatTime(seconds) {
	if (!isFinite(seconds) || seconds < 0) seconds = 0
	const m = Math.floor(seconds / 60)
	const s = Math.floor(seconds % 60)
	const ms = Math.floor((seconds % 1) * 1000)
	return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`
}


// ══════════════════════════════════════════════════════════════════════════════
// RECORDER WORKLET (shared by empty-state recording and record-at-playhead)
// ══════════════════════════════════════════════════════════════════════════════

const RECORDER_WORKLET_SRC = `
class RecorderProcessor extends AudioWorkletProcessor {
	constructor() {
		super()
		this.recording = true
		this.port.onmessage = (e) => {
			if (e.data.type === "stop") this.recording = false
		}
	}
	process(inputs) {
		if (!this.recording) return false
		const input = inputs[0]
		if (input && input[0]) {
			const samples = new Float32Array(input[0])
			this.port.postMessage({ type: "chunk", samples }, [samples.buffer])
		}
		return true
	}
}
registerProcessor("recorder-processor", RecorderProcessor)
`

// ══════════════════════════════════════════════════════════════════════════════
// MAIN EDITOR
// ══════════════════════════════════════════════════════════════════════════════

export default function SoundEditorTool(handle, element) {
	const style = document.createElement("style")
	style.textContent = STYLES
	element.appendChild(style)

	const root = document.createElement("div")
	root.className = "sound-editor"
	element.appendChild(root)

	const doc = handle.doc()

	// ── State ──
	let pcmData = null
	let sampleRate = 48000
	let clipboard = null
	let selStart = -1
	let selEnd = -1
	let playhead = -1
	let audioContext = null
	let sourceNode = null
	let gainNode = null
	let playing = false
	let looping = false
	let playStartTime = 0
	let playStartSample = 0
	let playEndSample = -1
	let animFrame = null
	let destroyed = false
	let viewStart = 0
	let viewEnd = 0
	let undoStack = []
	let redoStack = []
	const MAX_UNDO = 50
	let volume = 1.0

	// ── Presence state ──
	let myName = "Anonymous"
	let myColor = "#66aaff"
	const PEER_COLORS = ["#ff6b6b","#ffa94d","#69db7c","#66d9ef","#da77f2","#ffd43b","#ff8787","#74c0fc"]
	const peerPresence = new Map() // name -> { cursor, selStart, selEnd, color, timestamp }
	const PRESENCE_TIMEOUT = 15000
	let presenceInterval = null
	let lastAudioUrl = doc.audio // track the audio URL for change detection

	// Resolve user identity via the account provider's `patchwork:contact`
	// selector (see patchwork-base/providers) instead of reaching into
	// `window.accountDocHandle` directly.
	const offContact = subscribe(element, {type: "patchwork:contact"}, async (contactUrl) => {
		if (!contactUrl) return
		try {
			const ch = await repo.find(contactUrl)
			const cd = ch.doc()
			if (cd?.name) myName = cd.name
			if (cd?.color) myColor = cd.color
		} catch {}
	})

	// ── Build UI ──

	function el(tag, cls) {
		const e = document.createElement(tag)
		if (cls) e.className = cls
		return e
	}
	function mkTransBtn(icon, title) {
		const btn = document.createElement("button")
		btn.textContent = icon
		btn.title = title
		return btn
	}
	function sep() {
		const d = document.createElement("div")
		d.className = "sep"
		return d
	}

	// Menubar
	const menubar = el("div", "se-menubar")
	root.appendChild(menubar)

	const menus = {
		Edit: [
			{label: "Undo", key: "Ctrl+Z", action: doUndo, needsPcm: true},
			{label: "Redo", key: "Ctrl+Y", action: doRedo, needsPcm: true},
			{sep: true},
			{label: "Cut", key: "Ctrl+X", action: doCut, needsSel: true},
			{label: "Copy", key: "Ctrl+C", action: doCopy, needsSel: true},
			{label: "Paste", key: "Ctrl+V", action: doPaste, needsClip: true},
			{label: "Mix Paste", key: "Ctrl+M", action: doMixPaste, needsClip: true},
			{sep: true},
			{label: "Delete", key: "Del", action: doDelete, needsSel: true},
			{label: "Trim", key: "Ctrl+T", action: doTrim, needsSel: true},
			{sep: true},
			{label: "Select All", key: "Ctrl+A", action: doSelectAll, needsPcm: true},
		],
		Effects: [
			{header: "Amplitude"},
			{label: "Normalize", action: doNormalize, needsPcm: true},
			{label: "Amplify...", action: showAmplifyDialog, needsPcm: true},
			{label: "Fade In", action: doFadeIn, needsSel: true},
			{label: "Fade Out", action: doFadeOut, needsSel: true},
			{label: "Compressor...", action: showCompressorDialog, needsPcm: true},
			{label: "Noise Gate...", action: showNoiseGateDialog, needsPcm: true},
			{label: "Tremolo...", action: showTremoloDialog, needsPcm: true},
			{sep: true},
			{header: "Modulation"},
			{label: "Flanger...", action: showFlangerDialog, needsPcm: true},
			{label: "Phaser...", action: showPhaserDialog, needsPcm: true},
			{label: "Chorus...", action: showChorusDialog, needsPcm: true},
			{label: "Vibrato...", action: showVibratoDialog, needsPcm: true},
			{label: "Ring Modulator...", action: showRingModDialog, needsPcm: true},
			{label: "Wahwah...", action: showWahwahDialog, needsPcm: true},
			{sep: true},
			{header: "Filter"},
			{label: "Low-Pass Filter...", action: () => showFilterDialog("lowpass"), needsPcm: true},
			{label: "High-Pass Filter...", action: () => showFilterDialog("highpass"), needsPcm: true},
			{label: "Band-Pass Filter...", action: () => showFilterDialog("bandpass"), needsPcm: true},
			{label: "Notch Filter...", action: () => showFilterDialog("notch"), needsPcm: true},
			{label: "Parametric EQ...", action: showParaEQDialog, needsPcm: true},
			{label: "Low-Shelf Filter...", action: () => showShelfDialog("lowshelf"), needsPcm: true},
			{label: "High-Shelf Filter...", action: () => showShelfDialog("highshelf"), needsPcm: true},
			{label: "Comb Filter...", action: showCombDialog, needsPcm: true},
			{sep: true},
			{header: "Time / Pitch"},
			{label: "Reverse", action: doReverse, needsSel: true},
			{label: "Speed...", action: showSpeedDialog, needsPcm: true},
			{label: "Pitch Shift...", action: showPitchShiftDialog, needsPcm: true},
			{label: "Echo...", action: showEchoDialog, needsPcm: true},
			{label: "Reverb...", action: showReverbDialog, needsPcm: true},
			{sep: true},
			{header: "Distortion"},
			{label: "Distortion/Overdrive...", action: showDistortionDialog, needsPcm: true},
			{label: "Bitcrusher...", action: showBitcrusherDialog, needsPcm: true},
			{sep: true},
			{header: "Analysis / Resynthesis"},
			{label: "LPC Vocoder...", action: showLPCDialog, needsPcm: true},
			{sep: true},
			{header: "Utility"},
			{label: "Invert (Flip Phase)", action: doInvert, needsPcm: true},
			{label: "Silence Selection", action: doSilence, needsSel: true},
			{label: "Remove DC Offset", action: doRemoveDC, needsPcm: true},
		],
		Generate: [
			{label: "Insert Silence...", action: showInsertSilenceDialog, needsPcm: true},
			{label: "Tone Generator...", action: showToneDialog, needsPcm: true},
			{label: "White Noise...", action: showNoiseDialog, needsPcm: true},
		],
		View: [
			{label: "Zoom In", key: "Up", action: () => zoomBy(0.5)},
			{label: "Zoom Out", key: "Down", action: () => zoomBy(2)},
			{label: "Zoom Selection", key: "Ctrl+Shift+S", action: zoomToSelection},
			{label: "Zoom All", key: "Ctrl+Shift+A", action: zoomAll},
		],
	}

	let openMenu = null

	for (const [name, items] of Object.entries(menus)) {
		const menuItem = el("div", "se-menu-item")
		menuItem.textContent = name
		const dropdown = el("div", "se-menu-dropdown")

		for (const item of items) {
			if (item.sep) { dropdown.appendChild(el("div", "se-menu-sep")); continue }
			if (item.header) {
				const h = el("div", "se-menu-header")
				h.textContent = item.header
				dropdown.appendChild(h)
				continue
			}
			const action = el("div", "se-menu-action")
			action.innerHTML = `<span>${item.label}</span>${item.key ? `<span class="shortcut">${item.key}</span>` : ""}`
			action.addEventListener("click", e => {
				e.stopPropagation(); closeMenus(); item.action()
			})
			action._menuItem = item
			dropdown.appendChild(action)
		}

		menuItem.appendChild(dropdown)
		menuItem.addEventListener("click", e => {
			e.stopPropagation()
			if (openMenu === menuItem) { closeMenus() }
			else { closeMenus(); menuItem.classList.add("open"); openMenu = menuItem; updateMenuStates(dropdown) }
		})
		menuItem.addEventListener("mouseenter", () => {
			if (openMenu && openMenu !== menuItem) {
				closeMenus(); menuItem.classList.add("open"); openMenu = menuItem; updateMenuStates(dropdown)
			}
		})
		menubar.appendChild(menuItem)
	}

	function closeMenus() { if (openMenu) { openMenu.classList.remove("open"); openMenu = null } }

	function updateMenuStates(dropdown) {
		for (const child of dropdown.children) {
			if (!child._menuItem) continue
			const item = child._menuItem
			let disabled = false
			if (item.needsPcm && !pcmData) disabled = true
			if (item.needsSel && !hasSelection()) disabled = true
			if (item.needsClip && !clipboard) disabled = true
			child.dataset.disabled = disabled
		}
	}

	document.addEventListener("click", closeMenus)

	// Transport bar
	const transport = el("div", "se-transport")
	root.appendChild(transport)

	const btnRewind = mkTransBtn("\u23EE", "Rewind to start")
	const btnPlay = mkTransBtn("\u25B6", "Play (Space)")
	const btnPause = mkTransBtn("\u23F8", "Pause")
	const btnStop = mkTransBtn("\u23F9", "Stop (Esc)")
	const btnLoop = mkTransBtn("\uD83D\uDD01", "Loop (L)")
	const btnRec = mkTransBtn("\u23FA", "Record at playhead (R)")
	btnRec.style.color = "#c0392b"
	const posDsp = el("div", "se-position")
	posDsp.textContent = "0:00.000"
	const volLabel = el("span", "")
	volLabel.textContent = "Vol:"
	volLabel.style.cssText = "color:#777;font-size:11px;margin-left:auto;"
	const volSlider = document.createElement("input")
	volSlider.type = "range"; volSlider.min = "0"; volSlider.max = "1"
	volSlider.step = "0.01"; volSlider.value = "1"
	volSlider.style.cssText = "width:80px;accent-color:#66f;"
	volSlider.addEventListener("input", () => {
		volume = parseFloat(volSlider.value)
		if (gainNode) gainNode.gain.value = volume
	})

	transport.append(btnRewind, btnPlay, btnPause, btnStop, sep(), btnLoop, btnRec, sep(), posDsp, volLabel, volSlider)

	// Canvas area
	const canvasArea = el("div", "se-canvas-area")
	root.appendChild(canvasArea)

	const rulerWrap = el("div", "se-ruler")
	const rulerCanvas = document.createElement("canvas")
	rulerWrap.appendChild(rulerCanvas)
	canvasArea.appendChild(rulerWrap)

	const waveWrap = el("div", "se-waveform-wrap")
	const waveCanvas = document.createElement("canvas")
	waveWrap.appendChild(waveCanvas)
	canvasArea.appendChild(waveWrap)
	const waveCtx = waveCanvas.getContext("2d")
	const rulerCtx = rulerCanvas.getContext("2d")

	const overview = el("div", "se-overview")
	const overviewCanvas = document.createElement("canvas")
	const viewportIndicator = el("div", "se-viewport-indicator")
	overview.appendChild(overviewCanvas)
	overview.appendChild(viewportIndicator)
	canvasArea.appendChild(overview)
	const overviewCtx = overviewCanvas.getContext("2d")

	const scrollbar = el("div", "se-scrollbar")
	const scrollThumb = el("div", "se-scrollbar-thumb")
	scrollbar.appendChild(scrollThumb)
	canvasArea.appendChild(scrollbar)

	const statusBar = el("div", "se-status")
	root.appendChild(statusBar)
	const statLen = el("span", "")
	const statSR = el("span", "")
	const statSel = el("span", "")
	const statZoom = el("span", "")
	const statClip = el("span", "")
	statusBar.append(statLen, statSR, statSel, statZoom, statClip)

	// ── Load audio ──
	async function loadAudioFromDoc(audioUrl) {
		try {
			const fileHandle = await repo.find(audioUrl)
			const fileDoc = fileHandle.doc()
			const blob = new Blob([fileDoc.content], { type: fileDoc.mimeType || "audio/wav" })
			const arrayBuf = await blob.arrayBuffer()
			const tempCtx = new AudioContext()
			const audioBuffer = await tempCtx.decodeAudioData(arrayBuf)
			sampleRate = audioBuffer.sampleRate
			pcmData = new Float32Array(audioBuffer.getChannelData(0))
			await tempCtx.close()
			viewStart = 0
			viewEnd = pcmData.length
			drawAll()
		} catch (e) {
			console.error("Sound editor: failed to load audio", e)
			root.innerHTML = '<div class="se-empty">Failed to load audio</div>'
		}
	}
	if (doc.audio) loadAudioFromDoc(doc.audio)

	// ── Collaborative: listen for document changes ──
	let reloadingFromRemote = false

	function onDocChange() {
		if (destroyed) return
		const d = handle.doc()
		if (!d) return
		// If audio URL changed (someone else edited and saved), reload
		if (d.audio && d.audio !== lastAudioUrl) {
			lastAudioUrl = d.audio
			// Don't reload if we just saved (avoid echo)
			if (!reloadingFromRemote) {
				reloadingFromRemote = true
				loadAudioFromDoc(d.audio).then(() => { reloadingFromRemote = false })
			}
		}
	}
	handle.on("change", onDocChange)

	// ── Presence: broadcast & receive ──
	function broadcastPresence() {
		try {
			handle.broadcast({
				type: "sound-presence",
				name: myName,
				color: myColor,
				cursor: playhead,
				selStart,
				selEnd,
				timestamp: Date.now(),
			})
		} catch {}
	}

	function onEphemeralMessage(payload) {
		const msg = payload.message
		if (msg?.type !== "sound-presence") return
		if (msg.name === myName) return
		// Assign a stable color from the palette if peer has none
		let color = msg.color
		if (!color) {
			let hash = 0
			for (let i = 0; i < msg.name.length; i++) hash = (hash * 31 + msg.name.charCodeAt(i)) | 0
			color = PEER_COLORS[Math.abs(hash) % PEER_COLORS.length]
		}
		peerPresence.set(msg.name, {
			cursor: msg.cursor,
			selStart: msg.selStart,
			selEnd: msg.selEnd,
			color,
			timestamp: msg.timestamp,
		})
		drawWaveform()
	}
	handle.on("ephemeral-message", onEphemeralMessage)

	// Broadcast presence periodically + on selection/playhead changes
	presenceInterval = setInterval(() => {
		broadcastPresence()
		// Expire stale peers
		const now = Date.now()
		for (const [name, info] of peerPresence) {
			if (now - info.timestamp > PRESENCE_TIMEOUT) peerPresence.delete(name)
		}
		drawWaveform()
	}, 3000)

	// ── Drawing ──

	function drawAll() {
		drawWaveform()
		drawRuler()
		drawOverview()
		updateScrollbar()
		updateStatus()
		updatePosition()
	}

	function drawWaveform() {
		if (destroyed) return
		const w = (waveCanvas.width = waveCanvas.clientWidth * DPI)
		const h = (waveCanvas.height = waveCanvas.clientHeight * DPI)
		if (w === 0 || h === 0) return
		const ctx = waveCtx

		ctx.fillStyle = "#0a0a14"
		ctx.fillRect(0, 0, w, h)

		if (!pcmData) return
		const vLen = viewEnd - viewStart
		if (vLen <= 0) return
		const mid = h / 2

		// Selection highlight
		if (hasSelection()) {
			const s = Math.min(selStart, selEnd)
			const e = Math.max(selStart, selEnd)
			const x1 = sampleToX(s, w)
			const x2 = sampleToX(e, w)
			if (x2 > 0 && x1 < w) {
				ctx.fillStyle = "rgba(80, 80, 200, 0.2)"
				ctx.fillRect(Math.max(0, x1), 0, Math.min(w, x2) - Math.max(0, x1), h)
			}
		}

		// Waveform
		const samplesPerPixel = vLen / (w / DPI)
		ctx.beginPath()
		ctx.strokeStyle = "#4466cc"
		ctx.lineWidth = DPI

		if (samplesPerPixel > 4) {
			for (let px = 0; px < w / DPI; px++) {
				const sStart = viewStart + Math.floor(px * vLen / (w / DPI))
				const sEnd = viewStart + Math.floor((px + 1) * vLen / (w / DPI))
				let min = 1, max = -1
				for (let i = sStart; i < sEnd && i < pcmData.length; i++) {
					if (pcmData[i] < min) min = pcmData[i]
					if (pcmData[i] > max) max = pcmData[i]
				}
				const x = px * DPI
				ctx.moveTo(x, mid - max * mid)
				ctx.lineTo(x, mid - min * mid)
			}
		} else {
			const step = Math.max(1, Math.floor(samplesPerPixel / 2))
			let first = true
			for (let i = viewStart; i < viewEnd && i < pcmData.length; i += step) {
				const x = sampleToX(i, w)
				const y = mid - pcmData[i] * mid
				if (first) { ctx.moveTo(x, y); first = false } else ctx.lineTo(x, y)
			}
		}
		ctx.stroke()

		// Selection waveform overlay
		if (hasSelection()) {
			const s = Math.max(Math.min(selStart, selEnd), viewStart)
			const e = Math.min(Math.max(selStart, selEnd), viewEnd)
			if (e > s) {
				ctx.beginPath()
				ctx.strokeStyle = "#aabbff"
				ctx.lineWidth = DPI
				if (samplesPerPixel > 4) {
					for (let px = 0; px < w / DPI; px++) {
						const sS = viewStart + Math.floor(px * vLen / (w / DPI))
						const sE = viewStart + Math.floor((px + 1) * vLen / (w / DPI))
						if (sE < s || sS > e) continue
						let min = 1, max = -1
						for (let i = Math.max(sS, s); i < Math.min(sE, e) && i < pcmData.length; i++) {
							if (pcmData[i] < min) min = pcmData[i]
							if (pcmData[i] > max) max = pcmData[i]
						}
						const x = px * DPI
						ctx.moveTo(x, mid - max * mid); ctx.lineTo(x, mid - min * mid)
					}
				} else {
					const step = Math.max(1, Math.floor(samplesPerPixel / 2))
					let first = true
					for (let i = s; i < e && i < pcmData.length; i += step) {
						const x = sampleToX(i, w); const y = mid - pcmData[i] * mid
						if (first) { ctx.moveTo(x, y); first = false } else ctx.lineTo(x, y)
					}
				}
				ctx.stroke()
			}
			// Selection edges
			ctx.strokeStyle = "rgba(150, 150, 255, 0.6)"; ctx.lineWidth = DPI
			for (const edge of [Math.min(selStart, selEnd), Math.max(selStart, selEnd)]) {
				const x = sampleToX(edge, w)
				if (x >= 0 && x <= w) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
			}
		}

		// Playhead
		if (playhead >= 0) {
			const px = sampleToX(playhead, w)
			if (px >= 0 && px <= w) {
				ctx.strokeStyle = "#ff4444"; ctx.lineWidth = 2 * DPI
				ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke()
			}
		}

		// ── Peer presence: selections + cursors ──
		// Remove stale peer labels
		for (const old of waveWrap.querySelectorAll(".se-peer-label")) old.remove()

		for (const [name, peer] of peerPresence) {
			const c = peer.color || "#888"
			// Peer selection highlight (faint)
			if (peer.selStart >= 0 && peer.selEnd >= 0 && peer.selStart !== peer.selEnd) {
				const ps = Math.min(peer.selStart, peer.selEnd)
				const pe = Math.max(peer.selStart, peer.selEnd)
				const x1 = sampleToX(ps, w)
				const x2 = sampleToX(pe, w)
				if (x2 > 0 && x1 < w) {
					ctx.fillStyle = c + "18" // ~10% opacity via hex alpha
					ctx.fillRect(Math.max(0, x1), 0, Math.min(w, x2) - Math.max(0, x1), h)
					// Selection edges
					ctx.strokeStyle = c + "55"
					ctx.lineWidth = DPI
					for (const edge of [x1, x2]) {
						if (edge >= 0 && edge <= w) {
							ctx.beginPath(); ctx.moveTo(edge, 0); ctx.lineTo(edge, h); ctx.stroke()
						}
					}
				}
			}
			// Peer cursor
			const cursorSample = peer.cursor >= 0 ? peer.cursor : -1
			if (cursorSample >= 0) {
				const px = sampleToX(cursorSample, w)
				if (px >= 0 && px <= w) {
					ctx.strokeStyle = c
					ctx.lineWidth = 1.5 * DPI
					ctx.setLineDash([4 * DPI, 3 * DPI])
					ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke()
					ctx.setLineDash([])
					// Name label (DOM element for crisp text)
					const label = document.createElement("div")
					label.className = "se-peer-label"
					label.textContent = name
					label.style.left = (px / DPI) + "px"
					label.style.backgroundColor = c
					waveWrap.appendChild(label)
				}
			}
		}

		// Center line + dB grid
		ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = DPI
		ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke()
		ctx.strokeStyle = "rgba(255,255,255,0.03)"
		for (const db of [-6, -12, -18]) {
			const amp = Math.pow(10, db / 20)
			for (const sign of [1, -1]) {
				const y = mid - sign * amp * mid
				ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
			}
		}
	}

	function drawRuler() {
		if (destroyed || !pcmData) return
		const w = (rulerCanvas.width = rulerCanvas.clientWidth * DPI)
		const h = (rulerCanvas.height = rulerCanvas.clientHeight * DPI)
		if (w === 0 || h === 0) return
		const ctx = rulerCtx
		ctx.fillStyle = "#16162e"; ctx.fillRect(0, 0, w, h)
		const vLen = viewEnd - viewStart; if (vLen <= 0) return
		const durationSec = vLen / sampleRate
		const intervals = [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600]
		const minPxPerTick = 60 * DPI
		const pxPerSec = w / durationSec
		let tickInterval = intervals[intervals.length - 1]
		for (const iv of intervals) { if (iv * pxPerSec >= minPxPerTick) { tickInterval = iv; break } }
		const startTime = viewStart / sampleRate
		const endTime = viewEnd / sampleRate
		const firstTick = Math.ceil(startTime / tickInterval) * tickInterval
		ctx.fillStyle = "#888"; ctx.font = `${10 * DPI}px "Consolas","SF Mono",monospace`
		ctx.strokeStyle = "#444"; ctx.lineWidth = DPI
		for (let t = firstTick; t <= endTime; t += tickInterval) {
			const sample = Math.floor(t * sampleRate)
			const x = sampleToX(sample, w)
			if (x < 0 || x > w) continue
			ctx.beginPath(); ctx.moveTo(x, h * 0.5); ctx.lineTo(x, h); ctx.stroke()
			ctx.fillText(formatTime(t), x + 3 * DPI, h * 0.45)
			ctx.strokeStyle = "#333"
			for (let m = 1; m < 4; m++) {
				const mx = sampleToX(Math.floor((t + m * tickInterval / 4) * sampleRate), w)
				if (mx > 0 && mx < w) { ctx.beginPath(); ctx.moveTo(mx, h * 0.7); ctx.lineTo(mx, h); ctx.stroke() }
			}
			ctx.strokeStyle = "#444"
		}
	}

	function drawOverview() {
		if (destroyed || !pcmData) return
		const w = (overviewCanvas.width = overviewCanvas.clientWidth * DPI)
		const h = (overviewCanvas.height = overviewCanvas.clientHeight * DPI)
		if (w === 0 || h === 0) return
		const ctx = overviewCtx
		ctx.fillStyle = "#0e0e1e"; ctx.fillRect(0, 0, w, h)
		const len = pcmData.length; const mid = h / 2
		ctx.beginPath(); ctx.strokeStyle = "#334"; ctx.lineWidth = DPI
		for (let px = 0; px < w / DPI; px++) {
			const sStart = Math.floor(px * len / (w / DPI))
			const sEnd = Math.floor((px + 1) * len / (w / DPI))
			let min = 1, max = -1
			for (let i = sStart; i < sEnd && i < len; i++) {
				if (pcmData[i] < min) min = pcmData[i]; if (pcmData[i] > max) max = pcmData[i]
			}
			const x = px * DPI
			ctx.moveTo(x, mid - max * mid); ctx.lineTo(x, mid - min * mid)
		}
		ctx.stroke()
		const vx1 = (viewStart / len) * overview.clientWidth
		const vx2 = (viewEnd / len) * overview.clientWidth
		viewportIndicator.style.left = vx1 + "px"
		viewportIndicator.style.width = (vx2 - vx1) + "px"
	}

	function updateScrollbar() {
		if (!pcmData) return
		const len = pcmData.length
		const thumbLeft = (viewStart / len) * scrollbar.clientWidth
		const thumbRight = (viewEnd / len) * scrollbar.clientWidth
		scrollThumb.style.left = thumbLeft + "px"
		scrollThumb.style.width = Math.max(20, thumbRight - thumbLeft) + "px"
	}

	function updateStatus() {
		if (!pcmData) return
		statLen.textContent = `Length: ${formatTime(pcmData.length / sampleRate)}`
		statSR.textContent = `${sampleRate} Hz`
		if (hasSelection()) {
			const s = Math.min(selStart, selEnd), e = Math.max(selStart, selEnd)
			statSel.textContent = `Sel: ${formatTime(s / sampleRate)} \u2192 ${formatTime(e / sampleRate)} (${formatTime((e - s) / sampleRate)})`
		} else { statSel.textContent = "No selection" }
		const zoomPct = ((viewEnd - viewStart) / pcmData.length * 100).toFixed(1)
		statZoom.textContent = `Zoom: ${zoomPct}%`
		statClip.textContent = clipboard ? `Clip: ${formatTime(clipboard.length / sampleRate)}` : ""
	}

	function updatePosition() {
		if (!pcmData) return
		const pos = playhead >= 0 ? playhead : (hasSelection() ? Math.min(selStart, selEnd) : 0)
		posDsp.textContent = formatTime(pos / sampleRate)
	}

	function sampleToX(sample, canvasWidth) {
		const vLen = viewEnd - viewStart; if (vLen <= 0) return 0
		return ((sample - viewStart) / vLen) * canvasWidth
	}
	function xToSample(clientX, rect) {
		const frac = (clientX - rect.left) / rect.width
		return Math.floor(viewStart + frac * (viewEnd - viewStart))
	}

	// ── Zoom/scroll ──

	function zoomBy(factor, center) {
		if (!pcmData) return
		const vLen = viewEnd - viewStart
		const newLen = Math.max(100, Math.min(pcmData.length, Math.floor(vLen * factor)))
		if (center === undefined) center = viewStart + vLen / 2
		let ns = Math.floor(center - newLen / 2), ne = ns + newLen
		if (ns < 0) { ne -= ns; ns = 0 }
		if (ne > pcmData.length) { ns -= (ne - pcmData.length); ne = pcmData.length }
		ns = Math.max(0, ns); viewStart = ns; viewEnd = ne; drawAll()
	}
	function zoomToSelection() {
		if (!hasSelection() || !pcmData) return
		const s = Math.min(selStart, selEnd), e = Math.max(selStart, selEnd)
		const pad = Math.floor((e - s) * 0.05)
		viewStart = Math.max(0, s - pad); viewEnd = Math.min(pcmData.length, e + pad); drawAll()
	}
	function zoomAll() { if (!pcmData) return; viewStart = 0; viewEnd = pcmData.length; drawAll() }
	function scrollView(deltaSamples) {
		if (!pcmData) return
		const vLen = viewEnd - viewStart
		let ns = viewStart + deltaSamples
		if (ns < 0) ns = 0; if (ns + vLen > pcmData.length) ns = pcmData.length - vLen
		if (ns < 0) ns = 0; viewStart = ns; viewEnd = ns + vLen; drawAll()
	}
	function ensurePlayheadVisible() {
		if (!pcmData || playhead < 0) return
		const vLen = viewEnd - viewStart
		if (playhead < viewStart || playhead > viewEnd) {
			viewStart = Math.max(0, playhead - Math.floor(vLen * 0.1))
			viewEnd = viewStart + vLen
			if (viewEnd > pcmData.length) { viewEnd = pcmData.length; viewStart = Math.max(0, viewEnd - vLen) }
		}
	}

	// ── Mouse: waveform selection ──
	let dragging = false

	waveWrap.addEventListener("mousedown", e => {
		if (!pcmData) return
		dragging = true
		const rect = waveCanvas.getBoundingClientRect()
		const sample = clamp(xToSample(e.clientX, rect), 0, pcmData.length)
		if (e.shiftKey && selStart >= 0) { selEnd = sample }
		else { selStart = sample; selEnd = sample }
		drawAll()
	})

	window.addEventListener("mousemove", e => {
		if (!dragging || !pcmData) return
		const rect = waveCanvas.getBoundingClientRect()
		const sample = clamp(xToSample(e.clientX, rect), 0, pcmData.length)
		selEnd = sample
		const edgeZone = rect.width * 0.05
		const vLen = viewEnd - viewStart
		const scrollAmt = Math.floor(vLen * 0.02)
		if (e.clientX - rect.left < edgeZone && viewStart > 0) scrollView(-scrollAmt)
		else if (rect.right - e.clientX < edgeZone && viewEnd < pcmData.length) scrollView(scrollAmt)
		drawAll()
	})

	window.addEventListener("mouseup", () => {
		if (!dragging) return
		dragging = false
		if (selStart === selEnd) {
			// Click without drag = PLACE cursor here
			playhead = selStart; selStart = -1; selEnd = -1; drawAll()
		}
		broadcastPresence()
	})

	// Scroll wheel zoom
	waveWrap.addEventListener("wheel", e => {
		if (!pcmData) return
		e.preventDefault()
		const rect = waveCanvas.getBoundingClientRect()
		const centerSample = xToSample(e.clientX, rect)
		if (e.ctrlKey || e.metaKey) { zoomBy(e.deltaY > 0 ? 1.3 : 1 / 1.3, centerSample) }
		else if (e.shiftKey) { scrollView(Math.floor(e.deltaY / 100 * (viewEnd - viewStart) * 0.1)) }
		else { zoomBy(e.deltaY > 0 ? 1.2 : 1 / 1.2, centerSample) }
	}, {passive: false})

	// Overview click
	overview.addEventListener("mousedown", e => {
		if (!pcmData) return
		const rect = overview.getBoundingClientRect()
		const frac = (e.clientX - rect.left) / rect.width
		const sample = Math.floor(frac * pcmData.length)
		const vLen = viewEnd - viewStart
		let ns = sample - Math.floor(vLen / 2)
		if (ns < 0) ns = 0; if (ns + vLen > pcmData.length) ns = pcmData.length - vLen
		if (ns < 0) ns = 0; viewStart = ns; viewEnd = ns + vLen; drawAll()
	})

	// Scrollbar
	let scrollDragging = false, scrollDragOffset = 0

	scrollThumb.addEventListener("mousedown", e => {
		if (!pcmData) return
		scrollDragging = true; scrollDragOffset = e.clientX - scrollThumb.getBoundingClientRect().left
		e.preventDefault()
	})
	window.addEventListener("mousemove", e => {
		if (!scrollDragging || !pcmData) return
		const sbRect = scrollbar.getBoundingClientRect()
		const frac = (e.clientX - sbRect.left - scrollDragOffset) / sbRect.width
		const vLen = viewEnd - viewStart
		let ns = Math.floor(frac * pcmData.length)
		if (ns < 0) ns = 0; if (ns + vLen > pcmData.length) ns = pcmData.length - vLen
		if (ns < 0) ns = 0; viewStart = ns; viewEnd = ns + vLen; drawAll()
	})
	window.addEventListener("mouseup", () => { scrollDragging = false })
	scrollbar.addEventListener("click", e => {
		if (e.target === scrollThumb || !pcmData) return
		const rect = scrollbar.getBoundingClientRect()
		const frac = (e.clientX - rect.left) / rect.width
		const vLen = viewEnd - viewStart
		let ns = Math.floor(frac * pcmData.length) - Math.floor(vLen / 2)
		if (ns < 0) ns = 0; if (ns + vLen > pcmData.length) ns = pcmData.length - vLen
		if (ns < 0) ns = 0; viewStart = ns; viewEnd = ns + vLen; drawAll()
	})

	// ── Playback ──

	function startPlayback() {
		if (!pcmData || playing) return
		teardownAudio()
		audioContext = new AudioContext({sampleRate})
		gainNode = audioContext.createGain()
		gainNode.gain.value = volume
		gainNode.connect(audioContext.destination)

		let startSample, endSample
		if (hasSelection()) {
			startSample = Math.min(selStart, selEnd); endSample = Math.max(selStart, selEnd)
		} else {
			startSample = playhead >= 0 ? playhead : 0; endSample = pcmData.length
		}
		const len = endSample - startSample; if (len <= 0) return

		const buffer = audioContext.createBuffer(1, len, sampleRate)
		buffer.getChannelData(0).set(pcmData.subarray(startSample, endSample))
		sourceNode = audioContext.createBufferSource()
		sourceNode.buffer = buffer; sourceNode.loop = looping
		sourceNode.connect(gainNode)
		sourceNode.onended = () => {
			if (!destroyed && !looping) {
				playing = false; playhead = endSample >= pcmData.length ? 0 : endSample
				btnPlay.classList.remove("active"); drawAll()
			}
		}
		sourceNode.start(0)
		playing = true; playStartTime = audioContext.currentTime
		playStartSample = startSample; playEndSample = endSample
		btnPlay.classList.add("active"); animatePlayhead()
	}

	function pausePlayback() {
		if (!playing) return
		const elapsed = audioContext.currentTime - playStartTime
		playhead = playStartSample + Math.floor(elapsed * sampleRate)
		if (playhead >= playEndSample) playhead = playEndSample
		teardownAudio(); drawAll()
	}

	function teardownAudio() {
		playing = false; btnPlay.classList.remove("active")
		if (sourceNode) { try { sourceNode.stop() } catch {} sourceNode.disconnect(); sourceNode = null }
		if (gainNode) { gainNode.disconnect(); gainNode = null }
		if (audioContext) { audioContext.close(); audioContext = null }
		if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null }
	}

	function stopPlayback() {
		if (playing) { teardownAudio(); drawAll() }
		else { selStart = -1; selEnd = -1; playhead = 0; drawAll() }
	}

	function animatePlayhead() {
		if (!playing || destroyed) return
		const elapsed = audioContext.currentTime - playStartTime
		const loopLen = playEndSample - playStartSample
		if (looping) { playhead = playStartSample + Math.floor((elapsed * sampleRate) % loopLen) }
		else {
			playhead = playStartSample + Math.floor(elapsed * sampleRate)
			if (playhead >= playEndSample) {
				playhead = playEndSample >= pcmData.length ? 0 : playEndSample
				playing = false; btnPlay.classList.remove("active"); drawAll(); return
			}
		}
		ensurePlayheadVisible(); drawAll()
		animFrame = requestAnimationFrame(animatePlayhead)
	}

	// ── Undo/Redo ──

	function pushUndo() {
		if (!pcmData) return
		undoStack.push(new Float32Array(pcmData))
		if (undoStack.length > MAX_UNDO) undoStack.shift()
		redoStack = []
	}
	function doUndo() {
		if (undoStack.length === 0 || !pcmData) return
		redoStack.push(new Float32Array(pcmData)); pcmData = undoStack.pop()
		selStart = -1; selEnd = -1; playhead = 0; clampView(); drawAll(); saveAudio()
	}
	function doRedo() {
		if (redoStack.length === 0 || !pcmData) return
		undoStack.push(new Float32Array(pcmData)); pcmData = redoStack.pop()
		selStart = -1; selEnd = -1; playhead = 0; clampView(); drawAll(); saveAudio()
	}
	function clampView() {
		if (!pcmData) return
		if (viewEnd > pcmData.length) viewEnd = pcmData.length
		if (viewStart >= viewEnd) viewStart = Math.max(0, viewEnd - 1000)
		if (viewStart < 0) viewStart = 0
	}

	// ── Helpers ──

	function hasSelection() { return selStart >= 0 && selEnd >= 0 && selStart !== selEnd }
	function getSelection() { if (!hasSelection()) return null; return [Math.min(selStart, selEnd), Math.max(selStart, selEnd)] }
	function getTargetRange() { if (hasSelection()) return getSelection(); return [0, pcmData ? pcmData.length : 0] }

	// ── Edit operations ──

	function doCut() {
		const sel = getSelection(); if (!sel || !pcmData) return; pushUndo()
		const [s, e] = sel; clipboard = pcmData.slice(s, e)
		const newData = new Float32Array(pcmData.length - (e - s))
		newData.set(pcmData.subarray(0, s), 0); newData.set(pcmData.subarray(e), s)
		pcmData = newData; selEnd = s; selStart = s; playhead = s; clampView(); drawAll(); saveAudio()
	}
	function doCopy() {
		const sel = getSelection(); if (!sel || !pcmData) return
		clipboard = pcmData.slice(sel[0], sel[1]); drawAll()
	}
	function doPaste() {
		if (!clipboard || !pcmData) return; pushUndo()
		const insertAt = hasSelection() ? Math.min(selStart, selEnd) : playhead >= 0 ? playhead : pcmData.length
		const deleteLen = hasSelection() ? Math.max(selStart, selEnd) - Math.min(selStart, selEnd) : 0
		const before = pcmData.subarray(0, insertAt); const after = pcmData.subarray(insertAt + deleteLen)
		const newData = new Float32Array(before.length + clipboard.length + after.length)
		newData.set(before, 0); newData.set(clipboard, before.length); newData.set(after, before.length + clipboard.length)
		pcmData = newData; selStart = insertAt; selEnd = insertAt + clipboard.length; playhead = selEnd
		clampView(); drawAll(); saveAudio()
	}
	function doMixPaste() {
		if (!clipboard || !pcmData) return; pushUndo()
		const insertAt = hasSelection() ? Math.min(selStart, selEnd) : playhead >= 0 ? playhead : 0
		for (let i = 0; i < clipboard.length; i++) {
			const idx = insertAt + i; if (idx >= pcmData.length) break
			pcmData[idx] = clamp(pcmData[idx] + clipboard[i], -1, 1)
		}
		drawAll(); saveAudio()
	}
	function doDelete() {
		const sel = getSelection(); if (!sel || !pcmData) return; pushUndo()
		const [s, e] = sel; const newData = new Float32Array(pcmData.length - (e - s))
		newData.set(pcmData.subarray(0, s), 0); newData.set(pcmData.subarray(e), s)
		pcmData = newData; selStart = -1; selEnd = -1; playhead = s; clampView(); drawAll(); saveAudio()
	}
	function doTrim() {
		const sel = getSelection(); if (!sel || !pcmData) return; pushUndo()
		pcmData = pcmData.slice(sel[0], sel[1]); selStart = 0; selEnd = pcmData.length; playhead = 0
		viewStart = 0; viewEnd = pcmData.length; drawAll(); saveAudio()
	}
	function doSelectAll() { if (!pcmData) return; selStart = 0; selEnd = pcmData.length; drawAll() }

	// ══════════════════════════════════════════════════════════════════════
	// Effects (wrappers that call DSP functions)
	// ══════════════════════════════════════════════════════════════════════

	function doNormalize() {
		if (!pcmData) return; const [s, e] = getTargetRange(); pushUndo()
		let peak = 0
		for (let i = s; i < e; i++) { const abs = Math.abs(pcmData[i]); if (abs > peak) peak = abs }
		if (peak > 0 && peak < 1) { const gain = 1 / peak; for (let i = s; i < e; i++) pcmData[i] *= gain }
		drawAll(); saveAudio()
	}
	function doFadeIn() {
		const sel = getSelection(); if (!sel || !pcmData) return; pushUndo()
		const [s, e] = sel; const len = e - s
		for (let i = 0; i < len; i++) pcmData[s + i] *= i / len
		drawAll(); saveAudio()
	}
	function doFadeOut() {
		const sel = getSelection(); if (!sel || !pcmData) return; pushUndo()
		const [s, e] = sel; const len = e - s
		for (let i = 0; i < len; i++) pcmData[s + i] *= 1 - i / len
		drawAll(); saveAudio()
	}
	function doReverse() {
		const sel = getSelection(); if (!sel || !pcmData) return; pushUndo()
		pcmData.subarray(sel[0], sel[1]).reverse(); drawAll(); saveAudio()
	}
	function doInvert() {
		if (!pcmData) return; const [s, e] = getTargetRange(); pushUndo()
		for (let i = s; i < e; i++) pcmData[i] = -pcmData[i]; drawAll(); saveAudio()
	}
	function doSilence() {
		const sel = getSelection(); if (!sel || !pcmData) return; pushUndo()
		for (let i = sel[0]; i < sel[1]; i++) pcmData[i] = 0; drawAll(); saveAudio()
	}
	function doRemoveDC() {
		if (!pcmData) return; const [s, e] = getTargetRange(); pushUndo()
		dspRemoveDC(pcmData, s, e); drawAll(); saveAudio()
	}

	function doAmplify(gainDb) {
		if (!pcmData) return; const [s, e] = getTargetRange(); pushUndo()
		const gain = Math.pow(10, gainDb / 20)
		for (let i = s; i < e; i++) pcmData[i] = clamp(pcmData[i] * gain, -1, 1)
		drawAll(); saveAudio()
	}
	function doEcho(delayMs, decay, count) {
		if (!pcmData) return; const [s, e] = getTargetRange(); pushUndo()
		const delaySamples = Math.floor(delayMs / 1000 * sampleRate)
		const neededLen = e + delaySamples * count
		if (neededLen > pcmData.length) {
			const ext = new Float32Array(neededLen); ext.set(pcmData); pcmData = ext
		}
		for (let rep = 1; rep <= count; rep++) {
			const offset = delaySamples * rep; const amp = Math.pow(decay, rep)
			for (let i = s; i < e; i++) {
				const dst = i + offset
				if (dst < pcmData.length) pcmData[dst] = clamp(pcmData[dst] + pcmData[i] * amp, -1, 1)
			}
		}
		clampView(); drawAll(); saveAudio()
	}
	function doSpeed(factor) {
		if (!pcmData || factor <= 0) return; pushUndo()
		const newLen = Math.floor(pcmData.length / factor)
		const newData = new Float32Array(newLen)
		for (let i = 0; i < newLen; i++) {
			const srcIdx = i * factor; const lo = Math.floor(srcIdx); const hi = Math.min(lo + 1, pcmData.length - 1)
			newData[i] = pcmData[lo] * (1 - (srcIdx - lo)) + pcmData[hi] * (srcIdx - lo)
		}
		pcmData = newData; selStart = -1; selEnd = -1; playhead = 0
		viewStart = 0; viewEnd = pcmData.length; drawAll(); saveAudio()
	}
	function doInsertSilence(durationMs) {
		if (!pcmData) return; pushUndo()
		const insertAt = playhead >= 0 ? playhead : (hasSelection() ? Math.min(selStart, selEnd) : pcmData.length)
		const silenceSamples = Math.floor(durationMs / 1000 * sampleRate)
		const newData = new Float32Array(pcmData.length + silenceSamples)
		newData.set(pcmData.subarray(0, insertAt), 0)
		newData.set(pcmData.subarray(insertAt), insertAt + silenceSamples)
		pcmData = newData; selStart = insertAt; selEnd = insertAt + silenceSamples
		clampView(); drawAll(); saveAudio()
	}
	function doGenerateTone(freq, durationMs, waveform, amplitude) {
		if (!pcmData) return; pushUndo()
		const insertAt = playhead >= 0 ? playhead : (hasSelection() ? Math.min(selStart, selEnd) : pcmData.length)
		const toneSamples = Math.floor(durationMs / 1000 * sampleRate)
		const tone = new Float32Array(toneSamples)
		for (let i = 0; i < toneSamples; i++) {
			const t = i / sampleRate; const phase = 2 * Math.PI * freq * t
			let sample
			switch (waveform) {
				case "sine": sample = Math.sin(phase); break
				case "square": sample = Math.sin(phase) >= 0 ? 1 : -1; break
				case "sawtooth": sample = 2 * ((freq * t) % 1) - 1; break
				case "triangle": sample = 2 * Math.abs(2 * ((freq * t) % 1) - 1) - 1; break
				default: sample = Math.sin(phase)
			}
			tone[i] = sample * amplitude
		}
		const newData = new Float32Array(pcmData.length + toneSamples)
		newData.set(pcmData.subarray(0, insertAt), 0); newData.set(tone, insertAt)
		newData.set(pcmData.subarray(insertAt), insertAt + toneSamples)
		pcmData = newData; selStart = insertAt; selEnd = insertAt + toneSamples
		clampView(); drawAll(); saveAudio()
	}
	function doGenerateNoise(durationMs, amplitude) {
		if (!pcmData) return; pushUndo()
		const insertAt = playhead >= 0 ? playhead : (hasSelection() ? Math.min(selStart, selEnd) : pcmData.length)
		const noiseSamples = Math.floor(durationMs / 1000 * sampleRate)
		const noise = new Float32Array(noiseSamples)
		for (let i = 0; i < noiseSamples; i++) noise[i] = (Math.random() * 2 - 1) * amplitude
		const newData = new Float32Array(pcmData.length + noiseSamples)
		newData.set(pcmData.subarray(0, insertAt), 0); newData.set(noise, insertAt)
		newData.set(pcmData.subarray(insertAt), insertAt + noiseSamples)
		pcmData = newData; selStart = insertAt; selEnd = insertAt + noiseSamples
		clampView(); drawAll(); saveAudio()
	}

	// DSP effect wrappers
	function applyDSPEffect(fn) {
		if (!pcmData) return; const [s, e] = getTargetRange(); pushUndo()
		fn(pcmData, s, e, sampleRate); drawAll(); saveAudio()
	}

	function doPitchShift(factor) {
		if (!pcmData) return
		const [s, e] = getTargetRange(); pushUndo()
		const shifted = dspPitchShift(pcmData, s, e, factor)
		const origLen = e - s
		const newTotal = pcmData.length - origLen + shifted.length
		const newData = new Float32Array(newTotal)
		newData.set(pcmData.subarray(0, s), 0)
		newData.set(shifted, s)
		newData.set(pcmData.subarray(e), s + shifted.length)
		pcmData = newData; selStart = s; selEnd = s + shifted.length
		clampView(); drawAll(); saveAudio()
	}

	// ══════════════════════════════════════════════════════════════════════
	// Dialogs
	// ══════════════════════════════════════════════════════════════════════

	let activeDialog = null

	function showDialog(title, fields, onOk, description, previewFn) {
		if (activeDialog) activeDialog.remove()

		// Preview playback state (scoped to this dialog)
		let pvCtx = null, pvSource = null, pvGain = null, pvPlaying = false

		function getValues() {
			const values = {}
			for (const [k, inp] of Object.entries(inputs))
				values[k] = inp.type === "number" ? parseFloat(inp.value) : inp.value
			return values
		}

		function stopPreview() {
			pvPlaying = false
			if (pvSource) { try { pvSource.stop() } catch {} pvSource.disconnect(); pvSource = null }
			if (pvGain) { pvGain.disconnect(); pvGain = null }
			if (pvCtx) { pvCtx.close(); pvCtx = null }
			if (previewBtn) previewBtn.classList.remove("playing")
		}

		function doPreview() {
			stopPreview()
			if (!pcmData || !previewFn) return
			const [s, e] = getTargetRange()
			const len = e - s; if (len <= 0) return

			// Copy target range
			const tempBuf = new Float32Array(pcmData.subarray(s, e))
			// Apply effect to temp buffer
			const effectFn = previewFn(getValues())
			const result = effectFn(tempBuf, 0, tempBuf.length, sampleRate)
			// If the effect returns a new buffer (length-changing), use that
			const playBuf = result instanceof Float32Array ? result : tempBuf

			pvCtx = new AudioContext({sampleRate})
			pvGain = pvCtx.createGain()
			pvGain.gain.value = volume
			pvGain.connect(pvCtx.destination)

			const buffer = pvCtx.createBuffer(1, playBuf.length, sampleRate)
			buffer.getChannelData(0).set(playBuf)
			pvSource = pvCtx.createBufferSource()
			pvSource.buffer = buffer
			pvSource.connect(pvGain)
			pvSource.onended = () => {
				pvPlaying = false
				if (previewBtn) previewBtn.classList.remove("playing")
			}
			pvSource.start(0)
			pvPlaying = true
			if (previewBtn) previewBtn.classList.add("playing")
		}

		const overlay = el("div", "se-dialog-overlay")
		const dialog = el("div", "se-dialog")
		const h3 = document.createElement("h3"); h3.textContent = title; dialog.appendChild(h3)
		if (description) {
			const desc = el("div", "se-dialog-desc"); desc.textContent = description; dialog.appendChild(desc)
		}
		const inputs = {}
		for (const field of fields) {
			const label = document.createElement("label")
			label.textContent = field.label + ": "
			if (field.type === "select") {
				const select = document.createElement("select")
				for (const opt of field.options) {
					const o = document.createElement("option"); o.value = opt.value; o.textContent = opt.label; select.appendChild(o)
				}
				select.value = field.value; inputs[field.key] = select; label.appendChild(select)
			} else {
				const input = document.createElement("input")
				input.type = field.type || "number"
				if (field.min !== undefined) input.min = field.min
				if (field.max !== undefined) input.max = field.max
				if (field.step !== undefined) input.step = field.step
				input.value = field.value; inputs[field.key] = input; label.appendChild(input)
			}
			dialog.appendChild(label)
		}

		const buttons = el("div", "se-dialog-buttons")
		let previewBtn = null

		// Add preview controls if previewFn is provided
		if (previewFn) {
			const previewGroup = el("div", "se-preview-group")
			previewBtn = document.createElement("button")
			previewBtn.textContent = "\u25B6 Preview"
			previewBtn.className = "preview-btn"
			previewBtn.addEventListener("click", doPreview)
			const stopBtn = document.createElement("button")
			stopBtn.textContent = "\u23F9 Stop"
			stopBtn.className = "stop-btn"
			stopBtn.addEventListener("click", stopPreview)
			previewGroup.append(previewBtn, stopBtn)
			buttons.appendChild(previewGroup)
		}

		const cancelBtn = document.createElement("button"); cancelBtn.textContent = "Cancel"
		cancelBtn.addEventListener("click", () => { stopPreview(); overlay.remove(); activeDialog = null })
		const okBtn = document.createElement("button")
		okBtn.textContent = previewFn ? "Apply" : "OK"
		okBtn.className = "primary"
		okBtn.addEventListener("click", () => {
			stopPreview(); overlay.remove(); activeDialog = null; onOk(getValues())
		})
		buttons.append(cancelBtn, okBtn); dialog.appendChild(buttons)
		overlay.appendChild(dialog); root.appendChild(overlay); activeDialog = overlay
		const firstInput = dialog.querySelector("input, select"); if (firstInput) firstInput.focus()
		overlay.addEventListener("keydown", e => {
			if (e.key === "Enter") { e.preventDefault(); okBtn.click() }
			if (e.key === "Escape") { stopPreview(); cancelBtn.click() }
			// P key for quick preview
			if (e.key === "p" && !e.ctrlKey && !e.metaKey && e.target.tagName !== "INPUT" && e.target.tagName !== "SELECT") {
				e.preventDefault(); if (pvPlaying) stopPreview(); else doPreview()
			}
		})
	}

	// ── All dialog launchers ──

	function showAmplifyDialog() {
		showDialog("Amplify", [
			{key: "gain", label: "Gain (dB)", value: 0, min: -60, max: 60, step: 0.5},
		], v => doAmplify(v.gain), null,
		v => (d, s, e) => {
			const gain = Math.pow(10, v.gain / 20)
			for (let i = s; i < e; i++) d[i] = clamp(d[i] * gain, -1, 1)
		})
	}
	function showEchoDialog() {
		showDialog("Echo", [
			{key: "delay", label: "Delay (ms)", value: 250, min: 1, max: 5000, step: 1},
			{key: "decay", label: "Decay (0-1)", value: 0.5, min: 0, max: 1, step: 0.05},
			{key: "count", label: "Repeats", value: 3, min: 1, max: 20, step: 1},
		], v => doEcho(v.delay, v.decay, v.count), null,
		v => (d, s, e, sr) => {
			// For preview, echo within the buffer (no extend)
			const delaySamples = Math.floor(v.delay / 1000 * sr)
			for (let rep = 1; rep <= v.count; rep++) {
				const offset = delaySamples * rep; const amp = Math.pow(v.decay, rep)
				for (let i = s; i < e; i++) {
					const dst = i + offset; if (dst < e) d[dst] = clamp(d[dst] + d[i] * amp, -1, 1)
				}
			}
		})
	}
	function showSpeedDialog() {
		showDialog("Change Speed", [
			{key: "factor", label: "Speed factor", value: 1.0, min: 0.1, max: 10, step: 0.1},
		], v => doSpeed(v.factor), "Changes both speed and pitch. 2.0 = double speed / octave up.",
		v => (d, s, e, sr) => {
			// Return resampled buffer
			const len = e - s; const newLen = Math.floor(len / v.factor)
			const out = new Float32Array(newLen)
			for (let i = 0; i < newLen; i++) {
				const srcIdx = i * v.factor; const lo = Math.floor(srcIdx); const hi = Math.min(lo + 1, len - 1)
				out[i] = d[s + lo] * (1 - (srcIdx - lo)) + d[s + hi] * (srcIdx - lo)
			}
			return out
		})
	}
	function showInsertSilenceDialog() {
		showDialog("Insert Silence", [
			{key: "duration", label: "Duration (ms)", value: 1000, min: 1, max: 60000, step: 100},
		], v => doInsertSilence(v.duration))
	}
	function showToneDialog() {
		showDialog("Tone Generator", [
			{key: "freq", label: "Frequency (Hz)", value: 440, min: 20, max: 20000, step: 1},
			{key: "duration", label: "Duration (ms)", value: 1000, min: 1, max: 60000, step: 100},
			{key: "waveform", label: "Waveform", type: "select", value: "sine", options: [
				{value: "sine", label: "Sine"}, {value: "square", label: "Square"},
				{value: "sawtooth", label: "Sawtooth"}, {value: "triangle", label: "Triangle"},
			]},
			{key: "amplitude", label: "Amplitude (0-1)", value: 0.8, min: 0, max: 1, step: 0.05},
		], v => doGenerateTone(v.freq, v.duration, v.waveform, v.amplitude), null,
		v => (d, s, e, sr) => {
			// Preview the tone directly
			const toneSamples = Math.floor(v.duration / 1000 * sr)
			const tone = new Float32Array(toneSamples)
			for (let i = 0; i < toneSamples; i++) {
				const t = i / sr; const phase = 2 * Math.PI * v.freq * t
				let sample
				switch (v.waveform) {
					case "sine": sample = Math.sin(phase); break
					case "square": sample = Math.sin(phase) >= 0 ? 1 : -1; break
					case "sawtooth": sample = 2 * ((v.freq * t) % 1) - 1; break
					case "triangle": sample = 2 * Math.abs(2 * ((v.freq * t) % 1) - 1) - 1; break
					default: sample = Math.sin(phase)
				}
				tone[i] = sample * v.amplitude
			}
			return tone
		})
	}
	function showNoiseDialog() {
		showDialog("White Noise Generator", [
			{key: "duration", label: "Duration (ms)", value: 1000, min: 1, max: 60000, step: 100},
			{key: "amplitude", label: "Amplitude (0-1)", value: 0.5, min: 0, max: 1, step: 0.05},
		], v => doGenerateNoise(v.duration, v.amplitude), null,
		v => (d, s, e, sr) => {
			const noiseSamples = Math.floor(v.duration / 1000 * sr)
			const noise = new Float32Array(noiseSamples)
			for (let i = 0; i < noiseSamples; i++) noise[i] = (Math.random() * 2 - 1) * v.amplitude
			return noise
		})
	}

	// ── DSP EFFECT DIALOGS (all with preview) ──

	function showFlangerDialog() {
		showDialog("Flanger", [
			{key: "rate", label: "Rate (Hz)", value: 0.5, min: 0.01, max: 10, step: 0.01},
			{key: "depth", label: "Depth (0-1)", value: 0.7, min: 0, max: 1, step: 0.05},
			{key: "feedback", label: "Feedback (0-0.95)", value: 0.5, min: 0, max: 0.95, step: 0.05},
			{key: "mix", label: "Wet mix (0-1)", value: 0.5, min: 0, max: 1, step: 0.05},
		], v => applyDSPEffect((d, s, e, sr) => dspFlanger(d, s, e, sr, v.rate, v.depth, v.feedback, v.mix)),
		"Modulated short delay creating a sweeping, jet-like sound.",
		v => (d, s, e, sr) => dspFlanger(d, s, e, sr, v.rate, v.depth, v.feedback, v.mix))
	}
	function showPhaserDialog() {
		showDialog("Phaser", [
			{key: "rate", label: "Rate (Hz)", value: 0.5, min: 0.01, max: 10, step: 0.01},
			{key: "depth", label: "Depth (0-1)", value: 0.7, min: 0, max: 1, step: 0.05},
			{key: "feedback", label: "Feedback (0-0.95)", value: 0.4, min: 0, max: 0.95, step: 0.05},
			{key: "stages", label: "Stages (2-12)", value: 6, min: 2, max: 12, step: 1},
		], v => applyDSPEffect((d, s, e, sr) => dspPhaser(d, s, e, sr, v.rate, v.depth, v.feedback, v.stages)),
		"Chain of allpass filters with LFO-swept center frequency.",
		v => (d, s, e, sr) => dspPhaser(d, s, e, sr, v.rate, v.depth, v.feedback, v.stages))
	}
	function showCombDialog() {
		showDialog("Comb Filter", [
			{key: "delay", label: "Delay (ms)", value: 5, min: 0.1, max: 100, step: 0.1},
			{key: "feedforward", label: "Feedforward (0-1)", value: 0.7, min: 0, max: 1, step: 0.05},
			{key: "feedback", label: "Feedback (0-0.95)", value: 0.5, min: 0, max: 0.95, step: 0.05},
		], v => applyDSPEffect((d, s, e, sr) => dspComb(d, s, e, sr, v.delay, v.feedforward, v.feedback)),
		"Creates resonant peaks/notches at harmonics of 1/delay. Short delays = metallic, long = echo-like.",
		v => (d, s, e, sr) => dspComb(d, s, e, sr, v.delay, v.feedforward, v.feedback))
	}
	function showChorusDialog() {
		showDialog("Chorus", [
			{key: "rate", label: "Rate (Hz)", value: 1.5, min: 0.1, max: 10, step: 0.1},
			{key: "depth", label: "Depth (0-1)", value: 0.4, min: 0, max: 1, step: 0.05},
			{key: "voices", label: "Voices (2-6)", value: 3, min: 2, max: 6, step: 1},
			{key: "mix", label: "Wet mix (0-1)", value: 0.5, min: 0, max: 1, step: 0.05},
		], v => applyDSPEffect((d, s, e, sr) => dspChorus(d, s, e, sr, v.rate, v.depth, v.voices, v.mix)),
		"Multiple detuned delay voices for a thick, ensemble sound.",
		v => (d, s, e, sr) => dspChorus(d, s, e, sr, v.rate, v.depth, v.voices, v.mix))
	}
	function showTremoloDialog() {
		showDialog("Tremolo", [
			{key: "rate", label: "Rate (Hz)", value: 5, min: 0.1, max: 20, step: 0.1},
			{key: "depth", label: "Depth (0-1)", value: 0.5, min: 0, max: 1, step: 0.05},
		], v => applyDSPEffect((d, s, e, sr) => dspTremolo(d, s, e, sr, v.rate, v.depth)),
		"Amplitude modulation by a low-frequency oscillator.",
		v => (d, s, e, sr) => dspTremolo(d, s, e, sr, v.rate, v.depth))
	}
	function showVibratoDialog() {
		showDialog("Vibrato", [
			{key: "rate", label: "Rate (Hz)", value: 5, min: 0.1, max: 20, step: 0.1},
			{key: "depth", label: "Depth (0-1)", value: 0.3, min: 0, max: 1, step: 0.05},
		], v => applyDSPEffect((d, s, e, sr) => dspVibrato(d, s, e, sr, v.rate, v.depth)),
		"Pitch modulation via variable delay line.",
		v => (d, s, e, sr) => dspVibrato(d, s, e, sr, v.rate, v.depth))
	}
	function showRingModDialog() {
		showDialog("Ring Modulator", [
			{key: "freq", label: "Carrier freq (Hz)", value: 440, min: 1, max: 5000, step: 1},
			{key: "mix", label: "Mix (0-1)", value: 1.0, min: 0, max: 1, step: 0.05},
		], v => applyDSPEffect((d, s, e, sr) => dspRingMod(d, s, e, sr, v.freq, v.mix)),
		"Multiplies the signal by a carrier oscillator for metallic/bell-like tones.",
		v => (d, s, e, sr) => dspRingMod(d, s, e, sr, v.freq, v.mix))
	}
	function showWahwahDialog() {
		showDialog("Wahwah", [
			{key: "rate", label: "Rate (Hz)", value: 1.5, min: 0.1, max: 10, step: 0.1},
			{key: "depth", label: "Depth (0-1)", value: 0.8, min: 0, max: 1, step: 0.05},
			{key: "resonance", label: "Resonance (0-1)", value: 0.5, min: 0, max: 1, step: 0.05},
		], v => applyDSPEffect((d, s, e, sr) => dspWahwah(d, s, e, sr, v.rate, v.depth, v.resonance)),
		"Swept bandpass filter creating a \"wah\" sound.",
		v => (d, s, e, sr) => dspWahwah(d, s, e, sr, v.rate, v.depth, v.resonance))
	}
	function showCompressorDialog() {
		showDialog("Compressor", [
			{key: "threshold", label: "Threshold (dB)", value: -20, min: -60, max: 0, step: 1},
			{key: "ratio", label: "Ratio", value: 4, min: 1, max: 20, step: 0.5},
			{key: "attack", label: "Attack (ms)", value: 10, min: 0.1, max: 200, step: 0.1},
			{key: "release", label: "Release (ms)", value: 100, min: 1, max: 2000, step: 1},
			{key: "makeup", label: "Makeup gain (dB)", value: 0, min: 0, max: 30, step: 0.5},
		], v => applyDSPEffect((d, s, e, sr) => dspCompressor(d, s, e, sr, v.threshold, v.ratio, v.attack, v.release, v.makeup)),
		"Reduces dynamic range by attenuating signals above the threshold.",
		v => (d, s, e, sr) => dspCompressor(d, s, e, sr, v.threshold, v.ratio, v.attack, v.release, v.makeup))
	}
	function showNoiseGateDialog() {
		showDialog("Noise Gate", [
			{key: "threshold", label: "Threshold (dB)", value: -40, min: -80, max: 0, step: 1},
			{key: "attack", label: "Attack (ms)", value: 1, min: 0.1, max: 100, step: 0.1},
			{key: "release", label: "Release (ms)", value: 50, min: 1, max: 1000, step: 1},
		], v => applyDSPEffect((d, s, e, sr) => dspNoiseGate(d, s, e, sr, v.threshold, v.attack, v.release)),
		"Silences audio below the threshold. Good for removing background noise between words.",
		v => (d, s, e, sr) => dspNoiseGate(d, s, e, sr, v.threshold, v.attack, v.release))
	}
	function showDistortionDialog() {
		showDialog("Distortion / Overdrive", [
			{key: "drive", label: "Drive (0-1)", value: 0.5, min: 0, max: 1, step: 0.05},
			{key: "mix", label: "Mix (0-1)", value: 0.8, min: 0, max: 1, step: 0.05},
		], v => applyDSPEffect((d, s, e) => dspDistortion(d, s, e, v.drive, v.mix)),
		"Soft-clipping waveshaper. Low drive = warm saturation, high drive = heavy distortion.",
		v => (d, s, e) => dspDistortion(d, s, e, v.drive, v.mix))
	}
	function showBitcrusherDialog() {
		showDialog("Bitcrusher", [
			{key: "bits", label: "Bit depth (1-16)", value: 8, min: 1, max: 16, step: 1},
			{key: "downsample", label: "Downsample factor", value: 4, min: 1, max: 64, step: 1},
		], v => applyDSPEffect((d, s, e, sr) => dspBitcrusher(d, s, e, sr, v.bits, v.downsample)),
		"Reduces bit depth and effective sample rate for a lo-fi, retro sound.",
		v => (d, s, e, sr) => dspBitcrusher(d, s, e, sr, v.bits, v.downsample))
	}
	function showReverbDialog() {
		showDialog("Reverb (Schroeder)", [
			{key: "roomSize", label: "Room size (0.1-3)", value: 1.0, min: 0.1, max: 3, step: 0.05},
			{key: "damping", label: "Damping (0-1)", value: 0.5, min: 0, max: 1, step: 0.05},
			{key: "mix", label: "Wet mix (0-1)", value: 0.3, min: 0, max: 1, step: 0.05},
		], v => applyDSPEffect((d, s, e, sr) => dspReverb(d, s, e, sr, v.roomSize, v.damping, v.mix)),
		"Algorithmic reverb using 4 comb + 2 allpass filters (Schroeder/Freeverb-style).",
		v => (d, s, e, sr) => dspReverb(d, s, e, sr, v.roomSize, v.damping, v.mix))
	}
	function showPitchShiftDialog() {
		showDialog("Pitch Shift", [
			{key: "factor", label: "Pitch factor", value: 1.0, min: 0.25, max: 4, step: 0.05},
		], v => doPitchShift(v.factor),
		"Shifts pitch by resampling. 2.0 = octave up, 0.5 = octave down. Changes selection length.",
		v => (d, s, e, sr) => dspPitchShift(d, s, e, v.factor))
	}

	function showFilterDialog(type) {
		const names = {lowpass: "Low-Pass", highpass: "High-Pass", bandpass: "Band-Pass", notch: "Notch"}
		showDialog(`${names[type]} Filter`, [
			{key: "freq", label: "Frequency (Hz)", value: 1000, min: 20, max: 20000, step: 1},
			{key: "Q", label: "Q (resonance)", value: 0.707, min: 0.1, max: 30, step: 0.1},
		], v => {
			if (!pcmData) return; const [s, e] = getTargetRange(); pushUndo()
			const c = biquadCoeffs(type, sampleRate, v.freq, v.Q)
			applyBiquad(pcmData, s, e, c); drawAll(); saveAudio()
		}, `Standard biquad ${names[type].toLowerCase()} filter.`,
		v => (d, s, e, sr) => { const c = biquadCoeffs(type, sr, v.freq, v.Q); applyBiquad(d, s, e, c) })
	}
	function showParaEQDialog() {
		showDialog("Parametric EQ (Peaking)", [
			{key: "freq", label: "Frequency (Hz)", value: 1000, min: 20, max: 20000, step: 1},
			{key: "Q", label: "Q (bandwidth)", value: 1, min: 0.1, max: 30, step: 0.1},
			{key: "gain", label: "Gain (dB)", value: 0, min: -24, max: 24, step: 0.5},
		], v => {
			if (!pcmData) return; const [s, e] = getTargetRange(); pushUndo()
			const c = biquadCoeffs("peaking", sampleRate, v.freq, v.Q, v.gain)
			applyBiquad(pcmData, s, e, c); drawAll(); saveAudio()
		}, "Boosts or cuts a frequency band. Q controls width.",
		v => (d, s, e, sr) => { const c = biquadCoeffs("peaking", sr, v.freq, v.Q, v.gain); applyBiquad(d, s, e, c) })
	}
	function showShelfDialog(type) {
		const name = type === "lowshelf" ? "Low-Shelf" : "High-Shelf"
		showDialog(`${name} Filter`, [
			{key: "freq", label: "Frequency (Hz)", value: type === "lowshelf" ? 200 : 4000, min: 20, max: 20000, step: 1},
			{key: "Q", label: "Slope (Q)", value: 0.707, min: 0.1, max: 5, step: 0.1},
			{key: "gain", label: "Gain (dB)", value: 0, min: -24, max: 24, step: 0.5},
		], v => {
			if (!pcmData) return; const [s, e] = getTargetRange(); pushUndo()
			const c = biquadCoeffs(type, sampleRate, v.freq, v.Q, v.gain)
			applyBiquad(pcmData, s, e, c); drawAll(); saveAudio()
		}, `Boosts or cuts all frequencies ${type === "lowshelf" ? "below" : "above"} the cutoff.`,
		v => (d, s, e, sr) => { const c = biquadCoeffs(type, sr, v.freq, v.Q, v.gain); applyBiquad(d, s, e, c) })
	}

	function showLPCDialog() {
		showDialog("LPC Vocoder", [
			{key: "order", label: "LPC Order (4-50)", value: 16, min: 4, max: 50, step: 1},
			{key: "frameSize", label: "Frame size (samples)", value: 512, min: 64, max: 4096, step: 64},
			{key: "mode", label: "Mode", type: "select", value: "robot", options: [
				{value: "resynth", label: "Clean Resynth"},
				{value: "robot", label: "Robot (impulse train)"},
				{value: "whisper", label: "Whisper (noise)"},
				{value: "residual", label: "Residual only"},
			]},
		], v => applyDSPEffect((d, s, e, sr) => dspLPC(d, s, e, sr, v.order, v.frameSize, v.mode)),
		"Linear Predictive Coding: decomposes audio into filter + excitation per frame, then resynthesizes. " +
		"Order controls spectral detail (speech: 10-16, music: 20-40). Frame size controls temporal resolution. " +
		"Robot = pitched impulse train, Whisper = noise excitation, Residual = just the prediction error.",
		v => (d, s, e, sr) => dspLPC(d, s, e, sr, v.order, v.frameSize, v.mode))
	}

	// ── Save ──

	async function saveAudio() {
		if (!pcmData) return
		let encoded = await encodeFlac(pcmData, sampleRate)
		let bytes, mimeType, extension
		if (encoded) { ;({bytes, mimeType, extension} = encoded) }
		else { bytes = encodeWav(pcmData, sampleRate); mimeType = "audio/wav"; extension = "wav" }
		const newHandle = await repo.create2({ content: bytes, extension, mimeType, name: `recording.${extension}` })
		lastAudioUrl = newHandle.url // prevent re-loading our own save
		handle.change(doc => { doc.audio = newHandle.url })
		broadcastPresence()
	}

	// ── Button handlers ──

	btnRewind.addEventListener("click", () => {
		if (!pcmData) return; playhead = 0; selStart = -1; selEnd = -1
		if (playing) { teardownAudio(); startPlayback() } else drawAll()
	})
	btnPlay.addEventListener("click", () => { if (playing) teardownAudio(); startPlayback() })
	btnPause.addEventListener("click", pausePlayback)
	btnStop.addEventListener("click", () => { if (isRecordingAtPlayhead) stopRecAtPlayhead(); else stopPlayback() })
	btnLoop.addEventListener("click", () => {
		looping = !looping; btnLoop.classList.toggle("active", looping)
		if (playing) { const h = playhead; teardownAudio(); playhead = h; startPlayback() }
	})

	// ── Record at playhead ──
	let recStream = null
	let recAudioCtx = null
	let recNode = null
	let isRecordingAtPlayhead = false
	let recInsertPos = 0
	let recChunks = []
	let recSamplesRecorded = 0
	let recAnimFrame = null
	let preRecordPcm = null // snapshot of pcmData before recording started
	let recDirty = false // flag: new chunks arrived since last draw

	function rebuildPcmFromRecording() {
		const before = preRecordPcm ? preRecordPcm.subarray(0, recInsertPos) : new Float32Array(0)
		const after = preRecordPcm ? preRecordPcm.subarray(recInsertPos) : new Float32Array(0)
		const newLen = before.length + recSamplesRecorded + after.length
		const newData = new Float32Array(newLen)
		newData.set(before, 0)
		let off = before.length
		for (const c of recChunks) { newData.set(c, off); off += c.length }
		newData.set(after, before.length + recSamplesRecorded)
		pcmData = newData
		playhead = recInsertPos + recSamplesRecorded
		viewStart = 0; viewEnd = pcmData.length
	}

	async function startRecAtPlayhead() {
		if (isRecordingAtPlayhead) return
		if (playing) teardownAudio()

		try {
			recStream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 48000, channelCount: 1 }
			})
		} catch { return }

		recAudioCtx = new AudioContext({sampleRate: sampleRate || 48000})
		sampleRate = recAudioCtx.sampleRate
		const source = recAudioCtx.createMediaStreamSource(recStream)
		const blob = new Blob([RECORDER_WORKLET_SRC], {type: "application/javascript"})
		const url = URL.createObjectURL(blob)
		await recAudioCtx.audioWorklet.addModule(url)
		URL.revokeObjectURL(url)

		recInsertPos = playhead >= 0 ? playhead : (pcmData ? pcmData.length : 0)
		recSamplesRecorded = 0
		recChunks = []
		recDirty = false
		preRecordPcm = pcmData ? new Float32Array(pcmData) : null

		recNode = new AudioWorkletNode(recAudioCtx, "recorder-processor")
		recNode.port.onmessage = e => {
			if (e.data.type === "chunk") {
				recChunks.push(e.data.samples)
				recSamplesRecorded += e.data.samples.length
				recDirty = true
			}
		}
		source.connect(recNode)
		recNode.connect(recAudioCtx.destination)

		isRecordingAtPlayhead = true
		btnRec.classList.add("rec-active")
		selStart = -1; selEnd = -1

		// Animate waveform while recording (~30fps rebuild)
		function recDraw() {
			if (!isRecordingAtPlayhead) return
			if (recDirty) {
				recDirty = false
				rebuildPcmFromRecording()
			}
			drawAll()
			recAnimFrame = requestAnimationFrame(recDraw)
		}
		recDraw()
	}

	async function stopRecAtPlayhead() {
		if (!isRecordingAtPlayhead) return
		isRecordingAtPlayhead = false
		btnRec.classList.remove("rec-active")
		if (recAnimFrame) { cancelAnimationFrame(recAnimFrame); recAnimFrame = null }

		if (recNode) { recNode.port.postMessage({type: "stop"}); recNode.disconnect(); recNode = null }
		if (recStream) { for (const t of recStream.getTracks()) t.stop(); recStream = null }
		if (recAudioCtx) { await recAudioCtx.close(); recAudioCtx = null }

		if (recSamplesRecorded === 0) {
			if (preRecordPcm) pcmData = preRecordPcm
			else pcmData = null
			preRecordPcm = null
			recChunks = []
			drawAll(); return
		}

		// Push undo with the pre-record state so user can undo
		undoStack.push(preRecordPcm || new Float32Array(0))
		if (undoStack.length > MAX_UNDO) undoStack.shift()
		redoStack = []
		// Final rebuild
		rebuildPcmFromRecording()
		preRecordPcm = null
		recChunks = []
		selStart = -1; selEnd = -1
		clampView(); drawAll(); saveAudio()
	}

	btnRec.addEventListener("click", () => {
		if (isRecordingAtPlayhead) stopRecAtPlayhead()
		else startRecAtPlayhead()
	})

	// ── Keyboard shortcuts ──
	// Space = play/pause (pause PLACES the cursor where playback reached)

	function onKeyDown(e) {
		if (activeDialog) return
		if (!pcmData) return
		const mod = e.metaKey || e.ctrlKey

		if (mod && e.shiftKey && e.key === "S") { e.preventDefault(); zoomToSelection() }
		else if (mod && e.shiftKey && e.key === "A") { e.preventDefault(); zoomAll() }
		else if (mod && e.key === "z") { e.preventDefault(); doUndo() }
		else if (mod && e.key === "y") { e.preventDefault(); doRedo() }
		else if (mod && e.key === "x") { e.preventDefault(); doCut() }
		else if (mod && e.key === "c") { e.preventDefault(); doCopy() }
		else if (mod && e.key === "v") { e.preventDefault(); doPaste() }
		else if (mod && e.key === "m") { e.preventDefault(); doMixPaste() }
		else if (mod && e.key === "a") { e.preventDefault(); doSelectAll() }
		else if (mod && e.key === "t") { e.preventDefault(); doTrim() }
		else if (e.key === "Delete" || e.key === "Backspace") { if (hasSelection()) { e.preventDefault(); doDelete() } }
		else if (e.key === " ") {
			e.preventDefault()
			// Space = play/pause. Pause PLACES the cursor at current playback position.
			if (playing) pausePlayback()
			else startPlayback()
		}
		else if (e.key === "Escape") { if (isRecordingAtPlayhead) stopRecAtPlayhead(); else if (playing) stopPlayback() }
		else if (e.key === "Home") { e.preventDefault(); playhead = 0; selStart = -1; selEnd = -1; drawAll() }
		else if (e.key === "End") { e.preventDefault(); playhead = pcmData.length; selStart = -1; selEnd = -1; drawAll() }
		else if (e.key === "ArrowUp") { e.preventDefault(); zoomBy(0.5) }
		else if (e.key === "ArrowDown") { e.preventDefault(); zoomBy(2) }
		else if (e.key === "ArrowLeft") { e.preventDefault(); scrollView(-Math.floor((viewEnd - viewStart) * 0.1)) }
		else if (e.key === "ArrowRight") { e.preventDefault(); scrollView(Math.floor((viewEnd - viewStart) * 0.1)) }
		else if (e.key === "l") { btnLoop.click() }
		else if (e.key === "r") { btnRec.click() }
	}

	element.addEventListener("keydown", onKeyDown)
	element.setAttribute("tabindex", "0")

	// ── Resize ──
	const resizeObserver = new ResizeObserver(() => drawAll())
	resizeObserver.observe(waveWrap)
	resizeObserver.observe(rulerWrap)
	resizeObserver.observe(overview)

	// ── Cleanup ──
	return () => {
		destroyed = true; teardownAudio()
		offContact()
		if (isRecordingAtPlayhead) { isRecordingAtPlayhead = false }
		if (recNode) { recNode.port.postMessage({type: "stop"}); recNode.disconnect(); recNode = null }
		if (recStream) { for (const t of recStream.getTracks()) t.stop(); recStream = null }
		if (recAudioCtx && recAudioCtx.state !== "closed") { recAudioCtx.close(); recAudioCtx = null }
		document.removeEventListener("click", closeMenus)
		element.removeEventListener("keydown", onKeyDown)
		resizeObserver.disconnect()
		handle.off("change", onDocChange)
		handle.off("ephemeral-message", onEphemeralMessage)
		if (presenceInterval) clearInterval(presenceInterval)
		if (activeDialog) activeDialog.remove()
		style.remove(); root.remove()
	}
}
