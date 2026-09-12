import { describe, expect, test } from "vitest";
import { requestedPath, servedAt, splitServed, topLevelNames, withoutHeads } from "./paths.js";

const URL_ = "automerge:wZkgNq3hJMwU78JfwPDojeZE3At";
const PINNED = `${URL_}#2PGRvDySwEtmX7f68hTwXb9jta9Y3F1jdj8HrNpaGUAPVLeNfw`;

describe("servedAt", () => {
  test("defaults to index.html, because a directory request is not served", () => {
    // Measured: asking the worker for a directory answers 500, not a fallback to index.html.
    expect(servedAt(URL_)).toBe("/automerge%3AwZkgNq3hJMwU78JfwPDojeZE3At/index.html");
  });

  test("keeps the separators inside a subpath but encodes each segment", () => {
    expect(servedAt(URL_, "sub/page.html")).toBe("/automerge%3AwZkgNq3hJMwU78JfwPDojeZE3At/sub/page.html");
    expect(servedAt(URL_, "a b/c.html")).toBe("/automerge%3AwZkgNq3hJMwU78JfwPDojeZE3At/a%20b/c.html");
  });

  test("an empty subpath asks for the document itself", () => {
    expect(servedAt(URL_, "")).toBe("/automerge%3AwZkgNq3hJMwU78JfwPDojeZE3At");
  });

  test("pinned heads survive the round trip", () => {
    expect(splitServed(servedAt(PINNED, "sub/page.html")).url).toBe(PINNED);
  });
});

describe("splitServed", () => {
  test("reads back a bare url", () => {
    expect(splitServed("/automerge%3AwZkgNq3hJMwU78JfwPDojeZE3At/sub/page.html")).toEqual({
      url: URL_,
      subpath: "sub/page.html",
    });
  });

  test("reads back a url the worker pinned heads onto", () => {
    expect(splitServed(servedAt(PINNED, "index.html"))).toEqual({ url: PINNED, subpath: "index.html" });
  });

  test("the document root has an empty subpath", () => {
    expect(splitServed("/automerge%3AwZkgNq3hJMwU78JfwPDojeZE3At")).toEqual({ url: URL_, subpath: "" });
  });

  test("anything that is not one of ours is not ours", () => {
    expect(splitServed("/")).toBe(null);
    expect(splitServed("/about.html")).toBe(null);
    expect(splitServed("/https%3A%2F%2Fexample.com/x")).toBe(null);
  });
});

describe("withoutHeads", () => {
  test("strips a pin, leaves a bare url alone", () => {
    expect(withoutHeads(PINNED)).toBe(URL_);
    expect(withoutHeads(URL_)).toBe(URL_);
  });
});

describe("topLevelNames", () => {
  test("a directory doc keys files by path", () => {
    expect(topLevelNames({ "@patchwork": { type: "directory" }, "index.html": {}, "sub/page.html": {}, "sub/x.css": {} }))
      .toEqual(["index.html", "sub"]);
  });

  test("a folder doc lists a document per entry", () => {
    expect(topLevelNames({ docs: [{ name: "b.html" }, { name: "a.html" }] })).toEqual(["a.html", "b.html"]);
  });

  test("a document's own fields are not files", () => {
    // pushwork sets lastSyncAt on a root document when a sync finishes. Reported from real
    // use: the viewer listed it among the repo's contents.
    expect(topLevelNames({ lastSyncAt: 1771461049774, title: "repo", content: "automerge:a", dist: "automerge:b" }))
      .toEqual(["content", "dist"]);
  });

  test("nothing sensible in, nothing out", () => {
    expect(topLevelNames(null)).toEqual([]);
    expect(topLevelNames({})).toEqual([]);
  });
});

describe("requestedPath", () => {
  const withAttr = (value) => {
    const view = document.createElement("patchwork-view");
    const inner = document.createElement("div");
    view.append(inner);
    document.body.append(view);
    if (value !== undefined) view.setAttribute("data-path", value);
    return inner;
  };

  test("reads where the embedding tool wants us to start", () => {
    expect(requestedPath(withAttr("alifib/index.html"))).toBe("alifib/index.html");
  });

  test("a leading slash is tolerated", () => {
    expect(requestedPath(withAttr("/alifib/index.html"))).toBe("alifib/index.html");
  });

  test("no attribute means no opinion — the viewer picks its own home", () => {
    expect(requestedPath(withAttr(undefined))).toBe(undefined);
    expect(requestedPath(withAttr(""))).toBe(undefined);
  });

  test("an element with no patchwork-view around it is not a crash", () => {
    expect(requestedPath(document.createElement("div"))).toBe(undefined);
    expect(requestedPath(null)).toBe(undefined);
  });
});
