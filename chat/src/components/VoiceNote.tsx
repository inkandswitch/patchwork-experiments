import {createSignal, onCleanup, onMount, Show} from "solid-js"
import type {AutomergeUrl} from "@automerge/automerge-repo"
import {loadAudioUrl} from "../lib/blob-cache"
import {formatDuration} from "../lib/helpers"
import {SVG_ICONS} from "../lib/svg-icons"
import {transcribeVoiceNote, getExistingTranscription} from "../lib/transcription"

export function VoiceNote(props: {voiceUrl: AutomergeUrl; duration: number}) {
	const [playing, setPlaying] = createSignal(false)
	const [audioEl, setAudioEl] = createSignal<HTMLAudioElement | null>(null)
	const [transcription, setTranscription] = createSignal<string | null>(null)

	// Generate random waveform bars
	const bars = Array.from({length: 20}, () => 3 + Math.random() * 18)

	// Load existing transcription and trigger if needed
	onMount(async () => {
		const existing = await getExistingTranscription(props.voiceUrl)
		if (existing) {
			setTranscription(existing)
		} else {
			// Trigger transcription
			transcribeVoiceNote(props.voiceUrl, (text) => {
				setTranscription(text)
			})
		}
	})

	async function togglePlay() {
		let audio = audioEl()
		if (!audio) {
			const url = await loadAudioUrl(props.voiceUrl)
			if (!url) return
			audio = new Audio(url)
			audio.addEventListener("ended", () => setPlaying(false))
			setAudioEl(audio)
		}
		if (playing()) {
			audio.pause()
			setPlaying(false)
		} else {
			audio.play()
			setPlaying(true)
		}
	}

	onCleanup(() => {
		const audio = audioEl()
		if (audio) {
			audio.pause()
			audio.src = ""
		}
	})

	return (
		<div class="chat-voice-note">
			<button
				class="chat-voice-play-btn"
				onClick={togglePlay}
				innerHTML={playing() ? SVG_ICONS.pause : SVG_ICONS.play}
			/>
			<div class="chat-voice-waveform">
				{bars.map((h) => (
					<div
						class="chat-voice-bar"
						style={{height: h + "px"}}
					/>
				))}
			</div>
			<span class="chat-voice-duration">{formatDuration(props.duration)}</span>
			<Show when={transcription()}>
				<div class="chat-voice-transcription">{transcription()}</div>
			</Show>
		</div>
	)
}
