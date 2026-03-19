/**
 * PD file parser — convert between .pd text format and JS object model.
 *
 * PD file format:
 *   #N canvas x y width height name fontSize;
 *   #X obj x y name [params...];
 *   #X msg x y text;
 *   #X floatatom x y width lower upper label_pos label receive send;
 *   #X symbolatom x y width lower upper label_pos label receive send;
 *   #X text x y comment;
 *   #X connect sourceNode sourceOutlet targetNode targetInlet;
 *   GUI objects: bng, tgl, vsl, hsl, vu, cnv, nbx, vradio, hradio
 */

/** Known object inlet/outlet counts: [inlets, outlets] */
const OBJECT_IO = {
	// Math
	"+": [2, 1],
	"-": [2, 1],
	"*": [2, 1],
	"/": [2, 1],
	"%": [2, 1],
	pow: [2, 1],
	log: [2, 1],
	exp: [1, 1],
	abs: [1, 1],
	sqrt: [1, 1],
	max: [2, 1],
	min: [2, 1],
	clip: [3, 1],
	wrap: [1, 1],
	mod: [2, 1],

	// Comparison / logic
	">": [2, 1],
	"<": [2, 1],
	">=": [2, 1],
	"<=": [2, 1],
	"==": [2, 1],
	"!=": [2, 1],
	"&&": [2, 1],
	"||": [2, 1],

	// Routing
	select: [2, 2],
	sel: [2, 2],
	route: [2, 2],
	spigot: [2, 1],
	moses: [2, 2],
	swap: [2, 2],
	change: [1, 1],

	// Time
	delay: [2, 1],
	del: [2, 1],
	metro: [2, 1],
	line: [2, 1],
	timer: [2, 1],
	pipe: [2, 1],

	// Data
	float: [2, 1],
	f: [2, 1],
	int: [2, 1],
	i: [2, 1],
	symbol: [2, 1],
	bang: [1, 1],
	b: [1, 1],
	trigger: [1, 2],
	t: [1, 2],
	pack: [2, 1],
	unpack: [1, 2],
	list: [2, 1],

	// Audio oscillators
	"osc~": [2, 1],
	"phasor~": [2, 1],
	"noise~": [0, 1],
	"tabosc4~": [2, 1],

	// Audio math
	"+~": [2, 1],
	"-~": [2, 1],
	"*~": [2, 1],
	"/~": [2, 1],
	"clip~": [3, 1],
	"wrap~": [1, 1],
	"abs~": [1, 1],
	"sqrt~": [1, 1],
	"pow~": [2, 1],
	"log~": [2, 1],
	"exp~": [1, 1],
	"max~": [2, 1],
	"min~": [2, 1],

	// Audio filters
	"lop~": [2, 1],
	"hip~": [2, 1],
	"bp~": [3, 1],
	"vcf~": [3, 2],
	"bob~": [4, 1],
	"biquad~": [6, 1],
	"rpole~": [2, 1],
	"rzero~": [2, 1],
	"cpole~": [3, 2],
	"czero~": [3, 2],

	// Audio I/O
	"dac~": [2, 0],
	"adc~": [0, 2],

	// Audio control
	"line~": [2, 1],
	"vline~": [3, 1],
	"snapshot~": [1, 1],
	"vsnapshot~": [1, 1],
	"sig~": [1, 1],
	"samplerate~": [0, 1],

	// Audio delay
	"delwrite~": [1, 0],
	"delread~": [1, 1],
	"delread4~": [1, 1],
	"vd~": [1, 1],

	// Audio table
	"tabwrite~": [2, 0],
	"tabread~": [1, 1],
	"tabread4~": [1, 1],
	"tabplay~": [1, 2],
	"tabreceive~": [0, 1],
	"tabsend~": [1, 0],

	// Audio envelope
	"env~": [1, 1],

	// Audio send/receive
	"send~": [1, 0],
	"receive~": [0, 1],
	"throw~": [1, 0],
	"catch~": [0, 1],

	// Control send/receive
	send: [1, 0],
	s: [1, 0],
	receive: [0, 1],
	r: [0, 1],

	// I/O
	inlet: [0, 1],
	"inlet~": [0, 1],
	outlet: [1, 0],
	"outlet~": [1, 0],

	// Arrays / tables
	table: [2, 1],
	array: [2, 1],
	tabread: [2, 1],
	tabwrite: [2, 0],

	// MIDI
	notein: [0, 3],
	noteout: [3, 0],
	ctlin: [0, 3],
	ctlout: [3, 0],
	bendin: [0, 2],
	bendout: [2, 0],
	midiin: [0, 2],
	midiout: [1, 0],
	pgmin: [0, 2],
	pgmout: [2, 0],

	// Misc
	print: [1, 0],
	loadbang: [0, 1],
	random: [2, 1],
	until: [2, 1],
	makefilename: [2, 1],

	// subpatch (default — overridden by counting inlet/outlet objects in raw content)
	pd: [0, 0],
}

/**
 * Get inlet/outlet counts for an object name.
 * For trigger/t, count depends on arguments.
 */
export function getObjectIO(name, params = []) {
	if (name === "trigger" || name === "t") {
		const n = params.length || 2
		return [1, n]
	}
	if (name === "pack") {
		const n = params.length || 2
		return [n, 1]
	}
	if (name === "unpack") {
		const n = params.length || 2
		return [1, n]
	}
	if (name === "select" || name === "sel") {
		const n = params.length || 1
		return [2, n + 1]
	}
	if (name === "route") {
		const n = params.length || 1
		return [2, n + 1]
	}
	if (name === "dac~") {
		const n = params.length || 2
		return [n, 0]
	}
	if (name === "adc~") {
		const n = params.length || 2
		return [0, n]
	}
	const io = OBJECT_IO[name]
	if (io) return io
	return [1, 1]
}

// ─── IEM Color decoding ───

/**
 * Decode PD's IEM color encoding.
 * Negative values encode RGB in 6-bit channels: -(r*64*64 + g*64 + b) * 4
 * Positive values are legacy indexed colors.
 */
export function parseIemColor(val) {
	const s = String(val || "")
	// Handle #hex color strings directly
	if (s.match(/^#[0-9a-fA-F]{3,8}$/)) return s
	const n = Number(val)
	if (!Number.isFinite(n)) return "#cccccc"
	if (n >= 0) {
		// Legacy color index — just return some defaults
		const legacy = ["#fcfcfc", "#ff0400", "#00fc00", "#0000fc", "#fcfc00", "#fc00fc", "#00fcfc", "#000000"]
		return legacy[n % legacy.length] || "#cccccc"
	}
	// Negative = encoded RGB
	const c = -1 - n
	const r = Math.floor(c / 4096) & 63
	const g = Math.floor(c / 64) & 63
	const b = c & 63
	// Scale from 6-bit (0-63) to 8-bit (0-255)
	return `#${(r * 4).toString(16).padStart(2, "0")}${(g * 4).toString(16).padStart(2, "0")}${(b * 4).toString(16).padStart(2, "0")}`
}

/**
 * Convert a #hex color string to PD's IEM integer format.
 * If the value is already a number string, pass it through.
 */
export function toIemColor(val) {
	const s = String(val || "")
	const m = s.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/)
	if (m) {
		// Convert 8-bit RGB to 6-bit and encode as negative integer
		const r = Math.floor(parseInt(m[1], 16) / 4) & 63
		const g = Math.floor(parseInt(m[2], 16) / 4) & 63
		const b = Math.floor(parseInt(m[3], 16) / 4) & 63
		return String(-1 - (r * 4096 + g * 64 + b))
	}
	return s
}

// ─── GUI Parameter Parsers ───

function sym(val) {
	const s = String(val || "")
	return s === "empty" || s === "-" ? "" : s
}

function parseBngParams(p) {
	return {
		size: Number(p[0]) || 15,
		hold: Number(p[1]) || 250,
		interrupt: Number(p[2]) || 50,
		init: Number(p[3]) || 0,
		send: sym(p[4]),
		receive: sym(p[5]),
		label: sym(p[6]),
		labelX: Number(p[7]) || 0,
		labelY: Number(p[8]) || 0,
		labelFont: Number(p[9]) || 0,
		labelFontSize: Number(p[10]) || 10,
		bgColor: parseIemColor(p[11]),
		fgColor: parseIemColor(p[12]),
		labelColor: parseIemColor(p[13]),
	}
}

function parseTglParams(p) {
	return {
		size: Number(p[0]) || 15,
		init: Number(p[1]) || 0,
		send: sym(p[2]),
		receive: sym(p[3]),
		label: sym(p[4]),
		labelX: Number(p[5]) || 0,
		labelY: Number(p[6]) || 0,
		labelFont: Number(p[7]) || 0,
		labelFontSize: Number(p[8]) || 10,
		bgColor: parseIemColor(p[9]),
		fgColor: parseIemColor(p[10]),
		labelColor: parseIemColor(p[11]),
		initValue: Number(p[12]) || 0,
		defaultValue: Number(p[13]) || 0,
	}
}

function parseVslParams(p) {
	return {
		width: Number(p[0]) || 15,
		height: Number(p[1]) || 128,
		bottom: Number(p[2]) || 0,
		top: Number(p[3]) || 127,
		log: Number(p[4]) || 0,
		init: Number(p[5]) || 0,
		send: sym(p[6]),
		receive: sym(p[7]),
		label: sym(p[8]),
		labelX: Number(p[9]) || 0,
		labelY: Number(p[10]) || 0,
		labelFont: Number(p[11]) || 0,
		labelFontSize: Number(p[12]) || 10,
		bgColor: parseIemColor(p[13]),
		fgColor: parseIemColor(p[14]),
		labelColor: parseIemColor(p[15]),
		defaultValue: Number(p[16]) || 0,
		steadyOnClick: Number(p[17]) || 1,
	}
}

function parseHslParams(p) {
	return {
		width: Number(p[0]) || 128,
		height: Number(p[1]) || 15,
		bottom: Number(p[2]) || 0,
		top: Number(p[3]) || 127,
		log: Number(p[4]) || 0,
		init: Number(p[5]) || 0,
		send: sym(p[6]),
		receive: sym(p[7]),
		label: sym(p[8]),
		labelX: Number(p[9]) || 0,
		labelY: Number(p[10]) || 0,
		labelFont: Number(p[11]) || 0,
		labelFontSize: Number(p[12]) || 10,
		bgColor: parseIemColor(p[13]),
		fgColor: parseIemColor(p[14]),
		labelColor: parseIemColor(p[15]),
		defaultValue: Number(p[16]) || 0,
		steadyOnClick: Number(p[17]) || 1,
	}
}

function parseNbxParams(p) {
	return {
		width: Number(p[0]) || 5,
		height: Number(p[1]) || 14,
		min: Number(p[2]) || -1e37,
		max: Number(p[3]) || 1e37,
		log: Number(p[4]) || 0,
		init: Number(p[5]) || 0,
		send: sym(p[6]),
		receive: sym(p[7]),
		label: sym(p[8]),
		labelX: Number(p[9]) || 0,
		labelY: Number(p[10]) || 0,
		labelFont: Number(p[11]) || 0,
		labelFontSize: Number(p[12]) || 10,
		bgColor: parseIemColor(p[13]),
		fgColor: parseIemColor(p[14]),
		labelColor: parseIemColor(p[15]),
		defaultValue: Number(p[16]) || 0,
		logHeight: Number(p[17]) || 256,
	}
}

function parseRadioParams(p) {
	return {
		size: Number(p[0]) || 15,
		newOld: Number(p[1]) || 1,
		init: Number(p[2]) || 0,
		number: Number(p[3]) || 8,
		send: sym(p[4]),
		receive: sym(p[5]),
		label: sym(p[6]),
		labelX: Number(p[7]) || 0,
		labelY: Number(p[8]) || 0,
		labelFont: Number(p[9]) || 0,
		labelFontSize: Number(p[10]) || 10,
		bgColor: parseIemColor(p[11]),
		fgColor: parseIemColor(p[12]),
		labelColor: parseIemColor(p[13]),
		defaultValue: Number(p[14]) || 0,
	}
}

function parseVuParams(p) {
	return {
		width: Number(p[0]) || 15,
		height: Number(p[1]) || 120,
		receive: sym(p[2]),
		label: sym(p[3]),
		labelX: Number(p[4]) || 0,
		labelY: Number(p[5]) || 0,
		labelFont: Number(p[6]) || 0,
		labelFontSize: Number(p[7]) || 10,
		bgColor: parseIemColor(p[8]),
		labelColor: parseIemColor(p[9]),
		scale: Number(p[10]) || 1,
	}
}

function parseCnvParams(p) {
	return {
		size: Number(p[0]) || 15,
		width: Number(p[1]) || 100,
		height: Number(p[2]) || 60,
		send: sym(p[3]),
		receive: sym(p[4]),
		label: sym(p[5]),
		labelX: Number(p[6]) || 0,
		labelY: Number(p[7]) || 0,
		labelFont: Number(p[8]) || 0,
		labelFontSize: Number(p[9]) || 10,
		bgColor: parseIemColor(p[10]),
		labelColor: parseIemColor(p[11]),
	}
}

function parseKeyboardParams(p) {
	return {
		lowNote: Number(p[0]) || 48,
		octaves: Number(p[1]) || 2,
		whiteW: Number(p[2]) || 20,
		height: Number(p[3]) || 60,
	}
}

/**
 * Parse GUI parameters based on type, returning structured fields.
 */
export function parseGuiParams(type, rawParams) {
	if (!rawParams || !rawParams.length) return null
	switch (type) {
		case "bng": return parseBngParams(rawParams)
		case "tgl": return parseTglParams(rawParams)
		case "vsl": return parseVslParams(rawParams)
		case "hsl": return parseHslParams(rawParams)
		case "nbx": return parseNbxParams(rawParams)
		case "vradio": return parseRadioParams(rawParams)
		case "hradio": return parseRadioParams(rawParams)
		case "vu": return parseVuParams(rawParams)
		case "cnv": return parseCnvParams(rawParams)
		case "keyboard": return parseKeyboardParams(rawParams)
		default: return null
	}
}

/**
 * Parse floatatom/symbolatom send/receive from params.
 * Format: width lower upper label_pos label receive send
 */
function parseAtomParams(params) {
	if (!params || params.length < 7) return null
	return {
		width: Number(params[0]) || 5,
		lower: Number(params[1]) || 0,
		upper: Number(params[2]) || 0,
		labelPos: Number(params[3]) || 0,
		label: sym(params[4]),
		receive: sym(params[5]),
		send: sym(params[6]),
	}
}

/**
 * Parse .pd file text into a JS object model.
 */
export function parsePd(text) {
	const result = {
		canvas: { x: 0, y: 0, width: 600, height: 400, name: "(subpatch)", fontSize: 12 },
		nodes: [],
		connections: [],
	}

	if (!text || !text.trim()) return result

	// PD uses semicolons to terminate statements, possibly across lines
	// Normalize: join continuation lines, then split on semicolons
	const normalized = text.replace(/\r\n/g, "\n").replace(/\\\n/g, " ")

	// Split on semicolons (which end each statement)
	const statements = normalized.split(/;\s*\n?/).map((s) => s.trim()).filter(Boolean)

	let nodeIndex = 0
	// Track nesting depth for subpatches/arrays.
	// depth 0 = before/at top-level canvas, depth 1 = inside top-level canvas,
	// depth 2+ = inside nested subpatch/array canvases
	let depth = 0
	let hadTopCanvas = false
	// Collect raw statements for nested subpatches/arrays
	let nestedStmts = []

	for (const stmt of statements) {
		const tokens = tokenize(stmt)
		if (tokens.length < 2) continue

		const directive = tokens[0]
		const type = tokens[1]

		if (directive === "#N" && type === "canvas") {
			if (!hadTopCanvas) {
				// Top-level canvas
				hadTopCanvas = true
				result.canvas = {
					x: num(tokens[2]),
					y: num(tokens[3]),
					width: num(tokens[4], 600),
					height: num(tokens[5], 400),
					name: tokens[6] || "(subpatch)",
					fontSize: num(tokens[7], 12),
				}
				// Don't increment depth — top-level objects are at depth 0
			} else {
				// Nested canvas (subpatch or array graph)
				if (depth === 0) nestedStmts = []
				nestedStmts.push(stmt)
				depth++
			}
		} else if (directive === "#X" && type === "restore") {
			if (depth > 0) {
				depth--
				if (depth === 0) {
					// Restored back to top level — create a subpatch/array node
					const x = num(tokens[2])
					const y = num(tokens[3])
					const subType = tokens[4] || ""
					const subName = tokens.slice(5).join(" ") || subType
					// Build the raw content: nested statements + the restore line
					const rawLines = nestedStmts.map(s => s + ";")
					rawLines.push(stmt + ";")
					result.nodes.push({
						id: nodeIndex++,
						type: "obj",
						x,
						y,
						text: subType === "graph" ? "array" : "pd",
						params: subType === "graph" ? [] : [subName],
						isSubpatch: subType !== "graph",
						isArray: subType === "graph",
						rawContent: rawLines.join("\n"),
					})
					nestedStmts = []
				} else {
					nestedStmts.push(stmt)
				}
			}
		} else if (depth > 0) {
			// Inside a nested canvas — collect raw statements
			nestedStmts.push(stmt)
			if (depth === 1 && directive === "#X" && type === "array") {
				const arrayName = tokens[2] || ""
				const arraySize = num(tokens[3], 100)
				result._pendingArray = { name: arrayName, size: arraySize }
			}
			continue
		} else if (directive === "#X" && type === "connect") {
			result.connections.push({
				sourceNode: num(tokens[2]),
				sourceOutlet: num(tokens[3]),
				targetNode: num(tokens[4]),
				targetInlet: num(tokens[5]),
			})
		} else if (directive === "#X" && type === "obj") {
			const x = num(tokens[2])
			const y = num(tokens[3])
			const name = tokens[4] || ""
			const params = tokens.slice(5)
			// Check if this is a GUI object wrapped in #X obj (e.g. #X obj 200 230 bng ...)
			const GUI_OBJ_TYPES = new Set(["bng", "tgl", "vsl", "hsl", "vu", "cnv", "nbx", "vradio", "hradio", "keyboard"])
			if (GUI_OBJ_TYPES.has(name)) {
				const guiParams = parseGuiParams(name, params)
				result.nodes.push({
					id: nodeIndex++,
					type: name,
					x,
					y,
					text: name,
					params,
					guiParams,
				})
			} else {
				result.nodes.push({
					id: nodeIndex++,
					type: "obj",
					x,
					y,
					text: name,
					params,
				})
			}
		} else if (directive === "#X" && type === "msg") {
			const x = num(tokens[2])
			const y = num(tokens[3])
			const msgText = tokens.slice(4).join(" ")
			result.nodes.push({
				id: nodeIndex++,
				type: "msg",
				x,
				y,
				text: msgText,
				params: [],
			})
		} else if (directive === "#X" && type === "floatatom") {
			const atomParams = parseAtomParams(tokens.slice(4))
			result.nodes.push({
				id: nodeIndex++,
				type: "floatatom",
				x: num(tokens[2]),
				y: num(tokens[3]),
				text: "",
				params: tokens.slice(4),
				guiParams: atomParams,
			})
		} else if (directive === "#X" && type === "symbolatom") {
			const atomParams = parseAtomParams(tokens.slice(4))
			result.nodes.push({
				id: nodeIndex++,
				type: "symbolatom",
				x: num(tokens[2]),
				y: num(tokens[3]),
				text: "",
				params: tokens.slice(4),
				guiParams: atomParams,
			})
		} else if (directive === "#X" && type === "text") {
			result.nodes.push({
				id: nodeIndex++,
				type: "text",
				x: num(tokens[2]),
				y: num(tokens[3]),
				text: tokens.slice(4).join(" "),
				params: [],
			})
		} else if (directive === "#X" && (type === "bng" || type === "tgl" || type === "vsl" || type === "hsl" || type === "vu" || type === "cnv" || type === "nbx" || type === "vradio" || type === "hradio" || type === "keyboard")) {
			const rawParams = tokens.slice(4)
			const guiParams = parseGuiParams(type, rawParams)
			result.nodes.push({
				id: nodeIndex++,
				type,
				x: num(tokens[2]),
				y: num(tokens[3]),
				text: type,
				params: rawParams,
				guiParams,
			})
		} else if (directive === "#X") {
			// Unknown #X type — store as generic obj
			result.nodes.push({
				id: nodeIndex++,
				type: "obj",
				x: num(tokens[2]),
				y: num(tokens[3]),
				text: type,
				params: tokens.slice(4),
			})
		}
	}

	// Attach pending array info to array nodes
	if (result._pendingArray) {
		for (const node of result.nodes) {
			if (node.isArray && !node.arrayName) {
				node.arrayName = result._pendingArray.name
				node.arraySize = result._pendingArray.size
				node.text = "array"
				node.params = [result._pendingArray.name, String(result._pendingArray.size)]
			}
		}
		delete result._pendingArray
	}

	return result
}

/**
 * Serialize a JS object model back to .pd text format.
 */
export function serializePd(model) {
	const lines = []
	const c = model.canvas

	lines.push(`#N canvas ${c.x} ${c.y} ${c.width} ${c.height} ${c.name} ${c.fontSize};`)

	for (const node of model.nodes) {
		if (node.rawContent) {
			// Subpatch or array with preserved raw content
			lines.push(node.rawContent)
		} else if (node.isArray) {
			// Array node without raw content: emit minimal stub
			const name = node.arrayName || node.params[0] || "array1"
			const size = node.arraySize || Number(node.params[1]) || 100
			lines.push(`#N canvas 0 0 450 300 (subpatch) 0;`)
			lines.push(`#X array ${name} ${size} float 3;`)
			lines.push(`#X restore ${node.x} ${node.y} graph;`)
		} else if (node.isSubpatch) {
			// Subpatch without raw content: emit as pd obj (won't have inner contents)
			const parts = ["#X obj", node.x, node.y, "pd"]
			if (node.params && node.params.length) parts.push(...node.params)
			lines.push(parts.join(" ") + ";")
		} else if (node.type === "obj") {
			const parts = ["#X obj", node.x, node.y, node.text]
			if (node.params && node.params.length) parts.push(...node.params)
			lines.push(parts.join(" ") + ";")
		} else if (node.type === "msg") {
			lines.push(`#X msg ${node.x} ${node.y} ${node.text};`)
		} else if (node.type === "floatatom") {
			const parts = ["#X floatatom", node.x, node.y]
			if (node.params && node.params.length) parts.push(...node.params)
			lines.push(parts.join(" ") + ";")
		} else if (node.type === "symbolatom") {
			const parts = ["#X symbolatom", node.x, node.y]
			if (node.params && node.params.length) parts.push(...node.params)
			lines.push(parts.join(" ") + ";")
		} else if (node.type === "text") {
			lines.push(`#X text ${node.x} ${node.y} ${node.text};`)
		} else if (["bng", "tgl", "vsl", "hsl", "vu", "cnv", "nbx", "vradio", "hradio", "keyboard"].includes(node.type)) {
			const parts = ["#X obj", node.x, node.y, node.type]
			if (node.params && node.params.length) {
				// Convert any #hex color strings back to IEM integer format for PD
				parts.push(...node.params.map(p => toIemColor(p)))
			}
			lines.push(parts.join(" ") + ";")
		} else {
			// Fallback
			const parts = ["#X obj", node.x, node.y, node.text]
			if (node.params && node.params.length) parts.push(...node.params)
			lines.push(parts.join(" ") + ";")
		}
	}

	for (const conn of model.connections) {
		lines.push(`#X connect ${conn.sourceNode} ${conn.sourceOutlet} ${conn.targetNode} ${conn.targetInlet};`)
	}

	return lines.join("\n")
}

/**
 * Tokenize a PD statement, respecting spaces and commas.
 */
function tokenize(stmt) {
	return stmt.split(/\s+/).filter(Boolean)
}

function num(val, fallback = 0) {
	const n = Number(val)
	return Number.isFinite(n) ? n : fallback
}

/**
 * Default empty patch content.
 */
export const DEFAULT_PATCH = `#N canvas 0 0 600 400 (subpatch) 12;`
