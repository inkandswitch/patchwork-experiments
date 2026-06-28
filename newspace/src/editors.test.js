import { describe, it, expect } from "vitest";
import { getHeads, splice as amSplice } from "@automerge/automerge";
import { makeRepo, flush } from "./test-harness.js";
import { automergeOpstream } from "./opstreams.js";
import { defaultInlets, mountEditor } from "./editors.js";
import { mountCodemirror } from "./codemirror/sketchy-editor.js";

async function makeDoc(repo, initial) {
  const handle = repo.create();
  handle.change((d) => Object.assign(d, initial));
  await flush();
  return handle;
}

// the codemirror descriptor, as registered in index.jsx (load → the mount fn)
const codemirrorEditorDescriptor = {
  type: "sketchy:editor",
  id: "codemirror",
  name: "Code",
  supportedDatatypes: ["file", "*"],
  inlets: [
    { name: "content", type: "text", required: true },
    { name: "language", type: "language" },
  ],
  outlets: [{ name: "text", type: "text" }],
  load: async () => mountCodemirror,
};

describe("read-only opstream pinned at heads", () => {
  it("freezes the value at a past version and has NO apply", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "hello" });
    const past = getHeads(handle.doc());
    handle.change((d) => amSplice(d, ["content"], 5, 0, " world")); // move forward
    await flush();

    const live = automergeOpstream(handle, { path: ["content"] });
    const pinned = automergeOpstream(handle, { path: ["content"], heads: past });

    expect(live.value).toBe("hello world");
    expect(pinned.value).toBe("hello"); // frozen at the old heads
    expect(typeof live.apply).toBe("function");
    expect(pinned.apply).toBeUndefined(); // read-only = absence of apply
    expect(pinned.complement.heads).toEqual(past);
  });

  it("a pinned stream emits one snapshot on connect and never changes", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "v1" });
    const past = getHeads(handle.doc());
    const pinned = automergeOpstream(handle, { path: ["content"], heads: past });
    const seen = [];
    pinned.connect((o) => seen.push(o));
    handle.change((d) => amSplice(d, ["content"], 2, 0, "!")); // live edit
    await flush();
    expect(seen.length).toBe(1); // only the initial snapshot
    expect(pinned.value).toBe("v1");
  });
});

describe("defaultInlets", () => {
  it("builds a file text stream for a 'text' inlet", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "hi", mimeType: "text/plain" });
    const inlets = defaultInlets(codemirrorEditorDescriptor, handle);
    expect(inlets.content.value).toBe("hi");
    expect(inlets.content.complement.path).toEqual(["content"]);
    expect(inlets.language).toBeUndefined(); // language inlet has no doc source
  });

  it("pins inlets to heads when given (read-only)", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "first" });
    const past = getHeads(handle.doc());
    handle.change((d) => amSplice(d, ["content"], 5, 0, "!"));
    await flush();
    const inlets = defaultInlets(codemirrorEditorDescriptor, handle, { heads: past });
    expect(inlets.content.value).toBe("first");
    expect(inlets.content.apply).toBeUndefined();
  });
});

describe("mountEditor (the sketchy:editor mount path)", () => {
  it("mounts codemirror on a doc, edits round-trip, text outlet is exposed", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "abc", mimeType: "text/plain" });
    const element = document.createElement("div");
    document.body.append(element);
    const outlets = {};
    const cleanup = await mountEditor(codemirrorEditorDescriptor, { element, handle, outlets });

    // it mounted a codemirror view into the element
    const view = element.querySelector(".cm-editor");
    expect(view).toBeTruthy();
    // the text outlet is the content stream
    expect(outlets.text).toBeTruthy();
    expect(outlets.text.value).toBe("abc");
    // an edit through the outlet stream lands on the doc
    outlets.text.apply({ path: [], range: [3, 3], value: "d" });
    await flush();
    expect(handle.doc().content).toBe("abcd");

    cleanup();
  });

  it("mounts read-only when pinned at heads (no edits accepted)", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "frozen" });
    const past = getHeads(handle.doc());
    handle.change((d) => amSplice(d, ["content"], 6, 0, "!!"));
    await flush();
    const element = document.createElement("div");
    document.body.append(element);
    const cleanup = await mountEditor(codemirrorEditorDescriptor, { element, handle, heads: past });
    // editor shows the frozen value
    expect(element.querySelector(".cm-content")?.textContent).toContain("frozen");
    cleanup();
  });
});
