import { describe, it, expect } from "vitest";
import { splice as amSplice } from "@automerge/automerge";
import { makeRepo, flush } from "../test-harness.js";
import { Opstream, automergeOpstream, fileTextOpstream, splice } from "../opstreams.js";
import { opstreamPlugin } from "./opstream-plugin.js";
import { languageFor } from "./languages.js";
import { codemirrorEditor } from "./editor.js";
import { EditorView } from "@codemirror/view";

async function makeDoc(repo, initial) {
  const handle = repo.create();
  handle.change((d) => Object.assign(d, initial));
  await flush();
  return handle;
}

function mountView(opstream, doc) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    doc: doc ?? (typeof opstream.value === "string" ? opstream.value : ""),
    parent,
    extensions: [opstreamPlugin(opstream)],
  });
  return { view, parent };
}

describe("languageFor", () => {
  it("maps mime / extension to a language extension (or null) — async, lazy-loaded packs", async () => {
    expect(await languageFor({ mimeType: "text/markdown" })).toBeTruthy();
    expect(await languageFor({ name: "a.js" })).toBeTruthy();
    expect(await languageFor({ extension: "css" })).toBeTruthy();
    expect(await languageFor({ extension: "json" })).toBeTruthy();
    expect(await languageFor({ mimeType: "text/plain" })).toBe(null);
  });
});

describe("opstreamPlugin <-> EditorView", () => {
  it("a local edit in CodeMirror flows to the opstream", async () => {
    const src = new Opstream("hello");
    const { view } = mountView(src);
    view.dispatch({ changes: { from: 5, insert: " world" } }); // type " world" at end
    expect(src.value).toBe("hello world");
    view.destroy();
  });

  it("an op applied to the opstream updates the editor (remote), no echo back", async () => {
    const src = new Opstream("hello");
    const { view } = mountView(src);
    src.apply(splice([], 0, 5, "HELLO")); // remote-style edit
    expect(view.state.doc.toString()).toBe("HELLO");
    // and the editor didn't bounce it back as a second op (value stays consistent)
    expect(src.value).toBe("HELLO");
    view.destroy();
  });

  it("multiple changes in one transaction land at the right offsets", () => {
    const src = new Opstream("abcdef");
    const { view } = mountView(src);
    // delete 'b' (1..2) AND insert 'Z' at end (6) in a single transaction
    view.dispatch({ changes: [{ from: 1, to: 2 }, { from: 6, insert: "Z" }] });
    expect(view.state.doc.toString()).toBe("acdefZ");
    expect(src.value).toBe("acdefZ");
    view.destroy();
  });
});

describe("full stack: automerge doc → opstream → codemirror → doc", () => {
  it("typing in the editor splices the automerge text field", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "hi", keep: 1 });
    const stream = automergeOpstream(handle, { path: ["content"] });
    const { view } = mountView(stream);
    view.dispatch({ changes: { from: 2, insert: "!" } });
    await flush();
    expect(handle.doc().content).toBe("hi!");
    expect(handle.doc().keep).toBe(1);
    view.destroy();
  });

  it("a remote automerge edit appears in the editor (cursor-stable path)", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { content: "abc" });
    const stream = automergeOpstream(handle, { path: ["content"] });
    const { view } = mountView(stream);
    handle.change((d) => amSplice(d, ["content"], 1, 0, "X")); // another peer
    await flush();
    expect(view.state.doc.toString()).toBe("aXbc");
    view.destroy();
  });
});

describe("codemirrorEditor (reads the complement)", () => {
  it("builds an editor and picks the language from complement mimeType", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, {
      content: "# hi",
      mimeType: "text/markdown",
      name: "n.md",
      extension: "md",
    });
    let exported = null;
    const stream = fileTextOpstream(handle, { save: () => (exported = stream.value) });
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = codemirrorEditor(stream, { parent });
    expect(editor.view.state.doc.toString()).toBe("# hi");
    expect(editor.complement.mimeType).toBe("text/markdown");
    expect(typeof editor.save).toBe("function"); // capability surfaced from the complement
    // a local edit round-trips to the doc
    editor.view.dispatch({ changes: { from: 4, insert: "!" } });
    await flush();
    expect(handle.doc().content).toBe("# hi!");
    editor.save();
    expect(exported).toBe("# hi!"); // the save() capability sees the edited value
    editor.destroy();
  });
});
