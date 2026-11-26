// The TTS import tool with the real task kit, in a page with no account
// open, so no queue of theirs can be asked: doWork does the import in the
// page, importing the task's module by the url the tool names, and the doc
// ends up with the game and the report, shown; stopped, it ends with nothing
// written.
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

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  document.body.innerHTML = "";
});

function mounted({ fetchNow = false } = {}) {
  const repo = new FakeRepo();
  const seed = { "@patchwork": { type: "tts-import" } };
  TtsImportDatatype.init(seed);
  seed.settings.fetchNow = fetchNow;
  const handle = repo.add(seed);
  const element = document.createElement("div");
  element.repo = repo;
  document.body.append(element);
  const unmount = TtsImportTool(handle, element);
  const e = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", { value: { types: ["Files"], items: [], files: fixtureFiles() } });
  return { repo, handle, element, unmount, dropped: () => element.querySelector(".tts-import").dispatchEvent(e), $: (s) => element.querySelector(s) };
}

describe("an import done in this page by the real doWork", () => {
  it("drops, imports and shows the report", async () => {
    const { repo, handle, dropped, $ } = mounted();
    dropped();
    await until(() => handle.doc().imported);
    const d = handle.doc();
    expect(d.imported.id).toBe(d.request.id);
    expect(repo.handles.get(d.imported.gameUrl).doc()["@patchwork"].type).toBe("tabletop-game");
    expect(d.imported.report.counts.assets).toMatchObject({ cache: 8, web: 1, missing: 0 });
    await until(() => $(".pill")?.textContent === "imported");
    expect($("button.primary").textContent).toBe("Open the game");
  });

  it("closed while it imports (fetching the one asset not dropped): stopped, nothing is written", async () => {
    // a host that answers only when the fetch is cut off
    let fetching = false;
    let cutOff = false;
    globalThis.fetch = (url, init) =>
      new Promise((_, reject) => {
        fetching = true;
        init?.signal?.addEventListener("abort", () => ((cutOff = true), reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
      });
    const { repo, handle, dropped, unmount } = mounted({ fetchNow: true });
    dropped();
    await until(() => fetching);
    unmount();
    expect(cutOff).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(handle.doc().imported).toBeNull();
    expect(repo.created.filter((h) => h.doc()["@patchwork"].type === "tabletop-game")).toEqual([]);
  });
});
