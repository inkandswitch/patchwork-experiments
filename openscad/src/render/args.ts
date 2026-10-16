// Command line for one OpenSCAD run in the worker. Kept apart from worker.ts
// (which needs a worker global) so it can be tested in node; vite inlines it
// into the worker bundle.

/**
 * The pinned openscad-wasm (0.0.4) is OpenSCAD 2025.07.18 with Manifold 3.1.1.
 * Manifold is chosen with `--backend=manifold`; CGAL is still the default and
 * is orders of magnitude slower on CSG (a plate with 64 holes: ~60 s on CGAL,
 * ~0.2 s on Manifold). The older `--enable=manifold` spelling is not a feature
 * in this build: OpenSCAD ignores it with a warning and renders with CGAL.
 */
export function openscadArgs(opts: {input: string; output: string; hasImports: boolean}): string[] {
	const args = [opts.input, "--backend=manifold"]
	// import() returning parsed JSON is the experimental "import-function" feature
	if (opts.hasImports) args.push("--enable=import-function")
	args.push("--export-format=binstl", "-o", opts.output)
	return args
}
