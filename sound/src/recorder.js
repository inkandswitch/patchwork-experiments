/**
 * Recorder — Audio recording and playback tool for Patchwork.
 *
 * State machine:
 *   doc.audio === "" → Red screen. Click to record. Cyan waveform while recording.
 *   doc.audio !== "" → Black screen. Click to play. Cyan waveform while playing.
 */

const STYLES = `
  .recorder-root {
    width: 100%;
    height: 100%;
    background: #c0392b;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    position: relative;
  }
  .recorder-root.playback {
    background: #000;
  }
  .recorder-root.active {
    background: #000;
  }
  .recorder-root.recording {
    background: #c0392b;
  }

  .recorder-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: none;
  }
  .recorder-root.active .recorder-canvas {
    display: block;
  }

  .recorder-device-btn {
    position: absolute;
    top: 12px;
    right: 12px;
    background: rgba(0,0,0,0.4);
    border: none;
    color: #fff;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1;
  }
  .recorder-device-btn:hover {
    background: rgba(0,0,0,0.6);
  }
  .recorder-device-btn svg {
    width: 18px;
    height: 18px;
  }

  .recorder-device-menu {
    position: absolute;
    top: 48px;
    right: 12px;
    background: #222;
    border: 1px solid #444;
    border-radius: 8px;
    padding: 4px 0;
    z-index: 2;
    min-width: 180px;
    display: none;
  }
  .recorder-device-menu.open {
    display: block;
  }
  .recorder-device-menu button {
    display: block;
    width: 100%;
    background: none;
    border: none;
    color: #e8e8e8;
    padding: 8px 12px;
    text-align: left;
    font-size: 13px;
    cursor: pointer;
    font-family: inherit;
  }
  .recorder-device-menu button:hover {
    background: #333;
  }
  .recorder-device-menu button.selected {
    color: #0ff;
  }

  .recorder-spinner-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #111;
    z-index: 3;
  }
  .recorder-spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #333;
    border-top-color: #0ff;
    border-radius: 50%;
    animation: recorder-spin 0.8s linear infinite;
  }
  @keyframes recorder-spin {
    to { transform: rotate(360deg); }
  }
`

const MIC_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`

async function encodeFlac(channelData, sampleRate) {
	if (typeof AudioEncoder === "undefined") return null

	try {
		const support = await AudioEncoder.isConfigSupported({
			codec: "flac",
			sampleRate,
			numberOfChannels: 1,
		})
		if (!support.supported) return null
	} catch {
		return null
	}

	const chunks = []

	const encoder = new AudioEncoder({
		output(chunk) {
			const buf = new ArrayBuffer(chunk.byteLength)
			chunk.copyTo(buf)
			chunks.push(new Uint8Array(buf))
		},
		error(e) {
			console.error("FLAC encode error:", e)
		},
	})

	encoder.configure({codec: "flac", sampleRate, numberOfChannels: 1})

	const frameSize = Math.floor(sampleRate * 0.5)
	for (let offset = 0; offset < channelData.length; offset += frameSize) {
		const end = Math.min(offset + frameSize, channelData.length)
		const frameData = new Float32Array(end - offset)
		frameData.set(channelData.subarray(offset, end))

		const audioData = new AudioData({
			format: "f32-planar",
			sampleRate,
			numberOfFrames: frameData.length,
			numberOfChannels: 1,
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
	for (const c of chunks) {
		bytes.set(c, pos)
		pos += c.length
	}

	return {bytes, mimeType: "audio/flac", extension: "flac"}
}

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

	return {
		bytes: new Uint8Array(buffer),
		mimeType: "audio/wav",
		extension: "wav",
	}
}

export default function RecorderTool(handle, element) {
	const style = document.createElement("style")
	style.textContent = STYLES
	element.appendChild(style)

	const root = document.createElement("div")
	root.className = "recorder-root"
	element.appendChild(root)

	let cleanup = () => {}

	function render() {
		cleanup()
		root.innerHTML = ""
		const doc = handle.doc()

		if (doc.audio) {
			root.classList.add("playback")
			cleanup = renderPlayback(root, handle)
		} else {
			root.classList.remove("playback")
			cleanup = renderRecording(root, handle)
		}
	}

	render()
	const onChange = () => render()
	handle.on("change", onChange)

	return () => {
		cleanup()
		handle.off("change", onChange)
		style.remove()
		root.remove()
	}
}

// ─── Recording mode ───

function renderRecording(root, handle) {
	let stream = null
	let audioContext = null
	let analyser = null
	let animFrame = null
	let isRecording = false
	let allChunks = []
	let sampleRate = 48000
	let destroyed = false
	let selectedDeviceId = ""
	let menuOpen = false

	const canvas = document.createElement("canvas")
	canvas.className = "recorder-canvas"
	root.appendChild(canvas)
	const ctx = canvas.getContext("2d")

	// Device picker button
	const deviceBtn = document.createElement("button")
	deviceBtn.className = "recorder-device-btn"
	deviceBtn.innerHTML = MIC_SVG
	root.appendChild(deviceBtn)

	const deviceMenu = document.createElement("div")
	deviceMenu.className = "recorder-device-menu"
	root.appendChild(deviceMenu)

	deviceBtn.addEventListener("click", e => {
		e.stopPropagation()
		menuOpen = !menuOpen
		deviceMenu.classList.toggle("open", menuOpen)
		if (menuOpen) populateDevices()
	})

	async function populateDevices() {
		// Request permission first so labels are available
		try {
			const tempStream = await navigator.mediaDevices.getUserMedia({
				audio: true,
			})
			for (const track of tempStream.getTracks()) track.stop()
		} catch {
			/* ignore */
		}

		const devices = await navigator.mediaDevices.enumerateDevices()
		const inputs = devices.filter(d => d.kind === "audioinput")
		deviceMenu.innerHTML = ""
		for (const device of inputs) {
			const btn = document.createElement("button")
			btn.textContent =
				device.label || `Microphone ${inputs.indexOf(device) + 1}`
			if (device.deviceId === selectedDeviceId) btn.classList.add("selected")
			btn.addEventListener("click", e => {
				e.stopPropagation()
				selectedDeviceId = device.deviceId
				menuOpen = false
				deviceMenu.classList.remove("open")
			})
			deviceMenu.appendChild(btn)
		}
	}

	function drawWaveform() {
		if (!analyser || destroyed) return
		animFrame = requestAnimationFrame(drawWaveform)

		const w = (canvas.width = canvas.clientWidth * devicePixelRatio)
		const h = (canvas.height = canvas.clientHeight * devicePixelRatio)

		const bufLen = analyser.frequencyBinCount
		const dataArray = new Uint8Array(bufLen)
		analyser.getByteTimeDomainData(dataArray)

		ctx.clearRect(0, 0, w, h)
		ctx.lineWidth = 2 * devicePixelRatio
		ctx.strokeStyle = "#fff"
		ctx.beginPath()

		const sliceWidth = w / bufLen
		let x = 0
		for (let i = 0; i < bufLen; i++) {
			const v = dataArray[i] / 128.0
			const y = (v * h) / 2
			if (i === 0) ctx.moveTo(x, y)
			else ctx.lineTo(x, y)
			x += sliceWidth
		}
		ctx.lineTo(w, h / 2)
		ctx.stroke()
	}

	async function startRecording() {
		const audioConstraints = {
			echoCancellation: false,
			noiseSuppression: false,
			autoGainControl: false,
			sampleRate: 48000,
			channelCount: 1,
		}
		if (selectedDeviceId) audioConstraints.deviceId = {exact: selectedDeviceId}

		try {
			stream = await navigator.mediaDevices.getUserMedia({
				audio: audioConstraints,
			})
		} catch {
			return
		}

		audioContext = new AudioContext({sampleRate: 48000})
		sampleRate = audioContext.sampleRate
		const source = audioContext.createMediaStreamSource(stream)
		analyser = audioContext.createAnalyser()
		analyser.fftSize = 8192
		source.connect(analyser)

		const processor = audioContext.createScriptProcessor(4096, 1, 1)
		allChunks = []
		processor.onaudioprocess = e => {
			allChunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
		}
		source.connect(processor)
		processor.connect(audioContext.destination)

		isRecording = true
		root.classList.add("active", "recording")
		drawWaveform()
	}

	async function stopRecording() {
		isRecording = false
		root.classList.remove("recording")
		if (animFrame) cancelAnimationFrame(animFrame)

		if (stream) {
			for (const track of stream.getTracks()) track.stop()
			stream = null
		}
		if (audioContext) {
			await audioContext.close()
			audioContext = null
			analyser = null
		}

		// Spinner
		const overlay = document.createElement("div")
		overlay.className = "recorder-spinner-overlay"
		overlay.innerHTML = '<div class="recorder-spinner"></div>'
		root.appendChild(overlay)

		const totalLength = allChunks.reduce((sum, c) => sum + c.length, 0)
		const pcmData = new Float32Array(totalLength)
		let offset = 0
		for (const chunk of allChunks) {
			pcmData.set(chunk, offset)
			offset += chunk.length
		}
		allChunks = []

		let encoded = await encodeFlac(pcmData, sampleRate)
		if (!encoded) encoded = encodeWav(pcmData, sampleRate)

		const {bytes, mimeType, extension} = encoded
		const newHandle = await repo.create2({
			content: bytes,
			extension,
			mimeType,
			name: `recording.${extension}`,
		})

		handle.change(doc => {
			doc.audio = newHandle.url
		})
	}

	root.addEventListener("click", () => {
		if (destroyed || menuOpen) return
		if (isRecording) stopRecording()
		else startRecording()
	})

	return () => {
		destroyed = true
		if (animFrame) cancelAnimationFrame(animFrame)
		if (stream) for (const track of stream.getTracks()) track.stop()
		if (audioContext && audioContext.state !== "closed") audioContext.close()
	}
}

// ─── Playback mode ───

const WORKLET_SRC = `
class VinylProcessor extends AudioWorkletProcessor {
	constructor() {
		super()
		this.samples = null
		this.playhead = 0
		this.rate = 1.0
		this.playing = false
		this.paused = false
		this.looping = false
		this.port.onmessage = (e) => {
			const d = e.data
			if (d.type === "load") {
				this.samples = d.samples
				this.playhead = 0
				this.playing = true
				this.paused = false
			} else if (d.type === "rate") {
				this.rate = d.rate
			} else if (d.type === "loop") {
				this.looping = d.looping
			} else if (d.type === "pause") {
				this.paused = true
			} else if (d.type === "resume") {
				this.paused = false
			} else if (d.type === "restart") {
				this.playhead = 0
				this.paused = false
			} else if (d.type === "stop") {
				this.playing = false
			}
		}
	}
	process(inputs, outputs) {
		const output = outputs[0][0]
		if (!output) return true
		if (!this.playing || !this.samples || this.paused) {
			output.fill(0)
			return true
		}
		const len = this.samples.length
		for (let i = 0; i < output.length; i++) {
			if (this.looping) {
				if (this.playhead >= len) this.playhead -= len
				if (this.playhead < 0) this.playhead += len
			} else if (this.playhead >= len || this.playhead < 0) {
				output.fill(0, i)
				this.playing = false
				this.port.postMessage({type: "ended"})
				return true
			}
			const idx = Math.floor(this.playhead)
			output[i] = this.samples[idx] || 0
			this.playhead += this.rate
		}
		return true
	}
}
registerProcessor("vinyl-processor", VinylProcessor)
`

function renderPlayback(root, handle) {
	const doc = handle.doc()
	let audioContext = null
	let vinylNode = null
	let analyser = null
	let decodedSamples = null
	let playing = false
	let paused = false
	let animFrame = null
	let destroyed = false
	let rawArrayBuf = null
	let starting = false
	let clickTimer = null

	let dragging = false
	let didDrag = false
	let dragStartX = 0

	const canvas = document.createElement("canvas")
	canvas.className = "recorder-canvas"
	root.appendChild(canvas)
	const ctx = canvas.getContext("2d")

	function drawWaveform() {
		if (!analyser || destroyed) return
		animFrame = requestAnimationFrame(drawWaveform)

		const w = (canvas.width = canvas.clientWidth * devicePixelRatio)
		const h = (canvas.height = canvas.clientHeight * devicePixelRatio)

		const bufLen = analyser.frequencyBinCount
		const dataArray = new Uint8Array(bufLen)
		analyser.getByteTimeDomainData(dataArray)

		ctx.clearRect(0, 0, w, h)
		ctx.lineWidth = 2 * devicePixelRatio
		ctx.strokeStyle = "#0ff"
		ctx.beginPath()

		const sliceWidth = w / bufLen
		let x = 0
		for (let i = 0; i < bufLen; i++) {
			const v = dataArray[i] / 128.0
			const y = (v * h) / 2
			if (i === 0) ctx.moveTo(x, y)
			else ctx.lineTo(x, y)
			x += sliceWidth
		}
		ctx.lineTo(w, h / 2)
		ctx.stroke()
	}

	// Pre-load the raw audio bytes (no AudioContext needed)
	;(async () => {
		try {
			const fileHandle = await repo.find(doc.audio)
			const fileDoc = fileHandle.doc()
			const blob = new Blob([fileDoc.content], {
				type: fileDoc.mimeType || "audio/wav",
			})
			rawArrayBuf = await blob.arrayBuffer()
		} catch {
			/* ignore */
		}
	})()

	async function ensureAudioReady() {
		if (!audioContext) {
			audioContext = new AudioContext()
			analyser = audioContext.createAnalyser()
			analyser.fftSize = 8192
			const blob = new Blob([WORKLET_SRC], {type: "application/javascript"})
			const url = URL.createObjectURL(blob)
			await audioContext.audioWorklet.addModule(url)
			URL.revokeObjectURL(url)
		}
		if (audioContext.state === "suspended") await audioContext.resume()
		if (!decodedSamples) {
			const audioBuffer = await audioContext.decodeAudioData(
				rawArrayBuf.slice(0)
			)
			decodedSamples = new Float32Array(audioBuffer.getChannelData(0))
		}
	}

	async function play() {
		if (!rawArrayBuf || starting) return
		if (paused && vinylNode) {
			// Resume from where we paused
			paused = false
			playing = true
			vinylNode.port.postMessage({type: "resume"})
			root.classList.add("active")
			drawWaveform()
			return
		}
		if (playing) return
		starting = true

		await ensureAudioReady()

		vinylNode = new AudioWorkletNode(audioContext, "vinyl-processor", {
			outputChannelCount: [1],
		})
		vinylNode.port.onmessage = e => {
			if (e.data.type === "ended") {
				playing = false
				paused = false
				root.classList.remove("active")
				if (animFrame) cancelAnimationFrame(animFrame)
			}
		}

		const samplesCopy = new Float32Array(decodedSamples)
		vinylNode.port.postMessage(
			{type: "load", samples: samplesCopy},
			[samplesCopy.buffer]
		)

		vinylNode.connect(analyser)
		analyser.connect(audioContext.destination)

		playing = true
		paused = false
		starting = false
		root.classList.add("active")
		drawWaveform()
	}

	function pause() {
		if (!playing || !vinylNode) return
		paused = true
		playing = false
		vinylNode.port.postMessage({type: "pause"})
		root.classList.remove("active")
		if (animFrame) cancelAnimationFrame(animFrame)
	}

	function restart() {
		if (vinylNode) {
			vinylNode.port.postMessage({type: "restart"})
			if (paused || !playing) {
				paused = false
				playing = true
				root.classList.add("active")
				drawWaveform()
			}
		} else {
			play()
		}
	}

	function teardown() {
		playing = false
		paused = false
		root.classList.remove("active")
		if (animFrame) cancelAnimationFrame(animFrame)
		if (vinylNode) {
			vinylNode.port.postMessage({type: "stop"})
			vinylNode.disconnect()
			vinylNode = null
		}
	}

	// ─── Pointer interaction ───

	root.addEventListener("mousedown", e => {
		if (destroyed || !rawArrayBuf) return
		dragging = true
		didDrag = false
		dragStartX = e.clientX
	})

	function startScratch() {
		if (!playing && !paused && !starting) play()
		if (vinylNode) vinylNode.port.postMessage({type: "loop", looping: true})
		if (paused && vinylNode) {
			paused = false
			playing = true
			vinylNode.port.postMessage({type: "resume"})
			root.classList.add("active")
			drawWaveform()
		}
		handle.broadcast({type: "sound:playback", action: "scratch-start"})
	}

	function scratchRate(dx) {
		if (!vinylNode) return
		const sensitivity = 200
		const rate = (dx / sensitivity) * 4
		const clamped = Math.abs(rate) < 0.1 ? 0 : rate
		vinylNode.port.postMessage({type: "rate", rate: clamped})
		handle.broadcast({type: "sound:playback", action: "scratch-rate", rate: clamped})
	}

	function endScratch() {
		if (vinylNode) {
			vinylNode.port.postMessage({type: "loop", looping: false})
			vinylNode.port.postMessage({type: "rate", rate: 1.0})
		}
		handle.broadcast({type: "sound:playback", action: "scratch-end"})
	}

	root.addEventListener("mousemove", e => {
		if (!dragging) return
		const dx = e.clientX - dragStartX
		if (!didDrag && Math.abs(dx) > 3) {
			didDrag = true
			startScratch()
		}
		if (!didDrag) return
		scratchRate(dx)
	})

	function onPointerUp() {
		if (!dragging) return
		dragging = false
		if (didDrag) endScratch()
	}

	document.addEventListener("mouseup", onPointerUp)

	// Use a click timer to distinguish single-click from double-click
	root.addEventListener("click", e => {
		if (didDrag) return
		if (clickTimer) {
			// Second click arrived — it's a double-click
			clearTimeout(clickTimer)
			clickTimer = null
			restart()
			handle.broadcast({type: "sound:playback", action: "restart"})
			return
		}
		clickTimer = setTimeout(() => {
			clickTimer = null
			if (playing) {
				pause()
				handle.broadcast({type: "sound:playback", action: "pause"})
			} else {
				play()
				handle.broadcast({type: "sound:playback", action: "play"})
			}
		}, 250)
	})

	root.addEventListener("touchstart", e => {
		if (destroyed || !rawArrayBuf) return
		dragging = true
		didDrag = false
		dragStartX = e.touches[0].clientX
	}, {passive: true})

	root.addEventListener("touchmove", e => {
		if (!dragging) return
		const dx = e.touches[0].clientX - dragStartX
		if (!didDrag && Math.abs(dx) > 3) {
			didDrag = true
			startScratch()
		}
		if (!didDrag) return
		scratchRate(dx)
	}, {passive: true})

	root.addEventListener("touchend", onPointerUp)

	// Sync play state from other peers
	function onEphemeral(payload) {
		const msg = payload.message
		if (!msg || msg.type !== "sound:playback") return
		if (msg.action === "play") {
			if (!playing) play()
		} else if (msg.action === "pause") {
			if (playing) pause()
		} else if (msg.action === "restart") {
			restart()
		} else if (msg.action === "scratch-start") {
			if (!playing && !paused && !starting) play()
			if (vinylNode) vinylNode.port.postMessage({type: "loop", looping: true})
			if (paused && vinylNode) {
				paused = false
				playing = true
				vinylNode.port.postMessage({type: "resume"})
				root.classList.add("active")
				drawWaveform()
			}
		} else if (msg.action === "scratch-rate") {
			if (vinylNode) vinylNode.port.postMessage({type: "rate", rate: msg.rate})
		} else if (msg.action === "scratch-end") {
			if (vinylNode) {
				vinylNode.port.postMessage({type: "loop", looping: false})
				vinylNode.port.postMessage({type: "rate", rate: 1.0})
			}
		}
	}
	handle.on("ephemeral-message", onEphemeral)

	return () => {
		destroyed = true
		handle.off("ephemeral-message", onEphemeral)
		document.removeEventListener("mouseup", onPointerUp)
		if (clickTimer) clearTimeout(clickTimer)
		if (animFrame) cancelAnimationFrame(animFrame)
		if (vinylNode) vinylNode.disconnect()
		if (audioContext && audioContext.state !== "closed") audioContext.close()
	}
}
