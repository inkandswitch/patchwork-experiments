import { accept, subscribe } from "@inkandswitch/patchwork-providers";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { listFiles, readFile, writeFile, writeSpec } from "../folder";
import { loadSkill } from "./skills";
import type { CapturedConsole, LoopApi } from "../types";

// Thrown by `giveUp(reason)` inside a generation script to abort the run with a
// human-readable reason. The loop catches it and marks the card "failed".
export class GiveUpSignal extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = "GiveUpSignal";
  }
}

// Build the API exposed to the loop's <script> blocks while it generates. The
// loop runs inside embark's bundle, so it gets embark's own `subscribe`/`accept`
// (no esm.sh needed) plus a file API bound to this card's folder. The activated
// effect does NOT get this object - it receives only `element` and imports any
// deps from esm.sh itself.
export function createLoopApi(
  element: ToolElement,
  folderUrl: AutomergeUrl,
  specUrl: AutomergeUrl,
  captured: CapturedConsole,
): LoopApi {
  const repo = element.repo;
  return {
    element,
    repo,
    subscribe,
    accept,
    loadSkill,
    writeFile: (path, content) => writeFile(repo, folderUrl, path, content),
    readFile: (path) => readFile(repo, folderUrl, path),
    listFiles: () => listFiles(repo, folderUrl),
    writeSpec: (markdown) => writeSpec(repo, specUrl, markdown),
    giveUp: (reason: string) => {
      throw new GiveUpSignal(reason);
    },
    console: captured,
  };
}

// Capture console output during a script eval so it can be replayed into the
// transcript and fed back to the model. Mirrors llm-canvas.
export function createCapturedConsole(): CapturedConsole {
  const output: string[] = [];
  return {
    log: (...args) => output.push(args.map(stringifyArg).join(" ")),
    error: (...args) => output.push("[error] " + args.map(stringifyArg).join(" ")),
    warn: (...args) => output.push("[warn] " + args.map(stringifyArg).join(" ")),
    info: (...args) => output.push(args.map(stringifyArg).join(" ")),
    flush() {
      const text = output.join("\n");
      output.length = 0;
      return text;
    },
  };
}

export function stringifyArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg, null, 2);
  } catch {
    return "[object]";
  }
}
