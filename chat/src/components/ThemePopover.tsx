import {createSignal, onMount, For} from "solid-js"
import {useTheme} from "../context/ThemeContext"
import {THEME_PRESETS} from "../lib/theme-presets"

export function ThemePopover(props: {onClose: () => void; anchorRect: DOMRect}) {
	const {themeColor, setThemeColor, fontSize, setFontSize} = useTheme()

	// Parse current theme into L, C, H
	const parseOklch = (color: string) => {
		const m = color.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/)
		return m
			? {L: parseFloat(m[1]), C: parseFloat(m[2]), H: parseFloat(m[3])}
			: {L: 0.55, C: 0.18, H: 270}
	}

	const initial = parseOklch(themeColor())
	const [hue, setHue] = createSignal(initial.H)
	const [lum, setLum] = createSignal(Math.round(initial.L * 100))
	const [chroma, setChroma] = createSignal(Math.round(initial.C * 100))

	function updateFromSliders() {
		const L = lum() / 100
		const C = chroma() / 100
		const H = hue()
		setThemeColor(`oklch(${L} ${C} ${H})`)
	}

	return (
		<div
			class="chat-theme-popover show"
			on:click={(e) => e.stopPropagation()}
			style={{
				position: "fixed",
				top: (props.anchorRect.bottom + 4) + "px",
				right: (window.innerWidth - props.anchorRect.right) + "px",
				"z-index": "200",
			}}
		>
			<label>Theme Color</label>
			<div class="chat-theme-presets">
				<For each={THEME_PRESETS}>
					{(preset) => (
						<button
							class="chat-theme-preset"
							style={{background: preset.color}}
							title={preset.name}
							on:click={() => {
								const p = parseOklch(preset.color)
								setHue(p.H)
								setLum(Math.round(p.L * 100))
								setChroma(Math.round(p.C * 100))
								setThemeColor(preset.color)
							}}
						/>
					)}
				</For>
			</div>

			<label>Hue</label>
			<div class="chat-theme-hue-row">
				<input
					type="range"
					min="0"
					max="360"
					value={hue()}
					on:input={(e) => {
						setHue(parseFloat(e.currentTarget.value))
						updateFromSliders()
					}}
				/>
				<input
					type="number"
					min="0"
					max="360"
					value={hue()}
					on:input={(e) => {
						setHue(parseFloat(e.currentTarget.value))
						updateFromSliders()
					}}
				/>
			</div>

			<label>Luminosity</label>
			<div class="chat-theme-hue-row">
				<input
					type="range"
					min="0"
					max="100"
					value={lum()}
					on:input={(e) => {
						setLum(parseFloat(e.currentTarget.value))
						updateFromSliders()
					}}
				/>
				<input
					type="number"
					min="0"
					max="100"
					value={lum()}
					on:input={(e) => {
						setLum(parseFloat(e.currentTarget.value))
						updateFromSliders()
					}}
				/>
			</div>

			<label>Chroma</label>
			<div class="chat-theme-hue-row">
				<input
					type="range"
					min="0"
					max="40"
					value={chroma()}
					on:input={(e) => {
						setChroma(parseFloat(e.currentTarget.value))
						updateFromSliders()
					}}
				/>
				<input
					type="number"
					min="0"
					max="40"
					value={chroma()}
					on:input={(e) => {
						setChroma(parseFloat(e.currentTarget.value))
						updateFromSliders()
					}}
				/>
			</div>

			<label>Font Size</label>
			<div class="chat-theme-hue-row">
				<input
					type="range"
					min="10"
					max="24"
					value={fontSize()}
					on:input={(e) => setFontSize(parseInt(e.currentTarget.value, 10))}
				/>
				<input
					type="number"
					min="10"
					max="24"
					value={fontSize()}
					on:input={(e) => setFontSize(parseInt(e.currentTarget.value, 10))}
				/>
			</div>
		</div>
	)
}
