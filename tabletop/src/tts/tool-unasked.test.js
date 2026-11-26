// The TTS import tool with the real task kit, in a page with no account
// open, so no queue of theirs can be had: the drop is kept and its request
// written, and doWork's sentence saying why is shown as written; nothing is
// imported.
import { describe, it, expect, afterEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { FakeRepo } from "../test/fake-repo.js";
import { TtsImportDatatype } from "./datatype.js";
import TtsImportTool from "./tool.js";

const FIXTURE = join(process.cwd(), "fixtures/tiny-mod");
function fixtureFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name !== "README.md") {
        const f = new File([readFileSync(p)], name);
        Object.defineProperty(f, "webkitRelativePath", { value: relative(FIXTURE, p) });
        out.push(f);
      }
    }
  };
  walk(FIXTURE);
  return out;
}

const until = async (test, ms = 10000) => {
  const t0 = Date.now();
  while (!test()) {
    if (Date.now() - t0 > ms) throw new Error("not in time");
    await new Promise((r) => setTimeout(r, 10));
  }
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("an import asked by the real doWork with no account open", () => {
  it("keeps the drop and writes its request, then shows doWork's sentence as written; nothing is imported", async () => {
    const repo = new FakeRepo();
    const seed = { "@patchwork": { type: "tts-import" } };
    TtsImportDatatype.init(seed);
    const handle = repo.add(seed);
    const element = document.createElement("div");
    element.repo = repo;
    document.body.append(element);
    const unmount = TtsImportTool(handle, element);
    const e = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "dataTransfer", { value: { types: ["Files"], items: [], files: fixtureFiles() } });
    element.querySelector(".tts-import").dispatchEvent(e);
    await until(() => element.querySelector(".pill")?.textContent === "failed");
    expect(element.querySelector(".error").textContent).toBe("Task queues can only be kept from a Patchwork page with your account open.");
    expect(handle.doc().request).toBeTruthy();
    expect(handle.doc().imported).toBeNull();
    expect(repo.created.filter((h) => h.doc()["@patchwork"]?.type === "tabletop-game")).toEqual([]);
    unmount();
  });
});
