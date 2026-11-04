/**
 * Documents in a pushwork folder, read from disk. pushwork syncs every Patchwork-typed .json file as that document
 * and every other file as a file document; `pushwork heads` lists each one's path, URL and heads, which is how a URL
 * in a link is found on disk without the network.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { documentUrl, parseRef, type Loader } from "../src/engine/links.ts";
import type { AutomergeUrl } from "../src/types.ts";

export type LocalEntry = { path: string; url: AutomergeUrl; heads: string[] };

export class LocalDocs {
  readonly root: string;
  private entries: LocalEntry[] = [];

  constructor(root: string) {
    this.root = root;
    this.refresh();
  }

  /** The folder a file or directory sits in, or undefined outside one. */
  static near(from: string): LocalDocs | undefined {
    const root = pushworkRoot(from);
    return root ? new LocalDocs(root) : undefined;
  }

  /** Re-reads the listing; with `save`, commits the working tree first so heads describe what is on disk. */
  refresh(save = false): void {
    if (save) pushwork(this.root, ["save"]);
    this.entries = pushwork(this.root, ["heads"])
      .split("\n")
      .map((line) => line.split("\t"))
      .filter((parts) => parts.length >= 2 && parts[0] !== "/" && parts[1].startsWith("automerge:"))
      .map(([file, url, heads]) => ({ path: file.replace(/^\//, ""), url: bare(url as AutomergeUrl), heads: (heads ?? "").split(" ").filter(Boolean) }));
  }

  /** The URL of a file in the folder, pinned to its current heads when asked. Saves first when it has to. */
  urlOf(file: string, { pin = false } = {}): AutomergeUrl {
    const relative = this.relative(file);
    if (pin || !this.find(relative)) this.refresh(true);
    const entry = this.find(relative);
    if (!entry) throw new Error(`${relative} is not in the pushwork folder ${this.root} (is it ignored?)`);
    return pin ? `${entry.url}#${entry.heads.join("|")}` : entry.url;
  }

  entryOf(url: string): LocalEntry | undefined {
    const { documentId } = parseRef(url);
    return this.entries.find((entry) => parseRef(entry.url).documentId === documentId);
  }

  pathOf(url: string): string | undefined {
    const entry = this.entryOf(url);
    return entry && path.join(this.root, entry.path);
  }

  /** Every document in the folder, by absolute path. */
  all(): (LocalEntry & { file: string })[] {
    return this.entries.map((entry) => ({ ...entry, file: path.join(this.root, entry.path) }));
  }

  /** Reads linked documents from disk; URLs outside the folder go to `fallback`. Pins are checked by `sf check --provenance`, not here. */
  loader(fallback?: Loader): Loader {
    return async (url) => {
      const file = this.pathOf(url);
      if (file) return readLocal(file);
      if (fallback) return fallback(url);
      throw new Error(`${url} is not in the pushwork folder ${this.root}`);
    };
  }

  private find(relative: string): LocalEntry | undefined {
    return this.entries.find((entry) => entry.path === relative);
  }

  private relative(file: string): string {
    return path.relative(this.root, path.resolve(file)).split(path.sep).join("/");
  }
}

/** A JSON file as its value; any other file as a stand-in naming its path. */
export function readLocal(file: string): unknown {
  if (file.endsWith(".json")) return JSON.parse(readFileSync(file, "utf8"));
  return { "@patchwork": { type: "file" }, path: file };
}

export function pushworkRoot(from: string): string | undefined {
  let dir = path.resolve(from);
  if (existsSync(dir) && !statSync(dir).isDirectory()) dir = path.dirname(dir);
  for (;;) {
    if (existsSync(path.join(dir, ".pushwork", "config.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function bare(url: AutomergeUrl): AutomergeUrl {
  return documentUrl({ ...parseRef(url), heads: undefined });
}

function pushwork(cwd: string, args: string[]): string {
  try {
    return execFileSync(process.env.PUSHWORK_BIN ?? "pushwork", ["--porcelain", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`pushwork ${args.join(" ")} failed in ${cwd}${stderr ? `: ${stderr}` : ""}`);
  }
}
