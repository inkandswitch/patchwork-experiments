import {onMount, onCleanup, createEffect} from "solid-js"
import * as THREE from "three"
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls.js"
import {needsReframe} from "./framing"
import {allPositions, type Model, type RGBA} from "../render/model"

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

export function Viewer3D(props: {model: Model | null}) {
	let container!: HTMLDivElement
	let canvas!: HTMLCanvasElement

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

		let disposed = false
		createEffect(() => {
			const model = props.model
			if (disposed || !model) return
			// one triangle soup, a geometry group per colour part
			const geometry = new THREE.BufferGeometry()
			geometry.setAttribute("position", new THREE.BufferAttribute(allPositions(model), 3))
			let start = 0
			model.parts.forEach((part, i) => {
				const count = part.positions.length / 3
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
		</div>
	)
}
