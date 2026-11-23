import {onMount, onCleanup, createEffect, createSignal, Show} from "solid-js"
import * as THREE from "three"
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls.js"
import {needsReframe} from "./framing"
import {allPositions, type Model, type RGBA} from "../render/model"
import {chainOf, labelOf, pieceOf, trianglesOf, type SourceMap} from "../render/sourceMap"
import {accentOf, chooseHit, disposeAll, highlightObjects} from "./highlight"

/** What hovering a part says: its label, then the shape and line that made the face. */
export function hoverText(map: SourceMap, record: number): {label: string; detail: string} {
	const chain = chainOf(map, record)
	const shape = chain[chain.length - 1]
	const label = labelOf(map, record)
	const at = shape ? `${shape.file ? `${shape.file}, ` : ""}line ${shape.line}` : ""
	return {label, detail: shape && shape.name !== label ? `${shape.name}, ${at}` : at}
}

/** A pointer that moves less than this between press and release is a click, not an orbit. */
const CLICK_SLOP_PX = 4

/** One material per colour; triangles the model gives no colour use `uncoloured`. */
function materialFor(color: RGBA | null, uncoloured: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
	if (!color) return uncoloured
	const [r, g, b, a] = color
	return new THREE.MeshStandardMaterial({
		color: new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace),
		metalness: uncoloured.metalness,
		roughness: uncoloured.roughness,
		side: THREE.DoubleSide,
		transparent: a < 1,
		opacity: a,
		// see-through parts don't hide what is behind them
		depthWrite: a >= 1,
	})
}

export function Viewer3D(props: {
	model: Model | null
	/** which source made which triangle of `model`; null while unknown */
	sourceMap?: SourceMap | null
	/** the picked part (a record of sourceMap), drawn strongest */
	selected?: number | null
	/** parts to show more softly: those the code's cursor is in */
	lit?: ReadonlySet<number>
	/** a click on a part, or on nothing (null) */
	onPick?: (record: number | null) => void
}) {
	let container!: HTMLDivElement
	let canvas!: HTMLCanvasElement
	const [hover, setHover] = createSignal<{x: number; y: number; label: string; detail: string} | null>(null)

	onMount(() => {
		const scene = new THREE.Scene()
		const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000)
		// OpenSCAD is Z-up, and OrbitControls captures the orbit axis from
		// camera.up in its constructor — so this has to be set first.
		camera.up.set(0, 0, 1)
		camera.position.set(60, -90, 70)
		camera.lookAt(0, 0, 0)

		// preserveDrawingBuffer keeps the last frame readable, so a screenshot
		// (the agent's view_screenshot, or anyone's toDataURL) gets the model
		// rather than a blank canvas cleared after compositing.
		const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true, preserveDrawingBuffer: true})
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

		const controls = new OrbitControls(camera, renderer.domElement)
		controls.enableDamping = true
		controls.dampingFactor = 0.08
		controls.target.set(0, 0, 0)
		controls.update()

		scene.add(new THREE.HemisphereLight(0xffffff, 0x33333a, 2.2))
		const key = new THREE.DirectionalLight(0xffffff, 1.6)
		key.position.set(1, 1.4, 1)
		scene.add(key)
		const fill = new THREE.DirectionalLight(0xffffff, 0.5)
		fill.position.set(-1, -0.6, -1)
		scene.add(fill)

		const grid = new THREE.GridHelper(200, 20, 0x888888, 0x444444)
		grid.rotation.x = Math.PI / 2
		grid.position.z = -0.001
		scene.add(grid)

		const material = new THREE.MeshStandardMaterial({
			color: 0xd8dee9,
			metalness: 0.05,
			roughness: 0.55,
			side: THREE.DoubleSide,
		})
		let mesh: THREE.Mesh | null = null
		let partMaterials: THREE.MeshStandardMaterial[] = []

		function resize() {
			const w = container.clientWidth || 1
			const h = container.clientHeight || 1
			camera.aspect = w / h
			camera.updateProjectionMatrix()
			renderer.setSize(w, h, false)
		}
		resize()
		const resizeObserver = new ResizeObserver(resize)
		resizeObserver.observe(container)

		let frameId = 0
		function tick() {
			controls.update()
			renderer.render(scene, camera)
			frameId = requestAnimationFrame(tick)
		}
		tick()

		// the radius the camera was last framed for: re-frame only when the part's size changes a lot
		let framedRadius = 0
		function frameCamera(geometry: THREE.BufferGeometry) {
			geometry.computeBoundingSphere()
			const sphere = geometry.boundingSphere
			if (!sphere || !isFinite(sphere.radius) || sphere.radius === 0) return
			framedRadius = sphere.radius
			const center = sphere.center
			const radius = sphere.radius
			const dir = new THREE.Vector3(0.55, -0.85, 0.65).normalize()
			camera.position.copy(center).addScaledVector(dir, radius * 3.2)
			camera.near = Math.max(radius / 100, 0.01)
			camera.far = radius * 100
			camera.updateProjectionMatrix()
			controls.target.copy(center)
			controls.update()
		}

		// ─── which part is under the pointer, and the highlights ───
		const raycaster = new THREE.Raycaster()
		const ndc = new THREE.Vector2()
		/** the soup's first triangle of each part, for turning a hit triangle into (part, triangle) */
		let partStarts: number[] = []
		/**
		 * The part under the pointer. See-through surfaces are passed over for
		 * whatever opaque one is behind them, as the eye does (the cells in a
		 * translucent enclosure); `front` takes the nearest surface regardless.
		 */
		const hitAt = (clientX: number, clientY: number, front = false): {record: number; part: number; tri: number} | null => {
			const map = props.sourceMap
			if (!mesh || !map) return null
			const rect = canvas.getBoundingClientRect()
			ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
			raycaster.setFromCamera(ndc, camera)
			const hits = raycaster.intersectObject(mesh, false)
			const hit = chooseHit(hits, h => !!partMaterials[h.face?.materialIndex ?? -1]?.transparent, front)
			if (!hit || hit.faceIndex == null) return null
			let part = partStarts.length - 1
			while (part > 0 && partStarts[part] > hit.faceIndex) part--
			const tri = hit.faceIndex - partStarts[part]
			const record = map.faces[part]?.[tri]
			return record == null || record < 0 ? null : {record, part, tri}
		}
		const recordAt = (clientX: number, clientY: number, front = false) => hitAt(clientX, clientY, front)?.record ?? null
		/** the piece of the picked part that was clicked (one cell of a loop's six), while it is the one picked */
		const [piece, setPiece] = createSignal<{record: number; positions: Float32Array; model: Model} | null>(null)

		const accent = accentOf(container)
		const highlights = new THREE.Group()
		scene.add(highlights)
		const clearHighlights = () => disposeAll([...highlights.children])
		const highlight = (positions: Float32Array, strong: boolean) => {
			for (const o of highlightObjects(THREE, positions, strong, accent)) highlights.add(o)
		}
		createEffect(() => {
			const model = props.model
			const map = props.sourceMap
			const selected = props.selected ?? null
			const lit = props.lit
			clearHighlights()
			if (!model || !map) return
			const soft = new Set([...(lit ?? [])].filter(r => r !== selected))
			if (soft.size) highlight(trianglesOf(model, map, soft), false)
			if (selected == null) return
			// the clicked piece strongest, the part's other pieces softly
			const p = piece()
			const clicked = p && p.record === selected && p.model === model ? p.positions : null
			if (clicked) {
				highlight(trianglesOf(model, map, new Set([selected])), false)
				highlight(clicked, true)
			} else highlight(trianglesOf(model, map, new Set([selected])), true)
		})

		let pressed: {x: number; y: number} | null = null
		let hoverFrame = 0
		const onPointerDown = (e: PointerEvent) => {
			pressed = e.button === 0 ? {x: e.clientX, y: e.clientY} : null
		}
		const onPointerUp = (e: PointerEvent) => {
			if (!pressed || e.button !== 0) return
			const moved = Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y)
			pressed = null
			const map = props.sourceMap
			if (moved >= CLICK_SLOP_PX || !map || !props.model) return
			const hit = hitAt(e.clientX, e.clientY, e.altKey)
			setPiece(hit ? {record: hit.record, positions: pieceOf(props.model, map, hit.part, hit.tri), model: props.model} : null)
			props.onPick?.(hit?.record ?? null)
		}
		const onPointerMove = (e: PointerEvent) => {
			if (e.buttons) {
				setHover(null)
				return
			}
			cancelAnimationFrame(hoverFrame)
			const {clientX, clientY, altKey} = e
			hoverFrame = requestAnimationFrame(() => {
				const map = props.sourceMap
				const r = recordAt(clientX, clientY, altKey)
				canvas.style.cursor = r == null ? "" : "pointer"
				if (r == null || !map) return setHover(null)
				const rect = container.getBoundingClientRect()
				setHover({x: clientX - rect.left, y: clientY - rect.top, ...hoverText(map, r)})
			})
		}
		const onPointerLeave = () => {
			cancelAnimationFrame(hoverFrame)
			setHover(null)
		}
		canvas.addEventListener("pointerdown", onPointerDown)
		canvas.addEventListener("pointerup", onPointerUp)
		canvas.addEventListener("pointermove", onPointerMove)
		canvas.addEventListener("pointerleave", onPointerLeave)

		let disposed = false
		createEffect(() => {
			const model = props.model
			if (disposed || !model) return
			// one triangle soup, a geometry group per colour part
			const geometry = new THREE.BufferGeometry()
			geometry.setAttribute("position", new THREE.BufferAttribute(allPositions(model), 3))
			let start = 0
			partStarts = []
			model.parts.forEach((part, i) => {
				const count = part.positions.length / 3
				partStarts.push(start / 3)
				geometry.addGroup(start, count, i)
				start += count
			})
			geometry.computeVertexNormals() // flat: the soup shares no vertices

			const wasEmpty = !mesh
			if (mesh) {
				scene.remove(mesh)
				mesh.geometry.dispose()
			}
			for (const m of partMaterials) if (m !== material) m.dispose()
			partMaterials = model.parts.map(part => materialFor(part.color, material))
			mesh = new THREE.Mesh(geometry, partMaterials)
			scene.add(mesh)
			// Keep the camera where the user left it across edits, unless the part
			// is now a very different size (a first render of a placeholder, an
			// imported parameter arriving, a unit change): then the old framing
			// shows one face filling the view, or a speck.
			geometry.computeBoundingSphere()
			const r = geometry.boundingSphere?.radius ?? 0
			if (wasEmpty || needsReframe(framedRadius, r)) frameCamera(geometry)
		})

		onCleanup(() => {
			disposed = true
			cancelAnimationFrame(frameId)
			cancelAnimationFrame(hoverFrame)
			canvas.removeEventListener("pointerdown", onPointerDown)
			canvas.removeEventListener("pointerup", onPointerUp)
			canvas.removeEventListener("pointermove", onPointerMove)
			canvas.removeEventListener("pointerleave", onPointerLeave)
			clearHighlights()
			resizeObserver.disconnect()
			controls.dispose()
			renderer.dispose()
			mesh?.geometry.dispose()
			for (const m of partMaterials) if (m !== material) m.dispose()
			material.dispose()
		})
	})

	return (
		<div class="openscad-viewer-canvas" ref={el => (container = el)}>
			<canvas ref={el => (canvas = el)} />
			<Show when={hover()}>
				{h => (
					<div class="openscad-hover" style={{left: `${h().x + 14}px`, top: `${h().y + 14}px`}}>
						<strong>{h().label}</strong>
						<Show when={h().detail}>
							<span>{h().detail}</span>
						</Show>
					</div>
				)}
			</Show>
		</div>
	)
}
