// three.js and its loaders, loaded on first use. They ship in the package's
// build; every loader imports the same "three", so they share one copy.
let p;
export function loadThree() {
  p ??= Promise.all([
    import("three"),
    import("three/examples/jsm/controls/OrbitControls.js"),
    import("three/examples/jsm/loaders/GLTFLoader.js"),
    import("three/examples/jsm/loaders/STLLoader.js"),
    import("three/examples/jsm/loaders/3MFLoader.js"),
    import("three/examples/jsm/loaders/OBJLoader.js"),
    import("three/examples/jsm/loaders/PLYLoader.js"),
    import("three/examples/jsm/environments/RoomEnvironment.js"),
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
