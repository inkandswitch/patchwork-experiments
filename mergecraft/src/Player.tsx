import { useKeyboardControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import {
  CoefficientCombineRule,
  CylinderCollider,
  interactionGroups,
  RapierRigidBody,
  RigidBody,
  useRapier,
  Vector3Object,
} from "@react-three/rapier";
import { IfInSessionMode } from "@react-three/xr";
import { useRef } from "react";
import * as THREE from "three";

import { Model as Axe } from "./Axe.jsx";
import { VRPlayerControl } from "./VRPlayerControl";

const SPEED = 5;
// Minecraft-ish body: 1.8 tall, 0.6 wide. A *cylinder* (flat top/bottom) slides
// along walls and block tops far more cleanly than a capsule, whose rounded caps
// catch on the seams between adjacent fixed colliders. CylinderCollider(halfH,
// radius) → height = 2*halfH = 1.8, so the player just clears a 2-block gap. Eye
// sits near the top (1.62 above feet ≈ centre + 0.72) like Minecraft's camera.
const PLAYER_HALF_HEIGHT = 0.9;
const PLAYER_RADIUS = 0.3;
const EYE_OFFSET = 0.72;
const direction = new THREE.Vector3();
const frontVector = new THREE.Vector3();
const sideVector = new THREE.Vector3();
const rotation = new THREE.Vector3();

const vectorHelper = new THREE.Vector3();
const quaternionHelper = new THREE.Quaternion();
const eulerHelper = new THREE.Euler();
/** Reused to read yaw from camera quaternion (YXZ) without coupling to pitch from pointer-lock. */
const cameraYawEuler = new THREE.Euler();

export function Player({ lerp = THREE.MathUtils.lerp }) {
  const axe = useRef<THREE.Group>(null);
  const rigidBodyRef = useRef<RapierRigidBody>(null);
  const { rapier, world } = useRapier();
  const [, getKeys] = useKeyboardControls();

  const playerMove = ({
    forward,
    backward,
    left,
    right,
    rotationYVelocity,
    velocity,
    newVelocity,
  }: {
    forward: boolean;
    backward: boolean;
    left: boolean;
    right: boolean;
    rotationYVelocity: number;
    velocity?: Vector3Object;
    newVelocity?: THREE.Vector3;
  }) => {
    if (rigidBodyRef.current == null) {
      return;
    }
    if (!velocity) {
      velocity = rigidBodyRef.current?.linvel();
    }

    if (newVelocity) {
      // If we have a new velocity, we're in VR mode
      rigidBodyRef.current?.setLinvel(
        { x: newVelocity.x, y: velocity?.y ?? 0, z: newVelocity.z },
        true
      );
      return;
    }

    // Walk / strafe in the horizontal plane for this yaw (caller passes YXZ yaw, not rotation.y).
    eulerHelper.set(0, rotationYVelocity, 0, "YXZ");
    quaternionHelper.setFromEuler(eulerHelper);

    frontVector.set(0, 0, (backward ? 1 : 0) - (forward ? 1 : 0));
    sideVector.set((left ? 1 : 0) - (right ? 1 : 0), 0, 0);
    direction
      .subVectors(frontVector, sideVector)
      .normalize()
      .applyQuaternion(quaternionHelper)
      .setComponent(1, 0)
      .multiplyScalar(SPEED);
    rigidBodyRef.current?.setLinvel(
      { x: direction.x, y: velocity?.y ?? 0, z: direction.z },
      true
    );
  };

  const playerJump = () => {
    if (rigidBodyRef.current == null) {
      return;
    }
    const ray = world.castRay(
      new rapier.Ray(rigidBodyRef.current.translation(), { x: 0, y: -1, z: 0 }),
      Infinity,
      false,
      undefined,
      interactionGroups([1, 0], [1])
    );
    // Feet are `halfHeight` below the body centre; allow a small margin.
    const grounded =
      ray != null && Math.abs(ray.timeOfImpact) <= PLAYER_HALF_HEIGHT + 0.15;

    if (grounded) {
      rigidBodyRef.current.setLinvel({ x: 0, y: 7.5, z: 0 }, true);
    }
  };

  useFrame((state) => {
    if (rigidBodyRef.current == null) {
      return;
    }
    const { forward, backward, left, right, jump } = getKeys();
    const velocity = rigidBodyRef.current.linvel();

    vectorHelper.set(velocity.x, velocity.y, velocity.z);

    // update camera — eye level near the top of the body, not its centre
    const { x, y, z } = rigidBodyRef.current.translation();
    state.camera.position.set(x, y + EYE_OFFSET, z);

    // update axe
    if (axe.current != null) {
      axe.current.children[0].rotation.x = lerp(
        axe.current.children[0].rotation.x,
        Math.sin(
          (vectorHelper.length() > 1 ? 1 : 0) * state.clock.elapsedTime * 10
        ) / 6,
        0.1
      );
      axe.current.rotation.copy(state.camera.rotation);
      axe.current.position
        .copy(state.camera.position)
        .add(state.camera.getWorldDirection(rotation).multiplyScalar(1));
    }

    // movement — use YXZ yaw so WASD matches look direction after PointerLockControls adds pitch
    cameraYawEuler.setFromQuaternion(state.camera.quaternion, "YXZ");
    const yaw = cameraYawEuler.y;

    if (rigidBodyRef.current) {
      playerMove({
        forward,
        backward,
        left,
        right,
        rotationYVelocity: yaw,
        velocity,
      });

      if (jump) {
        playerJump();
      }
    }
  });

  return (
    <>
      <RigidBody
        ref={rigidBodyRef}
        colliders={false}
        mass={1}
        type="dynamic"
        position={[0, 10, 0]}
        enabledRotations={[false, false, false]}
        canSleep={false}
        collisionGroups={interactionGroups([0], [0])}
      >
        <CylinderCollider
          args={[PLAYER_HALF_HEIGHT, PLAYER_RADIUS]}
          friction={0}
          frictionCombineRule={CoefficientCombineRule.Min}
        />

        <IfInSessionMode allow={["immersive-ar", "immersive-vr"]}>
          <VRPlayerControl playerJump={playerJump} playerMove={playerMove} />
        </IfInSessionMode>
      </RigidBody>

      <IfInSessionMode deny="immersive-vr">
        <group
          ref={axe}
          onPointerMissed={(e) => {
            if (axe.current == null) {
              return;
            }
            axe.current.children[0].rotation.x = -0.5;
          }}
        >
          <Axe position={[0.3, -0.35, 0.5]} />
        </group>
      </IfInSessionMode>
    </>
  );
}
