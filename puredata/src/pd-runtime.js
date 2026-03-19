/**
 * PD Runtime — libpd/emscripten (empd) integration for audio playback.
 *
 * Uses a WASM build of libpd (via claudeha's emscripten branch) to run
 * Pure Data patches in the browser. Patches are written to emscripten's
 * virtual filesystem and opened dynamically.
 *
 * Audio output via AudioWorkletNode with a SharedArrayBuffer ring buffer.
 * Falls back to ScriptProcessorNode if SharedArrayBuffer is unavailable.
 */

let empdModule = null
let loadPromise = null

/**
 * Debug logger matching the `debug` npm package convention.
 * Set localStorage.setItem("DEBUG", "puredata:*") to enable all,
 * or "puredata:empd" / "puredata:editor" for specific namespaces.
 * Supports comma-separated patterns and wildcards.
 */
function debugEnabled(namespace) {
	try {
		const flag = localStorage.getItem("DEBUG") || ""
		if (!flag) return false
		return flag.split(/[\s,]+/).some(pattern => {
			if (!pattern) return false
			const re = new RegExp("^" + pattern.replace(/\*/g, ".*?") + "$")
			return re.test(namespace)
		})
	} catch { return false }
}

export function pdDebug(namespace, ...args) {
	if (debugEnabled(namespace)) console.log(`[${namespace}]`, ...args)
}

/**
 * Resolve the URL of a sibling file relative to this module.
 */
function siblingUrl(filename) {
	try {
		return new URL(filename, import.meta.url).href
	} catch {
		return filename
	}
}

async function loadEmpd() {
	if (empdModule) return empdModule
	if (loadPromise) return loadPromise
	loadPromise = (async () => {
		try {
			const wasmUrl = siblingUrl("empd.wasm")
			const wasmResponse = await fetch(wasmUrl)
			if (!wasmResponse.ok) throw new Error(`Failed to fetch empd.wasm: ${wasmResponse.status}`)
			const wasmBinary = await wasmResponse.arrayBuffer()

			const { default: createEmpdModule } = await import(siblingUrl("empd.js"))
			const mod = await createEmpdModule({ wasmBinary })
			empdModule = mod
			return mod
		} catch (err) {
			console.warn("empd not available:", err)
			return null
		}
	})()
	return loadPromise
}

// ─── AudioWorklet processor source ───
// Uses a shared Int32Array for read/write position synchronization:
//   positions[0] = writePos (set by main thread)
//   positions[1] = readPos  (set by worklet)
const WORKLET_SRC = `
class EmpdProcessor extends AudioWorkletProcessor {
	constructor(options) {
		super()
		const { ringBuffer, ringFrames, positions, inputRingBuffer, inputRingFrames } = options.processorOptions
		this.ring = new Float32Array(ringBuffer)
		this.ringFrames = ringFrames
		this.positions = new Int32Array(positions)
		this.readPos = 0
		if (inputRingBuffer) {
			this.inputRing = new Float32Array(inputRingBuffer)
			this.inputRingFrames = inputRingFrames
			this.inputWritePos = 0
		}
	}

	process(inputs, outputs) {
		const out = outputs[0]
		if (!out || !out[0]) return true
		const outL = out[0]
		const outR = out[1] || out[0]
		const frames = outL.length
		const ring = this.ring
		const ringFrames = this.ringFrames

		// Write mic input to input ring buffer
		if (this.inputRing && inputs[0] && inputs[0][0]) {
			const inL = inputs[0][0]
			for (let i = 0; i < inL.length; i++) {
				this.inputRing[(this.inputWritePos + i) % this.inputRingFrames] = inL[i]
			}
			this.inputWritePos = (this.inputWritePos + inL.length) % this.inputRingFrames
		}

		const writePos = Atomics.load(this.positions, 0)
		// How many frames are available to read?
		let available = writePos - this.readPos
		if (available < 0) available += ringFrames

		for (let i = 0; i < frames; i++) {
			if (i < available) {
				const idx = ((this.readPos + i) % ringFrames) * 2
				outL[i] = ring[idx]
				outR[i] = ring[idx + 1]
			} else {
				// Underrun — output silence
				outL[i] = 0
				outR[i] = 0
			}
		}
		const consumed = Math.min(frames, available)
		this.readPos = (this.readPos + consumed) % ringFrames
		Atomics.store(this.positions, 1, this.readPos)
		return true
	}
}

registerProcessor("empd-processor", EmpdProcessor)
`

let workletBlobUrl = null

/**
 * Create a PD audio runtime.
 */
export function createRuntime() {
	let audioContext = null
	let audioNode = null
	let isPlaying = false
	let onStatusChange = null
	let mod = null
	let fillInterval = null
	let bufPtr = 0
	let inBufPtr = 0
	let micEnabled = false
	let micStream = null
	let micSource = null
	let midiEnabled = false
	let midiAccess = null
	let midiInputHandlers = new Map() // MIDIInput → handler

	// Receive callback registry: symbol → Set<callback>
	const bindings = new Map()
	// Bound pointers for cleanup: symbol → pointer
	const bindPtrs = new Map()
	// Whether the loaded WASM has the new API
	let hasNewApi = false
	// Whether the WASM has MIDI exports
	let hasMidiApi = false

	function handleMidiMessage(event) {
		if (!mod || !hasMidiApi) return
		const data = event.data
		if (!data || data.length < 1) return
		const status = data[0] & 0xf0
		const channel = data[0] & 0x0f
		switch (status) {
			case 0x90: // Note On
				mod.ccall("empd_noteon", "number", ["number", "number", "number"],
					[channel, data[1], data[2]])
				break
			case 0x80: // Note Off → Note On with velocity 0
				mod.ccall("empd_noteon", "number", ["number", "number", "number"],
					[channel, data[1], 0])
				break
			case 0xb0: // Control Change
				mod.ccall("empd_controlchange", "number", ["number", "number", "number"],
					[channel, data[1], data[2]])
				break
			case 0xe0: // Pitch Bend (combine two 7-bit bytes into 0-16383, centered at 8192)
				mod.ccall("empd_pitchbend", "number", ["number", "number"],
					[channel, (data[2] << 7 | data[1]) - 8192])
				break
			case 0xc0: // Program Change
				mod.ccall("empd_programchange", "number", ["number", "number"],
					[channel, data[1]])
				break
			case 0xd0: // Channel Aftertouch
				mod.ccall("empd_aftertouch", "number", ["number", "number"],
					[channel, data[1]])
				break
			case 0xa0: // Poly Aftertouch
				mod.ccall("empd_polyaftertouch", "number", ["number", "number", "number"],
					[channel, data[1], data[2]])
				break
		}
	}

	function attachMidiInput(input) {
		if (midiInputHandlers.has(input.id)) return
		const handler = (e) => handleMidiMessage(e)
		input.onmidimessage = handler
		midiInputHandlers.set(input.id, { input, handler })
	}

	function detachMidiInput(input) {
		const entry = midiInputHandlers.get(input.id)
		if (entry) {
			input.onmidimessage = null
			midiInputHandlers.delete(input.id)
		}
	}

	return {
		get isPlaying() {
			return isPlaying
		},

		set onStatusChange(fn) {
			onStatusChange = fn
		},

		get micEnabled() {
			return micEnabled
		},

		async enableMic() {
			if (micEnabled) return true
			try {
				micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
				micEnabled = true
				return true
			} catch (err) {
				console.warn("Mic access denied:", err)
				return false
			}
		},

		disableMic() {
			if (micStream) {
				micStream.getTracks().forEach(t => t.stop())
				micStream = null
			}
			if (micSource) {
				try { micSource.disconnect() } catch {}
				micSource = null
			}
			micEnabled = false
		},

		get midiEnabled() {
			return midiEnabled
		},

		async enableMidi() {
			if (midiEnabled) return true
			if (!navigator.requestMIDIAccess) {
				console.warn("WebMIDI not supported in this browser")
				return false
			}
			try {
				midiAccess = await navigator.requestMIDIAccess()
				for (const input of midiAccess.inputs.values()) {
					attachMidiInput(input)
				}
				midiAccess.onstatechange = (e) => {
					if (e.port.type === "input") {
						if (e.port.state === "connected") {
							attachMidiInput(e.port)
						} else {
							detachMidiInput(e.port)
						}
					}
				}
				midiEnabled = true
				return true
			} catch (err) {
				console.warn("MIDI access denied:", err)
				return false
			}
		},

		disableMidi() {
			if (midiAccess) {
				midiAccess.onstatechange = null
				for (const input of midiAccess.inputs.values()) {
					detachMidiInput(input)
				}
			}
			midiEnabled = false
		},

		/**
		 * Bind a receive symbol to a callback. Returns an unbind function.
		 * Callback receives (value) for float, no args for bang, (string) for symbol.
		 */
		bind(symbol, callback) {
			if (!bindings.has(symbol)) {
				bindings.set(symbol, new Set())
				// Bind in libpd if running (new API only)
				if (mod && hasNewApi) {
					const ptr = mod.ccall("empd_bind", "number", ["string"], [symbol])
					bindPtrs.set(symbol, ptr)
				}
			}
			bindings.get(symbol).add(callback)

			return () => {
				const cbs = bindings.get(symbol)
				if (cbs) {
					cbs.delete(callback)
					if (cbs.size === 0) {
						bindings.delete(symbol)
						const ptr = bindPtrs.get(symbol)
						if (ptr && mod && hasNewApi) {
							try { mod.ccall("empd_unbind", null, ["number"], [ptr]) } catch {}
						}
						bindPtrs.delete(symbol)
					}
				}
			}
		},

		unbindAll() {
			if (hasNewApi) {
				for (const [sym, ptr] of bindPtrs) {
					if (mod) {
						try { mod.ccall("empd_unbind", null, ["number"], [ptr]) } catch {}
					}
				}
			}
			bindPtrs.clear()
			bindings.clear()
		},

		async play(pdContent, extraFiles = {}) {
			if (isPlaying) this.stop()

			mod = await loadEmpd()
			if (!mod) {
				console.warn("Audio playback not available — empd could not be loaded")
				return false
			}

			// Detect whether the WASM has the new API (empd_bind, empd_get_dollar_zero, etc.)
			hasNewApi = typeof mod._empd_bind === "function"
			hasMidiApi = typeof mod._empd_noteon === "function"

			// PD print hook
			mod._empdPrint = (msg) => {
				if (debugEnabled("puredata:empd")) console.log("[puredata:empd]", msg)
			}

			// Set up receive callbacks on the module (works even with old WASM —
			// the hooks just won't fire unless the C side sets them)
			mod._onBang = (name) => {
				const cbs = bindings.get(name)
				if (cbs) cbs.forEach(cb => cb({ type: "bang" }))
			}
			mod._onFloat = (name, val) => {
				const cbs = bindings.get(name)
				if (cbs) cbs.forEach(cb => cb({ type: "float", value: val }))
			}
			mod._onSymbol = (name, sym) => {
				const cbs = bindings.get(name)
				if (cbs) cbs.forEach(cb => cb({ type: "symbol", value: sym }))
			}

			try {
				audioContext = new AudioContext()
				const sr = audioContext.sampleRate
				const inChannels = micEnabled ? 1 : 0

				// Old API: empd_init(sr)  New API: empd_init(sr, inChannels)
				if (hasNewApi) {
					mod.ccall("empd_init", "number", ["number", "number"], [sr, inChannels])
				} else {
					mod.ccall("empd_init", "number", ["number"], [sr])
				}
				mod.FS.writeFile("/patch.pd", pdContent)

				// Write extra files (abstractions) to the virtual FS
				for (const [filename, content] of Object.entries(extraFiles)) {
					mod.FS.writeFile("/" + filename, content)
				}

				const result = mod.ccall(
					"empd_open_patch", "number",
					["string", "string"],
					["patch.pd", "/"]
				)

				if (result !== 0) {
					console.warn("empd: failed to open patch")
					audioContext.close()
					audioContext = null
					return false
				}

				// Bind any pending symbols (new API only)
				if (hasNewApi) {
					for (const [sym] of bindings) {
						if (!bindPtrs.has(sym)) {
							const ptr = mod.ccall("empd_bind", "number", ["string"], [sym])
							bindPtrs.set(sym, ptr)
						}
					}
				}

				const blockSize = mod.ccall("empd_get_block_size", "number", [], [])

				// Connect mic if enabled
				if (micEnabled && micStream) {
					micSource = audioContext.createMediaStreamSource(micStream)
				}

				// Wrap the process call to handle old vs new API
				// Old API: empd_process(output, frames)
				// New API: empd_process(input, output, frames, inChannels)
				const processFunc = hasNewApi
					? (outPtr, frames, inPtr) => {
						mod.ccall("empd_process", null,
							["number", "number", "number", "number"],
							[micEnabled ? inPtr : 0, outPtr, frames, micEnabled ? 1 : 0]
						)
					}
					: (outPtr, frames) => {
						mod.ccall("empd_process", null, ["number", "number"], [outPtr, frames])
					}

				// Try AudioWorklet with SharedArrayBuffer
				if (typeof SharedArrayBuffer !== "undefined" && audioContext.audioWorklet) {
					const ringFrames = 16384
					const ringBuffer = new SharedArrayBuffer(ringFrames * 2 * 4)
					const ring = new Float32Array(ringBuffer)
					// Shared positions: [0]=writePos (main→worklet), [1]=readPos (worklet→main)
					const positionsBuf = new SharedArrayBuffer(2 * 4)
					const positions = new Int32Array(positionsBuf)

					let inputRingBuffer = null
					let inputRing = null
					const inputRingFrames = 16384
					if (micEnabled && hasNewApi) {
						inputRingBuffer = new SharedArrayBuffer(inputRingFrames * 4)
						inputRing = new Float32Array(inputRingBuffer)
					}

					if (!workletBlobUrl) {
						const blob = new Blob([WORKLET_SRC], { type: "application/javascript" })
						workletBlobUrl = URL.createObjectURL(blob)
					}
					await audioContext.audioWorklet.addModule(workletBlobUrl)

					audioNode = new AudioWorkletNode(audioContext, "empd-processor", {
						outputChannelCount: [2],
						numberOfInputs: (micEnabled && hasNewApi) ? 1 : 0,
						processorOptions: { ringBuffer, ringFrames, positions: positionsBuf, inputRingBuffer, inputRingFrames },
					})
					audioNode.connect(audioContext.destination)

					if (micSource && hasNewApi) {
						micSource.connect(audioNode)
					}

					const fillChunk = 512
					const outBytes = fillChunk * 2 * 4
					bufPtr = mod._malloc(outBytes)
					if (micEnabled && hasNewApi) {
						inBufPtr = mod._malloc(fillChunk * 4)
					}
					let writePos = 0
					let inputReadPos = 0

					// Target: keep ~4096 frames buffered ahead
					const targetAhead = 4096

					function fillRing() {
						const readPos = Atomics.load(positions, 1)
						// How many frames are buffered (not yet consumed)?
						let buffered = writePos - readPos
						if (buffered < 0) buffered += ringFrames

						// Fill until we're targetAhead frames ahead, but don't overfill
						while (buffered < targetAhead) {
							// Read mic input
							if (micEnabled && hasNewApi && inputRing && inBufPtr) {
								const inOffset = inBufPtr >> 2
								for (let i = 0; i < fillChunk; i++) {
									mod.HEAPF32[inOffset + i] = inputRing[(inputReadPos + i) % inputRingFrames]
								}
								inputReadPos = (inputReadPos + fillChunk) % inputRingFrames
							}

							processFunc(bufPtr, fillChunk, inBufPtr)
							const offset = bufPtr >> 2
							const heap = mod.HEAPF32
							for (let i = 0; i < fillChunk; i++) {
								const wi = ((writePos + i) % ringFrames) * 2
								ring[wi] = heap[offset + i * 2]
								ring[wi + 1] = heap[offset + i * 2 + 1]
							}
							writePos = (writePos + fillChunk) % ringFrames
							buffered += fillChunk
						}
						Atomics.store(positions, 0, writePos)
					}

					// Initial fill
					fillRing()

					// Poll at ~5ms to keep buffer topped up
					fillInterval = setInterval(fillRing, 5)
				} else {
					// Fallback: ScriptProcessorNode
					const bufferSize = Math.max(1024, blockSize * 2)
					audioNode = audioContext.createScriptProcessor(bufferSize, (micEnabled && hasNewApi) ? 1 : 0, 2)
					bufPtr = mod._malloc(bufferSize * 2 * 4)
					if (micEnabled && hasNewApi) {
						inBufPtr = mod._malloc(bufferSize * 4)
					}

					audioNode.onaudioprocess = (e) => {
						const outL = e.outputBuffer.getChannelData(0)
						const outR = e.outputBuffer.getChannelData(1)
						const frames = outL.length

						// Copy mic input
						if (micEnabled && hasNewApi && e.inputBuffer.numberOfChannels > 0 && inBufPtr) {
							const inData = e.inputBuffer.getChannelData(0)
							const inOffset = inBufPtr >> 2
							for (let i = 0; i < frames; i++) {
								mod.HEAPF32[inOffset + i] = inData[i]
							}
						}

						processFunc(bufPtr, frames, inBufPtr)
						const offset = bufPtr >> 2
						const heap = mod.HEAPF32
						for (let i = 0; i < frames; i++) {
							outL[i] = heap[offset + i * 2]
							outR[i] = heap[offset + i * 2 + 1]
						}
					}

					if (micSource && hasNewApi) {
						micSource.connect(audioNode)
					}
					audioNode.connect(audioContext.destination)
				}

				isPlaying = true
				onStatusChange?.()
				return true
			} catch (err) {
				console.warn("empd playback error:", err)
				if (audioContext) {
					audioContext.close()
					audioContext = null
				}
				return false
			}
		},

		stop() {
			if (fillInterval) {
				clearInterval(fillInterval)
				fillInterval = null
			}
			if (micSource) {
				try { micSource.disconnect() } catch {}
				micSource = null
			}
			if (audioNode) {
				try { audioNode.disconnect() } catch {}
				audioNode = null
			}
			if (bufPtr && mod) {
				try { mod._free(bufPtr) } catch {}
				bufPtr = 0
			}
			if (inBufPtr && mod) {
				try { mod._free(inBufPtr) } catch {}
				inBufPtr = 0
			}
			// Unbind all receive symbols (new API only)
			if (hasNewApi) {
				for (const [sym, ptr] of bindPtrs) {
					if (mod) {
						try { mod.ccall("empd_unbind", null, ["number"], [ptr]) } catch {}
					}
				}
			}
			bindPtrs.clear()
			if (mod) {
				try { mod.ccall("empd_close_patch", null, [], []) } catch {}
			}
			if (audioContext) {
				audioContext.close()
				audioContext = null
			}
			// Reset module cache so next play gets a fresh WASM instance
			// (avoids stale internal state in libpd/ELSE after close)
			mod = null
			empdModule = null
			loadPromise = null
			isPlaying = false
			onStatusChange?.()
		},

		destroy() {
			this.stop()
			this.disableMic()
			this.disableMidi()
			bindings.clear()
		},

		sendFloat(recv, val) {
			if (!mod) return
			const ret = mod.ccall("empd_send_float", "number", ["string", "number"], [recv, val])
			console.log(`[sendFloat] recv="${recv}" val=${val} ret=${ret}`)
		},

		sendBang(recv) {
			if (!mod) return
			mod.ccall("empd_send_bang", "number", ["string"], [recv])
		},

		sendSymbol(recv, sym) {
			if (!mod || !hasNewApi) return
			mod.ccall("empd_send_symbol", "number", ["string", "string"], [recv, sym])
		},

		sendList(recv, items) {
			if (!mod || !hasNewApi) return
			mod.ccall("empd_start_message", "number", ["number"], [items.length])
			for (const item of items) {
				if (typeof item === "number") {
					mod.ccall("empd_add_float", null, ["number"], [item])
				} else {
					mod.ccall("empd_add_symbol", null, ["string"], [String(item)])
				}
			}
			mod.ccall("empd_finish_list", "number", ["string"], [recv])
		},

		sendMessage(recv, msg, items) {
			if (!mod || !hasNewApi) return
			mod.ccall("empd_start_message", "number", ["number"], [items.length])
			for (const item of items) {
				if (typeof item === "number") {
					mod.ccall("empd_add_float", null, ["number"], [item])
				} else {
					mod.ccall("empd_add_symbol", null, ["string"], [String(item)])
				}
			}
			mod.ccall("empd_finish_message", "number", ["string", "string"], [recv, msg])
		},

		noteOn(channel, pitch, velocity) {
			if (!mod || !hasMidiApi) return
			mod.ccall("empd_noteon", "number", ["number", "number", "number"], [channel, pitch, velocity])
		},

		getDollarZero() {
			if (!mod || !hasNewApi) return 0
			return mod.ccall("empd_get_dollar_zero", "number", [], [])
		},

		arraySize(name) {
			if (!mod || !hasNewApi) return -1
			return mod.ccall("empd_array_size", "number", ["string"], [name])
		},

		readArray(name, offset = 0, n = -1) {
			if (!mod || !hasNewApi) return null
			if (n < 0) {
				n = this.arraySize(name)
				if (n <= 0) return null
			}
			const ptr = mod._malloc(n * 4)
			const result = mod.ccall("empd_read_array", "number",
				["number", "string", "number", "number"],
				[ptr, name, offset, n]
			)
			if (result !== 0) {
				mod._free(ptr)
				return null
			}
			const data = new Float32Array(n)
			data.set(mod.HEAPF32.subarray(ptr >> 2, (ptr >> 2) + n))
			mod._free(ptr)
			return data
		},

		writeArray(name, data, offset = 0) {
			if (!mod || !hasNewApi) return false
			const n = data.length
			const ptr = mod._malloc(n * 4)
			mod.HEAPF32.set(data, ptr >> 2)
			const result = mod.ccall("empd_write_array", "number",
				["string", "number", "number", "number"],
				[name, offset, ptr, n]
			)
			mod._free(ptr)
			return result === 0
		},

		resizeArray(name, size) {
			if (!mod || !hasNewApi) return false
			return mod.ccall("empd_resize_array", "number",
				["string", "number"], [name, size]) === 0
		},
	}
}
