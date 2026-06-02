import type {Repo} from "@automerge/automerge-repo"
import type {PaperDoc, PaperLayerDoc} from "./types"
import type {RectShape} from "./rect-layer/RectLayerTool"
import type {LineShape} from "./line-layer/LineLayerTool"

export const PaperDatatype = {
	init(doc: PaperDoc, repo: Repo) {
		doc.title = "Paper"
		doc.layers = []

		const rects: RectShape[] = [
			{x: 80, y: 80, z: 1, width: 240, height: 160, fill: "#e0a3a3", stroke: "#b97f7f"},
			{x: 200, y: 140, z: 3, width: 220, height: 150, fill: "#a7c4a0", stroke: "#7fa176"},
		]
		const lines: LineShape[] = [
			{x: 60, y: 260, z: 2, x2: 360, y2: 60, stroke: "#7e9cc0", strokeWidth: 6},
			{x: 120, y: 80, z: 4, x2: 440, y2: 320, stroke: "#cda46b", strokeWidth: 6},
		]

		const rectLayer = repo.create<PaperLayerDoc>({
			"@patchwork": {type: "paper-layer"},
			title: "Rectangles",
			shapes: rects,
		})
		const lineLayer = repo.create<PaperLayerDoc>({
			"@patchwork": {type: "paper-layer"},
			title: "Lines",
			shapes: lines,
		})

		doc.layers.push({url: rectLayer.url, toolId: "paper-rect"})
		doc.layers.push({url: lineLayer.url, toolId: "paper-line"})
	},
	getTitle(doc: PaperDoc) {
		return doc.title || "Paper"
	},
	setTitle(doc: PaperDoc, title: string) {
		doc.title = title
	},
}

export const PaperLayerDatatype = {
	init(doc: PaperLayerDoc) {
		doc.title = "Layer"
		doc.shapes = []
	},
	getTitle(doc: PaperLayerDoc) {
		return doc.title || "Layer"
	},
	setTitle(doc: PaperLayerDoc, title: string) {
		doc.title = title
	},
}
