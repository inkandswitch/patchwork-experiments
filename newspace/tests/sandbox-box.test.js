import { describe, it, expect, vi } from "vitest";
import { mountSandbox, bootstrapSrc, guestApply, makeOutSink } from "../src/sandbox-box.js";
import { Source, Opstream, apply } from "../src/opstreams.js";
import { snapshot } from "../src/ops.js";
import { serveOpstreamOverPort } from "../src/port-opstream.js";
import { serveBoundary } from "../src/boundary.js";

// capture the outlet a node registers (js-node.test.js's helper)
function capture() {
  let out = null;
  return { setOutlet: (_name, s) => { out = s; }, get out() { return out; } };
}

// ── guestApply: the iframe realm's patcher must MIRROR the host `apply` ──────
// (its source is inlined into the bootstrap via toString, so this tested function
// IS what runs in the guest)
describe("guestApply mirrors the host op patcher", () => {
  const cases = [
    ["text splice", "hello", { path: [], range: [5, 5], value: " world" }],
    ["text delete", "hello", { path: [], range: [0, 2] }],
    ["array splice", [1, 2, 3], { path: [], range: [1, 2], value: [9, 9] }],
    ["array element delete (key + no value)", [1, 2, 3], { path: [], range: 1 }],
    ["object assign", { a: 1 }, { path: [], range: "b", value: 2 }],
    ["object key delete", { a: 1, b: 2 }, { path: [], range: "b" }],
    ["nested path", { a: { b: [1, 2] } }, { path: ["a", "b"], range: [2, 2], value: [3] }],
    ["negative index write", [10, 20, 30], { path: [], range: -1, value: 99 }],
    ["text splice under a path", { doc: { content: "abc" } }, { path: ["doc", "content"], range: [3, 3], value: "!" }],
    ["seed a text buffer from nothing", undefined, { path: [], range: [0, 0], value: "hi" }],
  ];
  for (const [name, value, op] of cases) {
    it(name, () => {
      expect(guestApply(value, op)).toEqual(apply(value, op));
    });
  }
  it("bytes splice mirrors too (Uint8Array crosses the port as a transferable)", () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const op = { path: [], range: [1, 1], value: Uint8Array.from([9]) };
    expect(guestApply(bytes, op)).toEqual(apply(bytes, op));
    expect(guestApply(bytes, op)).toBeInstanceOf(Uint8Array);
  });
  it("is COW — the input value is not mutated", () => {
    const v = { a: [1, 2] };
    guestApply(v, { path: ["a"], range: [0, 1], value: [9] });
    expect(v).toEqual({ a: [1, 2] });
  });
});

// ── the bootstrap srcdoc ─────────────────────────────────────────────────────
describe("bootstrapSrc", () => {
  it("is a CONSTANT page: listens for sandbox:init and inlines guestApply", () => {
    const src = bootstrapSrc();
    expect(src).toContain("sandbox:init");
    expect(src).toContain("guestApply"); // the mirror patcher rides inside
    expect(src).toContain("AsyncFunction"); // user code runs as an AsyncFunction (await works)
    expect(bootstrapSrc()).toBe(src); // no per-boot interpolation — nothing user-supplied in it
  });
  it("speaks the boundary + op protocols (complement stubs, error ops, basedOn rebase tags)", () => {
    const src = bootstrapSrc();
    expect(src).toContain("boundary:complement");
    expect(src).toContain("boundary:call");
    expect(src).toContain("boundary:result");
    expect(src).toContain("basedOn"); // guest writes are rebase-taggable by the host
    expect(src).toContain('type: "error"'); // guest failures cross as error ops
  });
});

// ── the host side of the out port ────────────────────────────────────────────
describe("makeOutSink", () => {
  it("a snapshot from the guest sets the outlet value", () => {
    const out = new Source(undefined);
    const sink = makeOutSink(out);
    sink({ type: "snapshot", value: 42 });
    expect(out.value).toBe(42);
  });
  it("an error op surfaces on the outlet's ERROR channel + the status line", () => {
    const out = new Source(undefined);
    const statuses = [];
    const sink = makeOutSink(out, (t) => statuses.push(t));
    const errs = [];
    out.connect((op) => { if (op && op.type === "error") errs.push(op.error); });
    sink({ type: "error", error: "kapow" });
    expect(out.error).toBe("kapow");
    expect(errs).toEqual(["kapow"]);
    expect(statuses.at(-1)).toBe("⚠ kapow");
  });
  it("a fine-grained op patches the outlet's last value", () => {
    const out = new Source(undefined);
    const sink = makeOutSink(out);
    sink({ type: "snapshot", value: "ab" });
    sink({ path: [], range: [2, 2], value: "c" });
    expect(out.value).toBe("abc");
  });
  it("a fresh value clears a previous error (Source semantics)", () => {
    const out = new Source(undefined);
    const sink = makeOutSink(out);
    sink({ type: "error", error: "boom" });
    sink({ type: "snapshot", value: 1 });
    expect(out.error).toBeNull();
  });
  it("ignores non-messages", () => {
    const out = new Source("keep");
    const sink = makeOutSink(out);
    sink(null); sink("hi"); sink({ type: "wat" });
    expect(out.value).toBe("keep");
  });
});

// ── the WHOLE protocol, end to end ───────────────────────────────────────────
// happy-dom won't execute iframe scripts, but the bootstrap is just JS: extract
// it from the srcdoc and run it here with a stubbed addEventListener, then drive
// it over REAL MessageChannels exactly as mountSandbox would. This is the guest
// that ships, verbatim — only the <iframe> is skipped. (Evaluating it here is the
// test harness standing in for the frame; in production it only ever runs inside
// the sandbox.)
const tick = () => new Promise((r) => setTimeout(r, 0));

function bootGuest() {
  const src = bootstrapSrc();
  const script = src.slice(src.indexOf("<script>") + "<script>".length, src.indexOf("</" + "script>"));
  const listeners = {};
  const addEventListener = (type, cb) => { (listeners[type] ||= []).push(cb); };
  new Function("addEventListener", script)(addEventListener);
  return { dispatch: (type, ev) => { for (const cb of listeners[type] || []) cb(ev); } };
}

// wire a guest to host-side serves, exactly like mountSandbox's load handler
function hostWorld(code, stream) {
  const guest = bootGuest();
  const inCh = new MessageChannel(), capCh = new MessageChannel(), outCh = new MessageChannel();
  const stops = [];
  if (stream) stops.push(serveOpstreamOverPort(stream, inCh.port1));
  stops.push(serveBoundary((stream && stream.complement) || {}, capCh.port1));
  const out = new Source(undefined);
  const statuses = [];
  const sink = makeOutSink(out, (t) => statuses.push(t));
  const outs = [];
  outCh.port1.onmessage = (e) => { outs.push(e.data); sink(e.data); };
  guest.dispatch("message", { data: { type: "sandbox:init", code }, ports: [inCh.port2, capCh.port2, outCh.port2] });
  return { out, outs, statuses, stop: () => stops.forEach((s) => s()) };
}

describe("bootstrap end-to-end: the guest runtime over real ports", () => {
  it("input mirrors the in stream; output flows to the outlet; the complement crosses", async () => {
    class FileHandle {}
    const stream = new Opstream("hello");
    stream.complement = { name: "a.txt", save: vi.fn(async () => "saved"), handle: new FileHandle() };
    const world = hostWorld(
      // the user code: feature-detect + call a capability, read the mirror, emit
      "output(input.value + '/' + typeof complement.save + '/' + complement.name + '/' + dropped.join());" +
      "output(await complement.save());",
      stream,
    );
    await tick(); await tick();
    expect(world.out.value).toBe("saved"); // the awaited capability result
    expect(world.outs.map((m) => m.value)).toContain("hello/function/a.txt/handle");
    expect(stream.complement.save).toHaveBeenCalled();
    world.stop();
  });

  it("the guest WRITES BACK: input.apply crosses the port into the real stream (basedOn tagged)", async () => {
    const stream = new Opstream("hello");
    const world = hostWorld(
      "input.apply({ path: [], range: [input.value.length, input.value.length], value: ' world' });",
      stream,
    );
    await tick(); await tick();
    expect(stream.value).toBe("hello world"); // guest edit landed in the host stream
    world.stop();
  });

  it("the guest KEEPS receiving: a later host edit reaches a connected guest callback", async () => {
    const stream = new Opstream("a");
    const world = hostWorld("input.connect(() => output(input.value));", stream);
    await tick(); await tick();
    stream.apply({ path: [], range: [1, 1], value: "b" });
    await tick(); await tick();
    expect(world.out.value).toBe("ab"); // mirror patched by guestApply, re-emitted
    world.stop();
  });

  it("a THROW in user code surfaces as an error op on the out channel", async () => {
    const world = hostWorld("throw new Error('guest boom')", null);
    await tick(); await tick();
    expect(world.out.error).toBe("guest boom");
    expect(world.statuses.at(-1)).toBe("⚠ guest boom");
    world.stop();
  });

  it("a SYNTAX error surfaces too (AsyncFunction construction fails inside the guest)", async () => {
    const world = hostWorld("this is not javascript ((", null);
    await tick(); await tick();
    expect(typeof world.out.error).toBe("string");
    expect(world.out.error.length).toBeGreaterThan(0);
    world.stop();
  });

  it("with NO in inlet the code still runs: input is an empty mirror, complement is {}", async () => {
    const world = hostWorld(
      "output([input.value === undefined, Object.keys(complement).length, dropped.length].join());",
      null,
    );
    await tick(); await tick();
    expect(world.out.value).toBe("true,0,0");
    world.stop();
  });
});

// ── the mount: iframe mechanics (structure only — happy-dom runs no iframe JS) ─
describe("mountSandbox", () => {
  it("registers the out outlet and renders NOTHING until there is code", () => {
    const c = capture();
    const element = document.createElement("div");
    const cleanup = mountSandbox({ element, setOutlet: c.setOutlet });
    expect(c.out).toBeTruthy();
    expect(c.out.value).toBeUndefined();
    expect(element.querySelector("iframe")).toBeNull();
    expect(element.querySelector(".ns-source-status").textContent).toBe("no code");
    cleanup();
  });

  it("boots a sandboxed iframe from cached config.code — allow-scripts ONLY, code NOT in the srcdoc", () => {
    const c = capture();
    const element = document.createElement("div");
    const cleanup = mountSandbox({ element, setOutlet: c.setOutlet, config: { code: "output(1)" } });
    const frame = element.querySelector("iframe");
    expect(frame).toBeTruthy();
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts"); // the security invariant: no same-origin
    expect(frame.srcdoc).toContain("sandbox:init");
    expect(frame.srcdoc).not.toContain("output(1)"); // user code crosses via postMessage, never the srcdoc
    cleanup();
    expect(element.querySelector("iframe")).toBeNull(); // teardown removes the world
  });

  it("NEW code on the `code` inlet tears the old iframe down and boots a fresh one", () => {
    const code = new Source("output(1)");
    const c = capture();
    const element = document.createElement("div");
    const cleanup = mountSandbox({ element, inlets: { code }, setOutlet: c.setOutlet });
    const first = element.querySelector("iframe");
    expect(first).toBeTruthy();
    code.push("output(2)"); // a rewrite arrives (from codemirror, from an LLM…)
    const frames = element.querySelectorAll("iframe");
    expect(frames.length).toBe(1); // one world at a time
    expect(frames[0]).not.toBe(first); // …and it is a FRESH realm
    expect(first.isConnected).toBe(false);
    cleanup();
  });

  it("the SAME code again does not reboot (no reboot storm on echoed snapshots)", () => {
    const code = new Source("output(1)");
    const c = capture();
    const element = document.createElement("div");
    const cleanup = mountSandbox({ element, inlets: { code }, setOutlet: c.setOutlet });
    const first = element.querySelector("iframe");
    code.push("output(1)");
    expect(element.querySelector("iframe")).toBe(first);
    cleanup();
  });

  it("wired code PERSISTS via setConfig (a refresh can boot before the upstream produces)", () => {
    const code = new Source("output(7)");
    const configs = [];
    const cleanup = mountSandbox({
      element: document.createElement("div"),
      inlets: { code },
      setOutlet: capture().setOutlet,
      config: {},
      setConfig: (patch) => configs.push(patch),
    });
    expect(configs.at(-1)).toEqual({ code: "output(7)" });
    code.push("output(8)");
    expect(configs.at(-1)).toEqual({ code: "output(8)" });
    cleanup();
  });

  it("code going EMPTY tears the world down and says so", () => {
    const code = new Source("output(1)");
    const element = document.createElement("div");
    const cleanup = mountSandbox({ element, inlets: { code }, setOutlet: capture().setOutlet });
    expect(element.querySelector("iframe")).toBeTruthy();
    code.push("");
    expect(element.querySelector("iframe")).toBeNull();
    expect(element.querySelector(".ns-source-status").textContent).toBe("no code");
    cleanup();
  });

  it("an inlet value that is not a string falls back to the cached code", () => {
    const code = new Source(undefined); // wired but not producing yet
    const element = document.createElement("div");
    const cleanup = mountSandbox({
      element, inlets: { code }, setOutlet: capture().setOutlet,
      config: { code: "output('cached')" },
    });
    expect(element.querySelector("iframe")).toBeTruthy(); // booted from the cache
    cleanup();
  });

  it("cleanup disconnects the code inlet (a late push creates no new world)", () => {
    const code = new Opstream("output(1)");
    const element = document.createElement("div");
    const cleanup = mountSandbox({ element, inlets: { code }, setOutlet: capture().setOutlet });
    cleanup();
    expect(element.querySelector(".ns-sandbox")).toBeNull(); // root removed
    code.apply(snapshot("output(2)"));
    expect(element.querySelector("iframe")).toBeNull();
  });
});
