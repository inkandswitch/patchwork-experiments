import {
	createContext,
	useContext,
	createSignal,
	onMount,
	type ParentComponent,
	type Accessor,
	type Setter,
} from "solid-js"

interface ThemeContextValue {
	themeColor: Accessor<string>
	setThemeColor: (color: string) => void
	isLightBg: Accessor<boolean>
	fontSize: Accessor<number>
	setFontSize: (size: number) => void
}

const ThemeCtx = createContext<ThemeContextValue>()

export const ThemeProvider: ParentComponent<{rootEl: HTMLElement}> = (props) => {
	const [themeColor, setThemeColorSignal] = createSignal("oklch(0.55 0.18 270)")
	const [isLightBg, setIsLightBg] = createSignal(false)
	const [fontSize, setFontSizeSignal] = createSignal(15)

	function applyTheme(color: string) {
		const root = props.rootEl
		root.style.setProperty("--theme", color)

		const m = color.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/)
		const L = m ? parseFloat(m[1]) : 0.55
		const C = m ? parseFloat(m[2]) : 0.18
		const H = m ? parseFloat(m[3]) : 270

		const t = Math.max(0, Math.min(1, (L - 0.3) / 0.4))
		const lerp = (a: number, b: number) => a + (b - a) * t
		const sc = C * 0.3
		const set = (k: string, v: string) => root.style.setProperty(k, v)
		const oklch = (l: number, c: number, h: number) =>
			`oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h})`

		set("--bg-darkest", oklch(lerp(0.08, 1.0), sc, H))
		set("--bg-dark", oklch(lerp(0.11, 0.98), sc, H))
		set("--bg-mid", oklch(lerp(0.15, 0.95), sc, H))
		set("--bg-hover", oklch(lerp(0.18, 0.92), sc, H))
		set("--bg-input", oklch(lerp(0.13, 1.0), sc, H))
		set("--border", oklch(lerp(0.25, 0.85), sc * 1.3, H))

		const bgL = lerp(0.11, 0.98)
		const lightBg = bgL > 0.55
		setIsLightBg(lightBg)
		const textL = lightBg ? 0 : 1
		set("--text-primary", `oklch(${textL} 0 0)`)
		set("--text-secondary", `oklch(${textL} 0 0 / 0.6)`)
		set("--text-muted", `oklch(${textL} 0 0 / 0.4)`)

		const linkL = lightBg ? 0.45 : 0.78
		const linkC = Math.max(C, 0.12)
		set("--link", oklch(linkL, linkC, H))

		const darkBg = L < 0.32
		if (C < 0.04) {
			const accentL = darkBg || t < 0.5 ? 0.75 : 0.25
			set("--accent", oklch(accentL, 0, H))
			set("--accent-hover", oklch(accentL + (accentL > 0.5 ? -0.1 : 0.1), 0, H))
			set("--accent-fg", oklch(accentL > 0.5 ? 0.1 : 0.95, 0, 0))
		} else if (darkBg) {
			set("--accent", oklch(Math.max(L + 0.35, 0.55), C, H))
			set("--accent-hover", oklch(Math.max(L + 0.45, 0.65), C, H))
			set("--accent-fg", oklch(0.1, 0, 0))
		} else {
			set("--accent", color)
			set("--accent-hover", oklch(L + (t > 0.5 ? -0.1 : 0.1), C, H))
			set("--accent-fg", oklch(L > 0.6 ? 0.1 : 0.97, 0, 0))
		}
		set("--accent-soft", `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H} / 0.15)`)

		try {
			localStorage.setItem("chat-theme-color", color)
		} catch (e) {}
	}

	function setThemeColor(color: string) {
		setThemeColorSignal(color)
		applyTheme(color)
	}

	function setFontSize(size: number) {
		setFontSizeSignal(size)
		props.rootEl.style.fontSize = size + "px"
		try {
			localStorage.setItem("chat-font-size", String(size))
		} catch (e) {}
	}

	onMount(() => {
		try {
			const saved = localStorage.getItem("chat-theme-color")
			if (saved) {
				setThemeColorSignal(saved)
				applyTheme(saved)
			} else {
				applyTheme(themeColor())
			}
		} catch (e) {
			applyTheme(themeColor())
		}

		try {
			const savedSize = localStorage.getItem("chat-font-size")
			if (savedSize) {
				const s = parseInt(savedSize, 10) || 15
				setFontSizeSignal(s)
				if (s !== 15) props.rootEl.style.fontSize = s + "px"
			}
		} catch (e) {}
	})

	return (
		<ThemeCtx.Provider
			value={{themeColor, setThemeColor, isLightBg, fontSize, setFontSize}}
		>
			{props.children}
		</ThemeCtx.Provider>
	)
}

export function useTheme(): ThemeContextValue {
	const ctx = useContext(ThemeCtx)
	if (!ctx) throw new Error("useTheme must be used within ThemeProvider")
	return ctx
}
