import { describe, it, expect } from "vitest";
import { makeRepo, flush } from "./test-harness.js";
import { FormTool } from "../src/form-tool.jsx";
import { automergeOpstream } from "../src/opstreams.js";

async function makeDoc(repo, initial) {
  const handle = repo.create();
  handle.change((d) => Object.assign(d, initial));
  await flush();
  return handle;
}

describe("FormTool", () => {
  it("renders an input per string/number field, skipping @patchwork", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, {
      title: "Hi",
      count: 3,
      "@patchwork": { type: "x" },
      nested: { a: 1 }, // non-scalar, skipped
    });
    const element = document.createElement("div");
    const cleanup = FormTool(handle, element);
    const inputs = element.querySelectorAll("input");
    expect(inputs.length).toBe(2); // title, count
    cleanup();
  });

  it("each input is a PORT carrying its automerge url + path", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { title: "Hi" });
    const element = document.createElement("div");
    const cleanup = FormTool(handle, element);
    const input = element.querySelector("input");
    expect(input.dataset.automergeUrl).toBe(handle.url);
    expect(JSON.parse(input.dataset.automergePath)).toEqual(["title"]);
    cleanup();
  });

  it("typing in an input writes to the doc", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { title: "Hi" });
    const element = document.createElement("div");
    const cleanup = FormTool(handle, element);
    const input = element.querySelector("input");
    input.value = "Hello";
    input.dispatchEvent(new Event("input"));
    await flush();
    expect(handle.doc().title).toBe("Hello");
    cleanup();
  });

  it("the port markers reconstruct an opstream at that path", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { title: "Hi" });
    const element = document.createElement("div");
    const cleanup = FormTool(handle, element);
    const input = element.querySelector("input");
    // what the wire brush will do: read the markers, build an opstream
    expect(input.dataset.automergeUrl).toBe(handle.url);
    const path = JSON.parse(input.dataset.automergePath);
    const stream = automergeOpstream(handle, { path });
    expect(stream.value).toBe("Hi");
    cleanup();
  });

  it("remote changes update non-focused inputs", async () => {
    const repo = makeRepo();
    const handle = await makeDoc(repo, { title: "Hi" });
    const element = document.createElement("div");
    document.body.append(element);
    const cleanup = FormTool(handle, element);
    handle.change((d) => (d.title = "Remote"));
    await flush();
    expect(element.querySelector("input").value).toBe("Remote");
    cleanup();
  });
});
