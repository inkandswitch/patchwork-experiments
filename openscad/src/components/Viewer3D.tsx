import {onMount, onCleanup, createEffect} from "solid-js"
import * as THREE from "three"
import {STLLoader} from "three/examples/jsm/loaders/STLLoader.js"
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls.js"

export function Viewer3D(props: {stl: Uint8Array | null}) {
	let container!: HTMLDivElement
	let canvas!: HTMLCanvasElement

	onMount(() => {
		const scene = new THREE.Scene()
		const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000)

		const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true})
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

		const controls = new OrbitControls(camera, renderer.domElement)
		controls.enableDamping = true
		controls.dampingFactor = 0.08

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

		camera.position.set(60, -90, 70)
		camera.up.set(0, 0, 1)
		camera.lookAt(0, 0, 0)
		controls.target.set(0, 0, 0)
		controls.update()

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

		function frameCamera(geometry: THREE.BufferGeometry) {
			geometry.computeBoundingSphere()
			const sphere = geometry.boundingSphere
			if (!sphere || !isFinite(sphere.radius) || sphere.radius === 0) return
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
			const stl = props.stl
			if (disposed || !stl) return
			const geometry = new STLLoader().parse(stl.buffer as ArrayBuffer)
			geometry.computeVertexNormals()

			const wasEmpty = !mesh
			if (mesh) {
				scene.remove(mesh)
				mesh.geometry.dispose()
			}
			mesh = new THREE.Mesh(geometry, material)
			scene.add(mesh)
			if (wasEmpty) frameCamera(geometry)
		})

		onCleanup(() => {
			disposed = true
			cancelAnimationFrame(frameId)
			resizeObserver.disconnect()
			controls.dispose()
			renderer.dispose()
			mesh?.geometry.dispose()
			material.dispose()
		})
	})

	return (
		<div class="openscad-viewer-canvas" ref={el => (container = el)}>
			<canvas ref={el => (canvas = el)} />
		</div>
	)
}
