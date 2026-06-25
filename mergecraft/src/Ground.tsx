import * as THREE from "three";
import { useTexture } from "@react-three/drei";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import grass from "./assets/grass.jpg";

export function Ground({ ...props }) {
  const texture = useTexture(grass);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return (
    <RigidBody {...props} type="fixed" colliders={false} friction={0}>
      {/* Surface sits at y = -0.5 so a cube whose *centre* is at an integer y
          (e.g. y = 0) rests on it — cube coordinates are whole numbers. The
          1000×1000 plane repeats the grass once per world unit so a tile lines
          up with a single block (the cube faces show one texture per unit too).
          `name="ground"` lets the crosshair raycaster place blocks on it. */}
      <mesh
        name="ground"
        receiveShadow
        position={[0, -0.5, 0]}
        rotation-x={-Math.PI / 2}
      >
        <planeGeometry args={[1000, 1000]} />
        <meshStandardMaterial
          map={texture}
          map-repeat={[1000, 1000]}
          color="green"
        />
      </mesh>
      <CuboidCollider args={[1000, 2, 1000]} position={[0, -2.5, 0]} />
    </RigidBody>
  );
}
