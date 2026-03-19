import { existsSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { execSync } from "node:child_process";
import externals from "@inkandswitch/patchwork-bootloader/externals";

const pushworking = process.argv.includes("pushwork") || process.env.PUSHWORK;

// Files to preserve across dist/ cleans (empd WASM build output)
const WASM_FILES = ["empd.js", "empd.wasm"];

/** @type {import("esbuild").Plugin[]} */
const plugins = [
  {
    name: "preserve wasm and empty outdir",
    setup(build) {
      let saved = {};
      build.onStart(() => {
        const { outdir } = build.initialOptions;
        if (!outdir || !existsSync(outdir)) return;
        // Save WASM files before cleaning
        for (const f of WASM_FILES) {
          const path = `${outdir}/${f}`;
          if (existsSync(path)) {
            saved[f] = readFileSync(path);
          }
        }
        rmSync(outdir, { recursive: true });
      });
      build.onEnd(() => {
        const { outdir } = build.initialOptions;
        if (!outdir) return;
        mkdirSync(outdir, { recursive: true });
        // Restore WASM files after build
        for (const [f, data] of Object.entries(saved)) {
          writeFileSync(`${outdir}/${f}`, data);
        }
        saved = {};
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
  entryPoints: ["src/puredata.js", "src/pd-editor.js"],
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
