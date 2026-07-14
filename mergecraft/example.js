// Example document for fresh accounts (aggregated into the bundle's init.js):
// a small step pyramid to land next to, instead of the default lone cube.
// Standalone: builds the doc shape inline instead of going through the
// plugin registry.

export default async function example(repo) {
  const handle = await repo.create2({
    "@patchwork": {
      type: "mergecraft",
      suggestedImportUrl: new URL("./dist/index.js", import.meta.url).href,
    },
    title: "Mergecraft",
    cubes: pyramid(0, -10),
  });

  return { name: "Mergecraft", type: "mergecraft", url: handle.url };
}

// 5x5 base, 3x3 middle, single capstone, centred on (cx, ground y=0, cz).
function pyramid(cx, cz) {
  const cubes = [];
  for (let layer = 0; layer < 3; layer++) {
    const half = 2 - layer;
    for (let x = -half; x <= half; x++) {
      for (let z = -half; z <= half; z++) {
        cubes.push([cx + x, layer, cz + z]);
      }
    }
  }
  return cubes;
}
