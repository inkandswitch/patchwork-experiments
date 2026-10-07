// The implicit-surface language, end to end.
//
//   compile(source) -> { ir, program, warnings }       throws ImplicitError (located)
//   tryCompile(source) -> { ok: true, … } | { ok: false, error }
//
// Pipeline: tokenize -> parse -> check -> lower (IR) -> eval.js / glsl.js.
// There is no eval() or new Function() anywhere: user text is data.

import { ImplicitError, locate, formatError } from "./errors.js";
import { parse } from "./parse.js";
import { check, lower } from "./lower.js";

export { ImplicitError, formatError } from "./errors.js";
export { tokenize, UNITS } from "./tokenize.js";
export { parse } from "./parse.js";
export { makeEvaluator } from "./eval.js";
export { toGLSL, GLSL_HELPERS, glslFloat } from "./glsl.js";
export { BUILTINS, CONSTANTS, GROUP_LABELS, signature } from "./builtins.js";
export { formatIR } from "./ir.js";

export const MAX_SOURCE_LENGTH = 100_000;

/**
 * @param {string} source
 * @param {{ maxInstructions?: number }} [opts]
 */
export function compile(source, opts = {}) {
  const src = String(source ?? "");
  try {
    if (src.length > MAX_SOURCE_LENGTH)
      throw new ImplicitError(`The source is too long (${src.length} characters; the limit is ${MAX_SOURCE_LENGTH}).`, 0, 1);
    const program = parse(src);
    const warnings = check(program).map((w) => locate(Object.assign(new ImplicitError(w.message, w.start, w.end)), src));
    const ir = lower(program, { ...opts, sourceLength: src.length });
    return { ir, program, warnings };
  } catch (err) {
    if (err instanceof ImplicitError) throw locate(err, src);
    if (err instanceof RangeError) {
      // a stack overflow on absurd nesting: report it like any other error
      throw locate(new ImplicitError("This source is nested too deeply to evaluate.", 0, 1), src);
    }
    throw err;
  }
}

export function tryCompile(source, opts) {
  try {
    return { ok: true, ...compile(source, opts) };
  } catch (error) {
    if (error instanceof ImplicitError) return { ok: false, error, message: formatError(error) };
    throw error;
  }
}
