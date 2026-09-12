import { describe, expect, test, vi } from "vitest";
import { describeRepo, onSelectedDoc, onToolStorage, subscribe, withoutHeads } from "./providers.js";
import { buildFor, recordBuild } from "./settings.js";

// A stand-in for the host: it receives the port the component sends and can push values back.
const fakeHost = () => {
  const listeners = new Set();
  const port1 = { postMessage: vi.fn(), close: vi.fn() };
  const port2 = {
    addEventListener: (_type, fn) => listeners.add(fn),
    removeEventListener: (_type, fn) => listeners.delete(fn),
    start: vi.fn(),
    postMessage: vi.fn(),
    close: vi.fn(),
  };
  return { port1, port2, send: (data) => listeners.forEach((fn) => fn({ data })) };
};

const mount = (attach) => {
  const host = fakeHost();
  const element = document.createElement("div");
  document.body.append(element);
  const events = [];
  element.addEventListener("patchwork:subscribe", (e) => events.push(e));
  const seen = [];
  const stop = attach(element, (v) => seen.push(v), { makeChannel: () => host });
  return { host, element, events, seen, stop };
};

describe("subscribe", () => {
  test("names the selector and hands the host a port", () => {
    const { events, host } = mount((el, cb, opts) => subscribe(el, { type: "patchwork:thing", extra: 1 }, cb, opts));
    expect(events).toHaveLength(1);
    expect(events[0].detail.selector).toEqual({ type: "patchwork:thing", extra: 1 });
    expect(events[0].detail.port).toBe(host.port1);
    // It has to bubble: the host listens on the <patchwork-view>, not on us.
    expect(events[0].bubbles).toBe(true);
  });

  test("ignores messages that are not a change", () => {
    const { host, seen } = mount((el, cb, opts) => subscribe(el, { type: "x" }, cb, opts));
    host.send({ type: "something-else", value: 1 });
    expect(seen).toEqual([]);
  });

  test("unsubscribing tells the host and stops listening", () => {
    const { host, seen, stop } = mount((el, cb, opts) => subscribe(el, { type: "x" }, cb, opts));
    stop();
    expect(host.port2.postMessage).toHaveBeenCalledWith({ type: "unsubscribe" });
    host.send({ type: "change", value: 1 });
    expect(seen).toEqual([]);
  });
});

describe("onSelectedDoc", () => {
  const attach = (el, cb, opts) => onSelectedDoc(el, cb, opts);

  test("asks for the selected doc", () => {
    const { events } = mount(attach);
    expect(events[0].detail.selector).toEqual({ type: "patchwork:selected-doc" });
  });

  test("reports the first of the selection", () => {
    const { host, seen } = mount(attach);
    host.send({ type: "change", value: ["automerge:abc", "automerge:def"] });
    expect(seen).toEqual(["automerge:abc"]);
  });

  test("an empty selection reports nothing selected", () => {
    const { host, seen } = mount(attach);
    host.send({ type: "change", value: [] });
    expect(seen).toEqual([undefined]);
  });

  test("strips the heads the service worker pins on", () => {
    const { host, seen } = mount(attach);
    host.send({ type: "change", value: ["automerge:abc#2PGRvDySwEtmX7f68hTwXb9jta9Y"] });
    expect(seen).toEqual(["automerge:abc"]);
  });
});

describe("onToolStorage", () => {
  const attach = (el, cb, opts) => onToolStorage(el, "cakewalk-build", cb, opts);

  test("asks for storage under this tool's id", () => {
    const { events } = mount(attach);
    expect(events[0].detail.selector).toEqual({ type: "patchwork:tool-storage", toolId: "cakewalk-build" });
  });

  test("reports the document the host made for us", () => {
    const { host, seen } = mount(attach);
    host.send({ type: "change", value: "automerge:storage" });
    expect(seen).toEqual(["automerge:storage"]);
  });

  test("nothing yet is a value too — the host creates it on first request", () => {
    const { host, seen } = mount(attach);
    host.send({ type: "change", value: undefined });
    expect(seen).toEqual([undefined]);
  });
});

describe("describeRepo", () => {
  const folder = (...names) => ({ docs: names.map((name) => ({ name, url: "automerge:x" })) });

  test("a folder repo with pages and templates is buildable", () => {
    expect(describeRepo(folder("content", "template", "system"))).toEqual({ buildable: true, reason: "" });
  });

  // The message that matters: a vfs repo HAS content/ and template/, so "not a CakeWalk repo"
  // would be true and useless. pushwork init defaults to this shape, so it is the one people hit.
  test("a vfs repo is named as a vfs repo, not as a non-repo", () => {
    const vfs = { "@patchwork": { type: "directory" }, content: "automerge:a", template: "automerge:b", lastSyncAt: 1 };
    const { buildable, reason } = describeRepo(vfs);
    expect(buildable).toBe(false);
    expect(reason).toMatch(/vfs/);
    expect(reason).toMatch(/--shape patchwork-folder/);
  });

  test("a document that is neither says the plain thing", () => {
    expect(describeRepo({ title: "a note", text: "hi" }).reason).toBe("Not a CakeWalk repo");
    expect(describeRepo(folder("README.md")).reason).toMatch(/no content\/ and template\//);
  });

  test("nothing selected", () => {
    expect(describeRepo(null)).toEqual({ buildable: false, reason: "Nothing selected" });
  });
});

describe("withoutHeads", () => {
  test("strips a pin, leaves the rest", () => {
    expect(withoutHeads("automerge:abc#heads")).toBe("automerge:abc");
    expect(withoutHeads("automerge:abc")).toBe("automerge:abc");
    expect(withoutHeads(undefined)).toBe(undefined);
  });
});

// --- settings ----------------------------------------------------------------------------------
// A stand-in handle: change() runs against a plain object, the way automerge's does.
const fakeHandle = (doc = {}) => ({ doc: () => doc, change: (fn) => fn(doc), url: "automerge:storage" });

describe("settings", () => {
  test("a repo with no build recorded has nothing to say", () => {
    expect(buildFor({ builds: {} }, "automerge:repo")).toBe(undefined);
    expect(buildFor(undefined, "automerge:repo")).toBe(undefined);
    expect(buildFor({ builds: { "automerge:repo": { outputUrl: "x" } } }, undefined)).toBe(undefined);
  });

  test("builds are keyed by the repo they came from", () => {
    const handle = fakeHandle();
    recordBuild(handle, "automerge:a", { outputUrl: "automerge:out-a" });
    recordBuild(handle, "automerge:b", { outputUrl: "automerge:out-b" });
    expect(buildFor(handle.doc(), "automerge:a").outputUrl).toBe("automerge:out-a");
    expect(buildFor(handle.doc(), "automerge:b").outputUrl).toBe("automerge:out-b");
  });

  test("recording merges rather than replaces, so the output document survives a status change", () => {
    const handle = fakeHandle();
    recordBuild(handle, "automerge:a", { outputUrl: "automerge:out", status: "ok" });
    recordBuild(handle, "automerge:a", { status: "building" });
    expect(buildFor(handle.doc(), "automerge:a")).toEqual({ outputUrl: "automerge:out", status: "building" });
  });

  test("undefined removes a field, because automerge has no undefined", () => {
    const handle = fakeHandle();
    recordBuild(handle, "automerge:a", { status: "error", log: ["boom"] });
    recordBuild(handle, "automerge:a", { log: undefined });
    expect(buildFor(handle.doc(), "automerge:a")).toEqual({ status: "error" });
  });
});
