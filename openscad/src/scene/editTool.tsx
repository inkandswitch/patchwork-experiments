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
// down. The scene's contract: patchwork-experiments/scene, STAGE.md ("View
// plugins", "Hands") and EDITOR.md ("A command", "Undo").

import {render} from "solid-js/web"
import type {DocHandle} from "@automerge/automerge-repo"
import type * as Three from "three"
import {OpenscadEditor} from "../components/OpenscadEditor"
import type {OpenscadDoc} from "../types"
import {hostedHandle, modelFrame, type Edits} from "./hosted"
import {UNIT_METERS, type Unit} from "./axes"
import type {Model} from "../render/model"

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
	hand(spec: {kind: string; name: string; input: object; pointer?: boolean; escape?: () => boolean; put?: () => void}): () => void
}

interface Session {
	id: string
	/** The drawn render's size in the stage (metres, x y z), for probes. */
	extent(): number[] | null
	/** The object moved: draw the render where it is now. */
	moved(): void
	triangles(): number
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
			for (const c of [...root.children]) {
				c.removeFromParent()
				const o = c as Three.Mesh
				o.geometry?.dispose()
				;(o.material as Three.Material | undefined)?.dispose()
			}
		}
		/**
		 * A render: each of the model's parts (its triangles of one colour, in its own units, Z up) and their
		 * creases, in its frame; a part's colour as the built GLB has it (source.ts), none in the body grey.
		 * A failed render keeps the last.
		 */
		const draw = (model: Model | null) => {
			if (!model) return
			clear()
			triangles = model.triangles
			for (const part of model.parts) {
				const g = new THREE.BufferGeometry()
				g.setAttribute("position", new THREE.Float32BufferAttribute(part.positions, 3))
				g.computeVertexNormals()
				const [r, gr, b, a] = part.color ?? [0, 0, 0, 1]
				const color = part.color ? new THREE.Color().setRGB(r, gr, b, THREE.SRGBColorSpace) : new THREE.Color("#a9aeb5")
				const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({color, transparent: a < 1, opacity: a, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1}))
				const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), new THREE.LineBasicMaterial({color: "#1e1e1e"}))
				root.add(mesh, edges)
			}
			moved()
		}
		const element = document.createElement("div")
		element.className = "openscad-scene-editor"
		element.style.cssText = "position: absolute; top: 0; left: 0; bottom: 0; width: min(46%, 560px); pointer-events: auto; box-shadow: 0 0 12px rgb(0 0 0 / 15%);"
		overlay.append(element)
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
				unmount = render(() => <OpenscadEditor handle={hosted} element={{repo: stage.repo as never}} hosted={{onModel: draw}} />, element)
			},
			() => stop(),
		)
		putDown = api.hand({
			kind: "openscad",
			name: `Editing ${object.name ?? "model"}`,
			pointer: true,
			// it passes every event: the scene's orbit, selection and the rest go on as they do
			input: {},
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
		session = {id, moved, extent, triangles: () => triangles, stop}
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
				edit: true,
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
		/** For probes: what is edited, and how many triangles its live render has. */
		inspect: () => ({editing: session?.id ?? null, triangles: session?.triangles() ?? 0, extent: session?.extent() ?? null}),
	}
}

export default {create}
