// Command line for one OpenSCAD run in the worker. Kept apart from worker.ts
// (which needs a worker global) so it can be tested in node; vite inlines it
// into the worker bundle.

/**
 * Manifold is chosen with `--backend=manifold`; CGAL is still OpenSCAD's
 * default and is orders of magnitude slower on CSG (a plate with 64 holes:
 * ~52 s on CGAL, ~0.26 s on Manifold, in the vendored engine).
 *
 * OFF carries a colour per face, and color() survives CSG on Manifold. The
 * engine could write 3MF too, but the tool writes its own (src/render/model.ts)
 * so that uncoloured parts stay unpainted.
 *
 * import() of a .json file returns its data without any flag in this
 * OpenSCAD; the old `--enable=import-function` is now ignored with a warning.
 */
export function openscadArgs(opts: {input: string; output: string}): string[] {
	return [opts.input, "--backend=manifold", "--export-format=off", "-o", opts.output]
}
