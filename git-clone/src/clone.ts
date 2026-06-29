import LightningFS from "@isomorphic-git/lightning-fs";
import * as git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { DEFAULT_CORS_PROXY } from "./datatype";

export type FileBlob = { path: string; bytes: Uint8Array };

export type CloneResult = {
  files: FileBlob[];
  repoName: string;
};

export type CloneOptions = {
  url: string;
  ref?: string;
  corsProxy?: string;
  /** Shallow clone depth. 1 = just the tip (no history). */
  depth?: number;
  onProgress?: (message: string) => void;
};

/**
 * Clone a git repository entirely in the browser (via isomorphic-git + a CORS
 * proxy) and return its working-tree files. Git history and the `.git`
 * directory are intentionally discarded — pushwork stores a working-tree
 * snapshot, not git objects.
 */
export async function cloneRepo(opts: CloneOptions): Promise<CloneResult> {
  const {
    url,
    ref,
    corsProxy = DEFAULT_CORS_PROXY,
    depth = 1,
    onProgress,
  } = opts;

  if (!url.trim()) throw new Error("A repository URL is required");

  // Each clone gets a throwaway in-memory (IndexedDB-backed) filesystem so
  // concurrent or repeated clones don't collide.
  const fsName = `git-clone-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const fs = new LightningFS(fsName, { wipe: true });
  const dir = "/repo";

  try {
    onProgress?.(`Cloning ${url}${ref ? `@${ref}` : ""}…`);
    await git.clone({
      fs,
      http,
      dir,
      url: url.trim(),
      corsProxy,
      ref: ref?.trim() || undefined,
      singleBranch: true,
      depth,
      onMessage: (message) => {
        const trimmed = message.trim();
        if (trimmed) onProgress?.(trimmed);
      },
      onProgress: (p) => {
        if (!p.phase) return;
        const total = p.total ? `/${p.total}` : "";
        onProgress?.(`${p.phase} ${p.loaded}${total}`);
      },
    });

    onProgress?.("Reading working tree…");
    const files: FileBlob[] = [];
    await walk(fs.promises, dir, "", files);
    onProgress?.(`Read ${files.length} files`);

    return { files, repoName: deriveRepoName(url) };
  } finally {
    // LightningFS persists to IndexedDB under `fsName`; drop it so clones don't
    // accumulate storage.
    try {
      indexedDB?.deleteDatabase(fsName);
    } catch {
      // best-effort cleanup
    }
  }
}

type PromisifiedFS = LightningFS["promises"];

async function walk(
  pfs: PromisifiedFS,
  base: string,
  rel: string,
  out: FileBlob[],
): Promise<void> {
  const fullDir = rel ? `${base}/${rel}` : base;
  const entries = await pfs.readdir(fullDir);
  for (const name of entries) {
    if (name === ".git") continue;
    const childRel = rel ? `${rel}/${name}` : name;
    const childFull = `${base}/${childRel}`;
    const stat = await pfs.stat(childFull);
    if (stat.isDirectory()) {
      await walk(pfs, base, childRel, out);
    } else if (stat.isFile()) {
      const data = await pfs.readFile(childFull);
      const bytes =
        data instanceof Uint8Array
          ? data
          : new TextEncoder().encode(String(data));
      out.push({ path: childRel, bytes });
    }
    // symlinks and other node types are skipped
  }
}

function deriveRepoName(url: string): string {
  const cleaned = url.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const last = cleaned.split(/[/:]/).filter(Boolean).pop();
  return last || "repo";
}
