export interface ThemePreset {
	name: string
	color: string
}

export const THEME_PRESETS: ThemePreset[] = [
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
