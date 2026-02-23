import {createSignal, onMount} from "solid-js"
import {useChatContext} from "./context"
import {THEME_PRESETS, setTheme, parseOklch, getSavedTheme} from "./theme"

export function ThemePopover(props: {onClose: () => void}) {
	const ctx = useChatContext()

	const saved = getSavedTheme() || "oklch(0.55 0.18 270)"
	const initial = parseOklch(saved)

	const [themeH, setThemeH] = createSignal(initial.H)
	const [themeL, setThemeL] = createSignal(initial.L)
	const [themeC, setThemeC] = createSignal(initial.C)

	function updateTheme() {
		if (!ctx.rootRef) return
		setTheme(ctx.rootRef, `oklch(${themeL()} ${themeC()} ${themeH()})`)
	}

	function applyPreset(color: string) {
		const p = parseOklch(color)
		setThemeH(p.H)
		setThemeL(p.L)
		setThemeC(p.C)
		if (ctx.rootRef) setTheme(ctx.rootRef, color)
	}

	return (
		<div
			class="chat-theme-popover show"
			style="position:absolute;top:100%;right:0;margin-top:4px;z-index:50"
			on:click={(e) => e.stopPropagation()}
		>
			<label>Theme Color</label>
			<div class="chat-theme-presets">
				{THEME_PRESETS.map((preset) => (
					<button
						class="chat-theme-preset"
						style={`background:${preset.color}`}
						title={preset.name}
						on:click={() => applyPreset(preset.color)}
					/>
				))}
			</div>

			<label>Hue</label>
			<div class="chat-theme-hue-row">
				<input
					type="range"
					min="0"
					max="360"
					value={themeH()}
					on:input={(e) => {
						setThemeH(parseFloat(e.currentTarget.value))
						updateTheme()
					}}
				/>
				<input
					type="number"
					min="0"
					max="360"
					value={themeH()}
					on:input={(e) => {
						setThemeH(parseFloat(e.currentTarget.value))
						updateTheme()
					}}
				/>
			</div>

			<label>Luminosity</label>
			<div class="chat-theme-hue-row">
				<input
					type="range"
					min="0"
					max="100"
					value={Math.round(themeL() * 100)}
					on:input={(e) => {
						setThemeL(parseFloat(e.currentTarget.value) / 100)
						updateTheme()
					}}
				/>
				<input
					type="number"
					min="0"
					max="100"
					value={Math.round(themeL() * 100)}
					on:input={(e) => {
						setThemeL(parseFloat(e.currentTarget.value) / 100)
						updateTheme()
					}}
				/>
			</div>

			<label>Chroma</label>
			<div class="chat-theme-hue-row">
				<input
					type="range"
					min="0"
					max="40"
					value={Math.round(themeC() * 100)}
					on:input={(e) => {
						setThemeC(parseFloat(e.currentTarget.value) / 100)
						updateTheme()
					}}
				/>
				<input
					type="number"
					min="0"
					max="40"
					value={Math.round(themeC() * 100)}
					on:input={(e) => {
						setThemeC(parseFloat(e.currentTarget.value) / 100)
						updateTheme()
					}}
				/>
			</div>
		</div>
	)
}
