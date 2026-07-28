import { useEffect, useState } from "react";
import { type AutomergeUrl, type UrlHeads } from "@automerge/automerge-repo";
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

// Module-level singleton — the button (rendered by `App`, outside the
// Canvas) and the `<XR>` session (rendered inside `Scene`) must share the
// exact same store instance, or `store.enterVR()` targets a session no one
// is listening to.
const store = createXRStore();

function Scene({
  docUrl,
  baselineHeads,
}: {
  docUrl: AutomergeUrl;
  baselineHeads?: UrlHeads;
}) {
  return (
    <Canvas id="mergecraft-canvas" shadows camera={{ fov: 75 }}>
      <XR store={store}>
        <Sky sunPosition={[100, 20, 100]} />
        <ambientLight intensity={1.5} />
        <pointLight castShadow intensity={2.5} position={[100, 100, 100]} />
        <Physics gravity={[0, -30, 0]}>
          <Ground />
          <Player />
          <Cubes docUrl={docUrl} baselineHeads={baselineHeads} />
        </Physics>
        {/* Restrict click-to-lock to the canvas itself, so clicking elsewhere on
            the page (e.g. other Patchwork tools) doesn't steal mouse input. */}
        <PointerLockControls selector="#mergecraft-canvas" />
      </XR>
    </Canvas>
  );
}

export default function App({
  docUrl,
  baselineHeads,
}: {
  docUrl: AutomergeUrl;
  baselineHeads?: UrlHeads;
}) {
  // Keystrokes inside the tool must not trigger host-app shortcuts. The
  // wrapper is focusable and grabs focus on mousedown, so key events target
  // it; we stop their propagation right there. KeyboardControls listens on
  // the wrapper itself (via `domElement`) rather than `window` — listeners on
  // the same node still fire when propagation is stopped, so the game keeps
  // its WASD/jump input while the host never sees the keys.
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!wrapper) return;
    // While the game has focus it owns the keyboard outright: stop the event
    // from reaching host-app listeners and cancel browser default actions
    // (e.g. Space/arrows scrolling the surrounding pane). Escape still exits
    // pointer lock — that's browser-enforced and not cancelable.
    const stop = (e: KeyboardEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };
    const types = ["keydown", "keyup", "keypress"] as const;
    for (const type of types) wrapper.addEventListener(type, stop);
    return () => {
      for (const type of types) wrapper.removeEventListener(type, stop);
    };
  }, [wrapper]);

  return (
    <div
      ref={setWrapper}
      tabIndex={0}
      onMouseDown={(e) => e.currentTarget.focus()}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        outline: "none",
      }}
    >
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
          borderRadius: "0.375rem",
          border: "none",
          fontWeight: "bold",
          color: "white",
          padding: "0.375rem 0.75rem",
          cursor: "pointer",
          fontSize: "0.8rem",
          bottom: "0.5rem",
          right: "0.5rem",
          boxShadow: "0px 0px 20px rgba(0,0,0,1)",
        }}
        onClick={() => store.enterVR()}
      >
        Enter VR
      </button>
      {wrapper && (
        <KeyboardControls map={keyboardMap} domElement={wrapper}>
          <Scene docUrl={docUrl} baselineHeads={baselineHeads} />
        </KeyboardControls>
      )}
    </div>
  );
}
