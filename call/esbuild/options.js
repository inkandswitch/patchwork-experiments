import { existsSync, rmSync } from "node:fs";
import process from "node:process";
import { execSync } from "node:child_process";
import externals from "@inkandswitch/patchwork-bootloader/externals";

const pushworking = process.argv.includes("pushwork") || process.env.PUSHWORK;

/** @type {import("esbuild").Plugin[]} */
const plugins = [
  {
    name: "empty outdir",
    setup(build) {
      build.onStart(() => {
        const { outdir } = build.initialOptions;
        if (outdir && existsSync(outdir)) rmSync(outdir, { recursive: true });
      });
    },
  },
];

if (pushworking) {
  plugins.push({
    name: "pushwork",
    setup(build) {
      if (!existsSync(".pushwork")) {
        console.warn("no .pushwork directory! run `pushwork init .` first");
        return;
      }
      build.onEnd((result) => {
        if (result.errors.length) {
          console.warn("esbuild errors! skipping pushwork sync");
          return;
        }
        try {
          execSync("pushwork sync", { stdio: "inherit" });
        } catch (error) {
          console.warn(error.message);
        }
      });
    },
  });
}

/** @type {import("esbuild").BuildOptions} */
export default {
  entryPoints: ["src/call.js", "src/telephone.js", "src/teleprint.js", "src/worker.js"],
  outdir: "dist",
  bundle: true,
  platform: "browser",
  format: "esm",
  splitting: true,
  logLevel: "debug",
  sourcemap: !pushworking,
  external: externals,
  minify: false,
  plugins,
};
