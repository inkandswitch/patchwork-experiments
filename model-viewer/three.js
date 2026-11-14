// three.js and its loaders, fetched on first use. esm.sh pins every loader to
// the same three build, so they all share one copy.
const V = "0.180.0";
const base = `https://esm.sh/three@${V}`;
const ex = (p) => import(/* @vite-ignore */ `${base}/examples/jsm/${p}`);

let p;
export function loadThree() {
  p ??= Promise.all([
    import(/* @vite-ignore */ base),
    ex("controls/OrbitControls.js"),
    ex("loaders/GLTFLoader.js"),
    ex("loaders/STLLoader.js"),
    ex("loaders/3MFLoader.js"),
    ex("loaders/OBJLoader.js"),
    ex("loaders/PLYLoader.js"),
    ex("environments/RoomEnvironment.js"),
  ]).then(([THREE, oc, gltf, stl, tmf, obj, ply, env]) => ({
    THREE,
    OrbitControls: oc.OrbitControls,
    GLTFLoader: gltf.GLTFLoader,
    STLLoader: stl.STLLoader,
    ThreeMFLoader: tmf.ThreeMFLoader,
    OBJLoader: obj.OBJLoader,
    PLYLoader: ply.PLYLoader,
    RoomEnvironment: env.RoomEnvironment,
  })).catch((e) => { p = null; throw e; });
  return p;
}
