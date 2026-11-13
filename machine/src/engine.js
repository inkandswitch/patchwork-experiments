// Loads an engine: a standalone .wasm under the ABI in ENGINE.md. The engine
// object holds nothing simulation-relevant itself; all of that is in the
// instance, and the instance is all memory and mutable globals.
import { prepare } from "./wasm-module.js";
import * as state from "./wasm-state.js";

// Everything the host gives an engine. No clock, no randomness, no files:
// every import is a pure function of its arguments and keeps nothing. The
// content is the one exception that proves it: it is fixed for the engine's
// life (and named in its identity), so reading it is pure too.
function host(content, memory) {
  return {
    env: {
      // Emscripten's growth notice; this host reads memory.buffer afresh anyway.
      emscripten_notify_memory_growth() {},
    },
    machine: {
      content_size: () => content.length,
      content_read(offset, len, dst) {
        [offset, len, dst] = [offset >>> 0, len >>> 0, dst >>> 0];
        if (offset + len > content.length) throw new RangeError("content read past its end");
        new Uint8Array(memory().buffer, dst, len).set(content.subarray(offset, offset + len));
      },
    },
  };
}

export const IMPORTS = new Set(
  Object.entries(host()).flatMap(([m, fns]) => Object.keys(fns).map((f) => `${m}.${f}`)),
);

const REQUIRED = ["machine_info", "machine_init", "machine_input", "machine_step"];

/**
 * Checks and compiles an engine's .wasm once; boot(content) then starts an
 * engine at tick 0, as many times as wanted (one per peer in a test, one per
 * session in a host).
 */
export async function compile(wasm) {
  const { bytes, globals } = prepare(wasm, IMPORTS);
  const module = await WebAssembly.compile(bytes);
  return { boot: (content = new Uint8Array()) => new Engine(module, globals, content) };
}

/** What a session records so that peers know they run the same machine. */
export async function identify(wasm, content = new Uint8Array()) {
  return { engine: await sha256(wasm), content: await sha256(content) };
}

async function sha256(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

class Engine {
  #module;
  #globals;
  #content;
  #live;
  #viewer = null;

  constructor(module, globals, content) {
    this.#module = module;
    this.#globals = globals;
    this.#content = content.slice(); // fixed from here on, whatever the caller does
    const live = this.#instance();
    const x = live.exports;
    for (const name of REQUIRED)
      if (typeof x[name] !== "function") throw new Error(`engine does not export ${name}`);
    x._initialize?.();
    const info = new DataView(live.memory.buffer, x.machine_info(), 16);
    this.tickRate = [info.getUint32(0, true), info.getUint32(4, true)];
    this.hz = this.tickRate[0] / this.tickRate[1];
    this.players = info.getUint32(8, true);
    this.inputBytes = info.getUint32(12, true);
    // Content reaches the engine one of two ways: copied in here, or read
    // on demand through the content imports (so it stays out of memory).
    if (x.machine_content) {
      const at = x.machine_content(content.length);
      new Uint8Array(live.memory.buffer, at, content.length).set(content);
    }
    if (call(live, "machine_init") !== 0) throw new Error("engine refused its content");
    this.#live = live;
  }

  #instance() {
    let memory;
    const { exports } = new WebAssembly.Instance(this.#module, host(this.#content, () => memory));
    if (!(exports.memory instanceof WebAssembly.Memory)) throw new Error("engine exports no memory");
    memory = exports.memory;
    const globals = this.#globals.map(({ name, type }) => ({ global: exports[name], type }));
    return { exports, memory: exports.memory, globals };
  }

  /** One tick. inputs: players * inputBytes bytes, port after port. */
  step(inputs) {
    if (inputs.length !== this.players * this.inputBytes)
      throw new Error(`step wants ${this.players * this.inputBytes} input bytes, got ${inputs.length}`);
    const x = this.#live.exports;
    new Uint8Array(this.#live.memory.buffer, x.machine_input(), inputs.length).set(inputs);
    call(this.#live, "machine_step");
  }

  /** The whole state as bytes; `into`, a dropped snapshot of the same size, is reused. */
  snapshot(into) {
    return state.snapshot(this.#live, into);
  }

  restore(snap) {
    // Memory cannot shrink, so going back past a growth means a fresh instance.
    if (state.size(this.#live) > state.pages(snap)) this.#live = this.#instance();
    state.restore(this.#live, snap);
  }

  hash() {
    return state.hash(this.#live);
  }

  /** The last step's audio and events, copied out; {} if the engine has none. */
  output() {
    const x = this.#live.exports;
    if (!x.machine_output) return {};
    const at = x.machine_output();
    const buf = this.#live.memory.buffer;
    const o = new DataView(buf, at, 24);
    const [rate, channels, count, samples, eventsLen, events] = [0, 4, 8, 12, 16, 20].map((at) =>
      o.getUint32(at, true),
    );
    return {
      audio: { rate, channels, samples: new Float32Array(buf, samples, count * channels).slice() },
      events: new Uint8Array(buf, events, eventsLen).slice(),
    };
  }

  /**
   * A picture of the current state, seen from view (engine-defined: a player,
   * a camera). Drawing may write memory, so it happens on a copy of the state,
   * made afresh each time; the live state is never touched. null if the
   * engine draws nothing.
   */
  frame(view = 0) {
    if (!this.#live.exports.machine_frame) return null;
    const { result, memory } = this.inspect("machine_frame", view);
    return picture(memory, result);
  }

  /**
   * What the engine says of its current state under `kind` (engine-defined:
   * the things in a level, a console's RAM), as bytes copied out; null if
   * the engine has no such kind. Like frame, it runs on a copy of the
   * state, so the live state is never touched.
   */
  query(kind) {
    if (!this.#live.exports.machine_query) return null;
    const { result: at, memory } = this.inspect("machine_query", kind >>> 0);
    if (!at) return null;
    const q = new DataView(memory.buffer, at, 8);
    return new Uint8Array(memory.buffer, q.getUint32(4, true), q.getUint32(0, true)).slice();
  }

  /**
   * Calls one of the engine's own exports (engine-defined: a query, a
   * drawing) on a copy of the current state, made afresh each time, so the
   * live state is never touched whatever the export writes. Returns its
   * result and the copy's memory, valid until the next frame or inspect.
   */
  inspect(name, ...args) {
    if (!this.#viewer || state.size(this.#viewer) > state.size(this.#live))
      this.#viewer = this.#instance();
    state.copy(this.#live, this.#viewer);
    return { result: call(this.#viewer, name, ...args), memory: this.#viewer.memory };
  }
}

/**
 * The picture a frame-shaped result points at ({u32 width, height, *u8
 * rgba}, machine_frame's), copied out of `memory`: for engine-specific
 * drawings made through inspect (Doom's doom_camera).
 */
export function picture(memory, at) {
  const buf = memory.buffer; // after drawing, which may grow it
  const f = new DataView(buf, at, 12);
  const width = f.getUint32(0, true);
  const height = f.getUint32(4, true);
  const rgba = new Uint8ClampedArray(buf, f.getUint32(8, true), width * height * 4).slice();
  return { width, height, rgba };
}

// A trap becomes an error that says why, if the engine can.
function call(instance, name, ...args) {
  const x = instance.exports;
  if (typeof x[name] !== "function") throw new Error(`engine does not export ${name}`);
  try {
    return x[name](...args);
  } catch (e) {
    if (!(e instanceof WebAssembly.RuntimeError) || !x.machine_fault) throw e;
    const bytes = new Uint8Array(instance.memory.buffer, x.machine_fault());
    const why = new TextDecoder().decode(bytes.subarray(0, bytes.indexOf(0)));
    throw new Error(`engine fault in ${name}: ${why || e.message}`, { cause: e });
  }
}
