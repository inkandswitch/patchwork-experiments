// Tests only: source.js loads rhino3dm from jsdelivr, which Node can't
// import. vitest.config.ts sends that URL here, to the same version installed
// as a devDependency (source.test.js checks the versions match).
import rhino3dm from "rhino3dm/rhino3dm.module.js";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const dir = dirname(createRequire(import.meta.url).resolve("rhino3dm/rhino3dm.wasm")) + "/";
export default (opts = {}) => rhino3dm({ ...opts, locateFile: (f) => dir + f });
