import { existsSync, rmSync, copyFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
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

// Copy .wasm files that bundled code needs at runtime
plugins.push({
  name: "copy-wasm",
  setup(build) {
    build.onEnd(() => {
      const outdir = build.initialOptions.outdir || "dist";
      mkdirSync(outdir, { recursive: true });
      const zbarWasm = resolve("node_modules/@undecaf/zbar-wasm/dist/zbar.wasm");
      if (existsSync(zbarWasm)) {
        copyFileSync(zbarWasm, resolve(outdir, "zbar.wasm"));
      }
    });
  },
});

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
  entryPoints: ["src/index.ts"],
  outdir: "dist",
  bundle: true,
  platform: "browser",
  format: "esm",
  splitting: true,
  logLevel: "info",
  sourcemap: !pushworking,
  external: externals,
  minify: false,
  plugins,
};
