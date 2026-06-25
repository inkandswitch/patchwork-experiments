import { type AutomergeUrl } from "@automerge/automerge-repo";
import { Canvas } from "@react-three/fiber";
import { Sky, PointerLockControls, KeyboardControls } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { createXRStore, XR } from "@react-three/xr";

import { Ground } from "./Ground";
import { Player } from "./Player";
import { Cubes } from "./Cube";

const keyboardMap = [
  { name: "forward", keys: ["ArrowUp", "w", "W"] },
  { name: "backward", keys: ["ArrowDown", "s", "S"] },
  { name: "left", keys: ["ArrowLeft", "a", "A"] },
  { name: "right", keys: ["ArrowRight", "d", "D"] },
  { name: "jump", keys: ["Space"] },
];

function Scene({ docUrl }: { docUrl: AutomergeUrl }) {
  const store = createXRStore();

  return (
    <Canvas shadows camera={{ fov: 75 }}>
      <XR store={store}>
        <Sky sunPosition={[100, 20, 100]} />
        <ambientLight intensity={1.5} />
        <pointLight castShadow intensity={2.5} position={[100, 100, 100]} />
        <Physics gravity={[0, -30, 0]}>
          <Ground />
          <Player />
          <Cubes docUrl={docUrl} />
        </Physics>
        <PointerLockControls />
      </XR>
    </Canvas>
  );
}

export default function App({ docUrl }: { docUrl: AutomergeUrl }) {
  const store = createXRStore();

  return (
    <>
      {/* Fixed crosshair at screen centre — marks where the raycast targets. */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: "20px",
          height: "20px",
          transform: "translate(-50%, -50%)",
          zIndex: 10000,
          pointerEvents: "none",
          background:
            "linear-gradient(white, white) center/2px 20px no-repeat," +
            "linear-gradient(white, white) center/20px 2px no-repeat",
          mixBlendMode: "difference",
        }}
      />
      <button
        style={{
          position: "absolute",
          zIndex: 10000,
          background: "black",
          borderRadius: "0.5rem",
          border: "none",
          fontWeight: "bold",
          color: "white",
          padding: "1rem 2rem",
          cursor: "pointer",
          fontSize: "1.5rem",
          bottom: "1rem",
          left: "50%",
          boxShadow: "0px 0px 20px rgba(0,0,0,1)",
          transform: "translate(-50%, 0)",
        }}
        onClick={() => store.enterVR()}
      >
        Enter VR
      </button>
      <KeyboardControls map={keyboardMap}>
        <Scene docUrl={docUrl} />
      </KeyboardControls>
    </>
  );
}
