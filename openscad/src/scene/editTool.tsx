// Editing an OpenSCAD model where it stands in a scene (`scene:view`
// "openscad-scene-edit"): the model's Open (the scene's convention: the
// inspector's button, the object's menu, a double-click or Enter in Edit) puts
// a hand on the scene's stack, hides the object's built GLB from this viewer,
// lays the package's editor over the scene's view (OpenscadEditor, hosted: no
// view of its own) and draws each of its renders in the object's place, with
// the scene's own three.js (a scene's renderer can't draw another copy's
// objects), in the object's frame and its build's units (hosted.ts
// modelFrame). Its writes go on the scene's undo (hosted.ts hostedHandle).
// Escape: a focused field first (the scene's ladder), then it puts the hand
// down. Clicking the drawn model picks a part: the editor shows the call that
// made it and the chain of calls (render/sourceMap.ts), and the part is
// washed in the accent here; the code's cursor lights the parts it made.
// The scene's contract: patchwork-experiments/scene, STAGE.md ("View
// plugins", "Hands") and EDITOR.md ("A command", "Undo").

import {render} from "solid-js/web"
import type {DocHandle} from "@automerge/automerge-repo"
import type * as Three from "three"
import {OpenscadEditor} from "../components/OpenscadEditor"
import type {OpenscadDoc} from "../types"
import {hostedHandle, modelFrame, type Edits} from "./hosted"
import {UNIT_METERS, type Unit} from "./axes"
import type {Model} from "../render/model"
import {pieceOf, trianglesOf, type SourceMap} from "../render/sourceMap"
import {accentOf, chooseHit, disposeAll, highlightObjects} from "../components/highlight"

/** The scene source whose objects this edits (index.ts). */
export const SOURCE_ID = "openscad-model"

type SceneObject = {providerId?: string; sourceUrl?: string; renderUrl?: string; name?: string}
/** The parts of the scene's api this uses: the view plugin's, and its focus stage's (`api.focus()`). */
type Stage = {
	THREE: typeof Three
	signal: AbortSignal
	repo: {find(url: string): Promise<DocHandle<unknown>>}
	scene(): {objects: Record<string, SceneObject | undefined>}
	world(o?: {onTop?: boolean}): Three.Group
	display(id: string, o: {hidden?: boolean}): () => void
	worldOf(id: string): number[] | null
	invalidate(): void
}
type ViewApi = {
	use(name: string): unknown
	focus(): Stage | null
	overlay(): HTMLElement
		hand(spec: {kind: string; name: string; input: HandInput; pointer?: boolean; escape?: () => boolean; put?: () => void}): () => void
}

/** A scene input event, as much of it as this uses (STAGE.md, "The input chain"). */
type InputEvent = {ray: {origin: number[]; dir: number[]} | null; alt: boolean}
type HandInput = {click?(ev: InputEvent): boolean; cursor?(ev: InputEvent): string | null}

interface Session {
	id: string
	/** The drawn render's size in the stage (metres, x y z), for probes. */
	extent(): number[] | null
	/** The object moved: draw the render where it is now. */
	moved(): void
	triangles(): number
	/** how many parts the source map names, or null while it isn't in */
	parts(): number | null
	stop(): void
}

const unitOf = (v: unknown): Unit => (typeof v === "string" && v in UNIT_METERS ? (v as Unit) : "mm")

export function create(api: ViewApi) {
	const overlay = api.overlay()
	let session: Session | undefined

	function start(stage: Stage, id: string) {
		session?.stop()
		const object = stage.scene().objects[id]
		if (!object?.sourceUrl) return
		const {THREE} = stage
		const layer = stage.world()
		layer.userData["noPick"] = true
		const root = new THREE.Group()
		root.matrixAutoUpdate = false
		layer.add(root)
		// the model's parts (a mesh per colour) and, over them, the picked and lit parts
		const drawn = new THREE.Group()
		const marks = new THREE.Group()
		root.add(drawn, marks)
		let partMeshes: Three.Mesh[] = []
		let model: Model | null = null
		let map: SourceMap | null = null
		let controls: {pick(record: number | null): void} | null = null
		/** the piece of the picked part that was clicked (one cell of a loop's six) */
		let piece: {record: number; positions: Float32Array; model: Model} | null = null
		let lastHighlight: {selected: number | null; lit: ReadonlySet<number>} = {selected: null, lit: new Set()}
		const show = stage.display(id, {hidden: true})
		let unit: Unit = "mm"
		let triangles = 0
		const moved = () => {
			const m = modelFrame(stage.worldOf(id), unit)
			root.visible = !!m
			if (m) root.matrix.fromArray(m)
			root.matrixWorldNeedsUpdate = true
			stage.invalidate()
		}
		const clear = () => {
			disposeAll([...drawn.children])
			disposeAll([...marks.children])
			partMeshes = []
		}
		/**
		 * A render: each of the model's parts (its triangles of one colour, in its own units, Z up) and their
		 * creases, in its frame; a part's colour as the built GLB has it (source.ts), none in the body grey.
		 * A failed render keeps the last.
		 */
		const draw = (next: Model | null) => {
			if (!next) return
			clear()
			model = next
			map = null
			triangles = next.triangles
			for (const part of next.parts) {
				const g = new THREE.BufferGeometry()
				g.setAttribute("position", new THREE.Float32BufferAttribute(part.positions, 3))
				g.computeVertexNormals()
				const [r, gr, b, a] = part.color ?? [0, 0, 0, 1]
				const color = part.color ? new THREE.Color().setRGB(r, gr, b, THREE.SRGBColorSpace) : new THREE.Color("#a9aeb5")
				const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({color, transparent: a < 1, opacity: a, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1}))
				const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), new THREE.LineBasicMaterial({color: "#1e1e1e"}))
				drawn.add(mesh, edges)
				partMeshes.push(mesh)
			}
			moved()
		}
		/** The part a world ray hits, see-through surfaces passed over unless `front` (Alt). */
		const raycaster = new THREE.Raycaster()
		const hitAt = (ray: InputEvent["ray"], front: boolean): {record: number; part: number; tri: number} | null => {
			if (!map || !ray || !root.visible) return null
			root.updateMatrixWorld(true)
			raycaster.set(new THREE.Vector3().fromArray(ray.origin), new THREE.Vector3().fromArray(ray.dir).normalize())
			const hits = raycaster.intersectObjects(partMeshes, false)
			const hit = chooseHit(hits, h => !!((h.object as Three.Mesh).material as Three.Material).transparent, front)
			if (!hit || hit.faceIndex == null) return null
			const part = partMeshes.indexOf(hit.object as Three.Mesh)
			const record = map.faces[part]?.[hit.faceIndex]
			return record == null || record < 0 ? null : {record, part, tri: hit.faceIndex}
		}
		const element = document.createElement("div")
		element.className = "openscad-scene-editor"
		element.style.cssText = "position: absolute; top: 0; left: 0; bottom: 0; width: min(46%, 560px); pointer-events: auto; box-shadow: 0 0 12px rgb(0 0 0 / 15%);"
		overlay.append(element)
		const accent = accentOf(element)
		const highlight = (selected: number | null, lit: ReadonlySet<number>) => {
			lastHighlight = {selected, lit}
			disposeAll([...marks.children])
			if (model && map) {
				const add = (positions: Float32Array, strong: boolean) => {
					for (const o of highlightObjects(THREE, positions, strong, accent)) marks.add(o)
				}
				const soft = new Set([...lit].filter(r => r !== selected))
				add(trianglesOf(model, map, soft), false)
				if (selected != null) {
					// the clicked piece strongest, the part's other pieces softly
					const clicked = piece && piece.record === selected && piece.model === model ? piece.positions : null
					add(trianglesOf(model, map, new Set([selected])), !clicked)
					if (clicked) add(clicked, true)
				}
			}
			stage.invalidate()
		}
		let unmount = () => {}
		let offRender = () => {}
		let stopped = false
		let putDown = () => {}
		const stop = () => {
			if (stopped) return
			stopped = true
			if (session?.id === id) session = undefined
			putDown()
			unmount()
			offRender()
			element.remove()
			clear()
			layer.removeFromParent()
			show()
			stage.invalidate()
		}
		// the build's units are its render doc's (the scene:source's `unit` param)
		if (object.renderUrl)
			stage.repo.find(object.renderUrl).then(
				h => {
					if (stopped) return
					const read = () => {
						const next = unitOf((h.doc() as {params?: {unit?: unknown}} | undefined)?.params?.unit)
						if (next !== unit) {
							unit = next
							moved()
						}
					}
					h.on("change", read)
					offRender = () => h.off("change", read)
					read()
				},
				() => {},
			)
		stage.repo.find(object.sourceUrl).then(
			handle => {
				if (stopped) return
				const hosted = hostedHandle(handle as DocHandle<OpenscadDoc>, () => (api.use("edits") as Edits | null) ?? null)
				unmount = render(
					() => (
						<OpenscadEditor
							handle={hosted}
							element={{repo: stage.repo as never}}
							hosted={{
								onModel: draw,
								onSourceMap: next => {
									map = next
								},
								onHighlight: highlight,
								connect: c => {
									controls = c
								},
							}}
						/>
					),
					element,
				)
			},
			() => stop(),
		)
		putDown = api.hand({
			kind: "openscad",
			name: `Editing ${object.name ?? "model"}`,
			pointer: true,
			// A click on the model picks a part (the editor shows its source); every
			// other event passes: the scene's orbit, selection and the rest go on.
			input: {
				click(ev) {
					const hit = hitAt(ev.ray, ev.alt)
					if (!hit || !model || !map) return false
					piece = {record: hit.record, positions: pieceOf(model, map, hit.part, hit.tri), model}
					// the same part again (another of its pieces) changes nothing in the editor: redraw here
					if (lastHighlight.selected === hit.record) highlight(hit.record, lastHighlight.lit)
					controls?.pick(hit.record)
					return true
				},
				cursor: ev => (hitAt(ev.ray, ev.alt) == null ? null : "pointer"),
			},
			// nothing of its own to step out of (a focused field is the ladder's own rung): Escape leaves
			escape: () => false,
			put: () => stop(),
		})
		// the focus leaving takes the layer and the display with it
		stage.signal.addEventListener("abort", stop, {once: true})
		const extent = () => {
			if (!root.children.length) return null
			root.updateMatrixWorld(true)
			const box = new THREE.Box3().setFromObject(root)
			return box.isEmpty() ? null : box.getSize(new THREE.Vector3()).toArray()
		}
		session = {id, moved, extent, triangles: () => triangles, parts: () => (map ? map.records.length : null), stop}
	}

	const isModel = (target: unknown) => typeof target === "string" && api.focus()?.scene().objects[target]?.providerId === SOURCE_ID

	return {
		commands: [
			{
				// the model's Open (scene EDITOR.md, "A command"): its code editor, over the scene, the render in place
				id: "scad-edit",
				name: "Open",
				open: true,
				key: "Enter",
				hand: "edit",
				show: ["menu", "inspector"],
				state: (target: unknown) => (isModel(target) ? {label: session?.id === target ? "Close" : "Open", title: session?.id === target ? "Close the model's editor" : "Edit the model's code here, its render in place", checked: session?.id === target} : null),
				run(target: unknown) {
					const stage = api.focus()
					if (!stage || !isModel(target)) return
					if (session && session.id === target) session.stop()
					else start(stage, target as string)
				},
			},
		],
		update() {
			session?.moved()
		},
		dispose() {
			session?.stop()
		},
		/** For probes: what is edited, how many triangles its live render has, and how many parts its source map names. */
		inspect: () => ({editing: session?.id ?? null, triangles: session?.triangles() ?? 0, extent: session?.extent() ?? null, parts: session?.parts() ?? null}),
	}
}

export default {create}
