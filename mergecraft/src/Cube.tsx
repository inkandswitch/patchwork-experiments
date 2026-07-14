import { useCallback, useEffect, useMemo, useRef } from "react";
import { AutomergeUrl } from "@automerge/automerge-repo";
import { useDocument } from "@automerge/automerge-repo-react-hooks";

import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import { RigidBody } from "@react-three/rapier";
import * as THREE from "three";

import { Doc } from "./datatype";

import dirt from "./assets/dirt.jpg?url";

// This is a naive implementation and wouldn't allow for more than a few thousand boxes.
// In order to make this scale this has to be one instanced mesh, then it could easily be
// hundreds of thousands.

type Cell = [number, number, number];

export const Cubes = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const [doc, changeDoc] = useDocument<Doc>(docUrl);

  const addCube = useCallback(
    (x: number, y: number, z: number) =>
      changeDoc((doc) => {
        const exists = doc.cubes.some(
          (c) => c[0] === x && c[1] === y && c[2] === z
        );
        if (!exists) doc.cubes.push([x, y, z]);
      }),
    [changeDoc]
  );
  const removeCube = useCallback(
    (x: number, y: number, z: number) =>
      changeDoc((doc) => {
        const index = doc.cubes.findIndex(
          (coords) => coords[0] === x && coords[1] === y && coords[2] === z
        );
        if (index !== -1) doc.cubes.splice(index, 1);
      }),
    [changeDoc]
  );

  if (!doc) {
    return null;
  }

  const cubes = doc.cubes || [];
  return (
    <>
      {/* Key by coordinate, not array index: a fixed Rapier body reads `position`
          only at mount, so index keys make in-place coordinate edits invisible and
          mid-list splices reshuffle every later body (flicker). Coordinate keys mean
          each cube mounts/unmounts exactly when it appears/disappears and survivors
          keep their identity (and position) untouched. */}
      {cubes.map((coords) => (
        <Cube key={`${coords[0]},${coords[1]},${coords[2]}`} position={coords} />
      ))}
      <BlockTargeting addCube={addCube} removeCube={removeCube} />
    </>
  );
};

function Cube({ position }: { position: Cell }) {
  const texture = useTexture(dirt);
  return (
    <RigidBody position={position} type="fixed" colliders="cuboid" friction={0}>
      {/* `name="cube"` tags this mesh for the crosshair raycaster; its cell is
          read back from the mesh's world position so nothing can drift. */}
      <mesh name="cube" receiveShadow castShadow>
        <boxGeometry />
        <meshStandardMaterial map={texture} />
      </mesh>
    </RigidBody>
  );
}

/**
 * Minecraft-style crosshair targeting. Every frame we cast a ray from the centre
 * of the screen (not the pointer) and pick the nearest tagged block or the
 * ground, so the highlight stays correct as the player *moves* or the *world*
 * changes — not just when the mouse moves. Left click removes the targeted
 * block; right click places one on the hit face (or on the ground).
 */
function BlockTargeting({
  addCube,
  removeCube,
}: {
  addCube: (x: number, y: number, z: number) => void;
  removeCube: (x: number, y: number, z: number) => void;
}) {
  const { camera, scene, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const screenCentre = useMemo(() => new THREE.Vector2(0, 0), []);
  const worldPos = useMemo(() => new THREE.Vector3(), []);
  const worldNrm = useMemo(() => new THREE.Vector3(), []);
  const target = useRef<{ remove: Cell | null; place: Cell | null }>({
    remove: null,
    place: null,
  });

  // A Minecraft-style selection cage. WebGL line primitives are locked to 1px
  // (LineBasicMaterial.linewidth is ignored), so the 12 edges are real, thick
  // box meshes instead — depth-test off + high render order so they read
  // clearly on top of the block they frame.
  const highlight = useMemo(() => {
    const group = new THREE.Group();
    group.visible = false;
    group.frustumCulled = false;
    const mat = new THREE.MeshBasicMaterial({
      color: 0x111111,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    });
    const t = 0.025; // bar thickness
    const L = 1 + t; // edge length, overlapping slightly at the corners
    const half = 0.5;
    const addBar = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.renderOrder = 999;
      m.raycast = () => {}; // never a raycast target itself
      group.add(m);
    };
    for (const y of [-half, half]) for (const z of [-half, half]) addBar(L, t, t, 0, y, z);
    for (const x of [-half, half]) for (const z of [-half, half]) addBar(t, L, t, x, 0, z);
    for (const x of [-half, half]) for (const y of [-half, half]) addBar(t, t, L, x, y, 0);
    return group;
  }, []);

  useEffect(
    () => () => {
      highlight.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    },
    [highlight]
  );

  useFrame(() => {
    raycaster.setFromCamera(screenCentre, camera);
    const hits = raycaster.intersectObjects(scene.children, true);

    let hi: Cell | null = null;
    target.current = { remove: null, place: null };

    for (const hit of hits) {
      const o = hit.object;
      if (o === highlight) continue;

      if (o.name === "cube") {
        o.getWorldPosition(worldPos);
        const cell: Cell = [
          Math.round(worldPos.x),
          Math.round(worldPos.y),
          Math.round(worldPos.z),
        ];
        let place: Cell = cell;
        if (hit.face) {
          worldNrm.copy(hit.face.normal).transformDirection(o.matrixWorld);
          place = [
            cell[0] + Math.round(worldNrm.x),
            cell[1] + Math.round(worldNrm.y),
            cell[2] + Math.round(worldNrm.z),
          ];
        }
        target.current = { remove: cell, place };
        hi = cell;
        break;
      }

      if (o.name === "ground" && hit.point) {
        const cell: Cell = [Math.round(hit.point.x), 0, Math.round(hit.point.z)];
        target.current = { remove: null, place: cell };
        hi = cell;
        break;
      }
    }

    if (hi) {
      highlight.visible = true;
      highlight.position.set(hi[0], hi[1], hi[2]);
    } else {
      highlight.visible = false;
    }
  });

  useEffect(() => {
    // Listen on `document` with `mousedown` (fires reliably under pointer lock,
    // unlike a listener bound to the canvas element). Gate only on *some* lock
    // being active — not a specific element, since PointerLockControls may lock
    // an element other than `gl.domElement`. That means we act exactly while in
    // first-person look mode, so stray UI clicks (and the click that engages the
    // lock) never edit the world.
    const onMouseDown = (e: MouseEvent) => {
      if (!document.pointerLockElement) return;
      const { remove, place } = target.current;
      if (e.button === 0 && remove) removeCube(...remove);
      else if (e.button === 2 && place) addCube(...place);
    };
    const onContextMenu = (e: Event) => e.preventDefault();
    document.addEventListener("mousedown", onMouseDown);
    gl.domElement.addEventListener("contextmenu", onContextMenu);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      gl.domElement.removeEventListener("contextmenu", onContextMenu);
    };
  }, [gl, addCube, removeCube]);

  return <primitive object={highlight} />;
}
