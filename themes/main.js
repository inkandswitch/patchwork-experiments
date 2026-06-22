function themePlugin(id, name, cssFile) {
	return {
		type: "patchwork:theme",
		id,
		name,
		style: new URL(cssFile, import.meta.url).href,
		async load() {
			return {}
		},
	}
}

export const plugins = [
	themePlugin("yalla", "Yalla", "./yalla.css"),
	themePlugin("plan9", "Plan 9", "./plan9.css"),
	themePlugin("dracula", "Dracula", "./dracula.css"),
	themePlugin("github-light", "GitHub Light", "./github-light.css"),
	themePlugin("github-dark", "GitHub Dark", "./github-dark.css"),
	themePlugin("solarized-light", "Solarized Light", "./solarized-light.css"),
	themePlugin("solarized-dark", "Solarized Dark", "./solarized-dark.css"),
	themePlugin("monokai", "Monokai", "./monokai.css"),
	themePlugin("nord", "Nord", "./nord.css"),
	themePlugin("gruvbox-light", "Gruvbox Light", "./gruvbox-light.css"),
	themePlugin("gruvbox-dark", "Gruvbox Dark", "./gruvbox-dark.css"),
	themePlugin("catppuccin-latte", "Catppuccin Latte", "./catppuccin-latte.css"),
	themePlugin("catppuccin-mocha", "Catppuccin Mocha", "./catppuccin-mocha.css"),
	themePlugin("one-dark", "One Dark", "./one-dark.css"),
	themePlugin("one-light", "One Light", "./one-light.css"),
	themePlugin("tokyo-night", "Tokyo Night", "./tokyo-night.css"),
	themePlugin("rose-pine", "Rose Pine", "./rose-pine.css"),
	themePlugin("rose-pine-dawn", "Rose Pine Dawn", "./rose-pine-dawn.css"),
	themePlugin("everforest-light", "Everforest Light", "./everforest-light.css"),
	themePlugin("everforest-dark", "Everforest Dark", "./everforest-dark.css"),
	themePlugin("kanagawa", "Kanagawa", "./kanagawa.css"),
	themePlugin("zenburn", "Zenburn", "./zenburn.css"),
	themePlugin("paper", "Paper", "./paper.css"),
	themePlugin("ink", "Ink", "./ink.css"),
	themePlugin("terminal", "Terminal", "./terminal.css"),
	themePlugin("sunset", "Sunset", "./sunset.css"),
	themePlugin("ocean", "Ocean", "./ocean.css"),
	themePlugin("forest", "Forest", "./forest.css"),
	themePlugin("lavender", "Lavender", "./lavender.css"),
	themePlugin("bento", "Bento", "./bento.css"),
	themePlugin("fairyfloss", "Fairyfloss", "./fairyfloss.css"),
]
