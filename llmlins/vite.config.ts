import { defineConfig } from "vite";
import { readFileSync, writeFileSync, existsSync } from "fs";

// Bump patch version in package.json on every build invocation
const pkgPath = new URL("./package.json", import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };
const [major, minor, patch] = pkg.version.split(".").map(Number);
pkg.version = `${major}.${minor}.${patch + 1}`;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
const buildVersion = pkg.version;

const pwSnapshotPath = new URL("./.pushwork/snapshot.json", import.meta.url).pathname;
let skillsFolderUrl = "";
if (existsSync(pwSnapshotPath)) {
  const snapshot = JSON.parse(readFileSync(pwSnapshotPath, "utf-8")) as {
    directories?: [string, { url: string }][];
  };
  const entry = (snapshot.directories ?? []).find(([name]) => name === "src/llmlin/skills");
  skillsFolderUrl = entry?.[1]?.url ?? "";
}

export default defineConfig({
  base: "./",
  plugins: [],
  define: {
    __BUILD_VERSION__: JSON.stringify(buildVersion),
    __SKILLS_FOLDER_URL__: JSON.stringify(skillsFolderUrl),
  },

  build: {
    minify: false,
    rollupOptions: {
      external(id) {
        return !!id.match(/^((@automerge\/automerge(-repo)?)|@inkandswitch\/.*)$/);
      },
      input: "./src/index.ts",
      output: {
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]",
      },
      preserveEntrySignatures: "strict",
    },
  },
});
