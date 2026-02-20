import { rmSync } from "node:fs";
import options from "./options.js";
import * as esbuild from "esbuild";
rmSync("dist", { recursive: true, force: true });
esbuild.build(options);
