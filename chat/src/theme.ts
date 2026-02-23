import {createSignal} from "solid-js"

export const THEME_PRESETS = [
	{name: "Indigo", color: "oklch(0.55 0.18 270)"},
	{name: "Rose", color: "oklch(0.55 0.18 350)"},
	{name: "Emerald", color: "oklch(0.55 0.18 155)"},
	{name: "Cyan", color: "oklch(0.75 0.30 200)"},
	{name: "Yellow", color: "oklch(0.90 0.35 95)"},
	{name: "Neon Mint", color: "oklch(0.85 0.30 160)"},
	{name: "Purple", color: "oklch(0.50 0.20 300)"},
	{name: "Light Pink", color: "oklch(0.80 0.12 350)"},
	{name: "Light Blue", color: "oklch(0.80 0.10 240)"},
	{name: "Lavender", color: "oklch(0.75 0.14 300)"},
	{name: "Slate", color: "oklch(0.45 0.02 260)"},
	{name: "White", color: "oklch(1.00 0 0)"},
	{name: "Black", color: "oklch(0.15 0 0)"},
]

export const [isLightBg, setIsLightBg] = createSignal(false)

export function setTheme(root: HTMLElement, color: string) {
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
	set("--text-primary", lightBg ? "black" : "white")
	set("--text-secondary", oklch(lightBg ? 0.35 : 0.68, 0, 0))
	set("--text-muted", oklch(lightBg ? 0.5 : 0.5, 0, 0))

	const darkBg = L < 0.32
	if (C < 0.04) {
		const accentL = darkBg || t < 0.5 ? 0.75 : 0.25
		set("--accent", oklch(accentL, 0, H))
		set(
			"--accent-hover",
			oklch(accentL + (accentL > 0.5 ? -0.1 : 0.1), 0, H)
		)
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

export function getSavedTheme(): string | null {
	try {
		return localStorage.getItem("chat-theme-color")
	} catch (e) {
		return null
	}
}

export function parseOklch(color: string): {L: number; C: number; H: number} {
	const m = color.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/)
	return {
		L: m ? parseFloat(m[1]) : 0.55,
		C: m ? parseFloat(m[2]) : 0.18,
		H: m ? parseFloat(m[3]) : 270,
	}
}
