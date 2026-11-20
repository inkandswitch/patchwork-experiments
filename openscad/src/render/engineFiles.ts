// Where the OpenSCAD engine lives. It is vendored (vendor/<ENGINE_DIR>/) and
// the build copies it into dist/<ENGINE_DIR>/, next to the entry chunks, so
// the package carries its own engine: no CDN. The directory name carries the
// version, so a new engine is a new URL. See vendor/README.md.
//
// Imported by vite.config.ts as well as the engine, so keep it free of imports.

/** OpenSCAD nightly 2026.11.20 (git a70ba7bd), Manifold 3.5.4 */
export const ENGINE_DIR = "openscad-2026.11.20"
export const ENGINE_FILES = ["openscad.js", "openscad.wasm"] as const
