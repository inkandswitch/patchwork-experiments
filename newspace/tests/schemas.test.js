import { describe, it, expect } from "vitest";
import {
  audioSchema,
  imageSchema,
  pixelsSchema,
  pointSchema,
  float32Schema,
  streamSchema,
  enumSchema,
  bangSchema,
} from "../src/ops.js";

// Run a Standard Schema synchronously and return its result.
const run = (schema, value) => schema["~standard"].validate(value);
// ACCEPT: a value the schema admits → result carries `.value`, no `.issues`.
const accepts = (schema, value) => {
  const r = run(schema, value);
  expect(r.issues).toBeUndefined();
  expect("value" in r).toBe(true);
};
// REJECT: a value the schema refuses → result carries `.issues`.
const rejects = (schema, value) => {
  const r = run(schema, value);
  expect(r.issues).toBeDefined();
  expect(Array.isArray(r.issues)).toBe(true);
};

describe("audioSchema", () => {
  const s = audioSchema();
  it("accepts a levels object ({ rms } or { peak })", () => {
    accepts(s, { rms: 0.1, peak: 0.5 });
    accepts(s, { peak: 0.2 });
    accepts(s, new Float32Array([0, 1, 0]));
  });
  it("rejects non-audio values", () => {
    rejects(s, "hello");
    rejects(s, 42);
    rejects(s, { foo: 1 });
    rejects(s, null);
  });
});

describe("imageSchema", () => {
  const s = imageSchema();
  it("accepts a frame ({ width, height }) or a url string", () => {
    accepts(s, { width: 4, height: 4, data: new Uint8ClampedArray(64) });
    accepts(s, "https://example.com/cat.png");
    accepts(s, "data:image/png;base64,AAAA");
    if (typeof ImageData !== "undefined") accepts(s, new ImageData(1, 1));
  });
  it("rejects values without dimensions and non-strings", () => {
    rejects(s, 123);
    rejects(s, { foo: "bar" });
    rejects(s, null);
  });
});

describe("pixelsSchema", () => {
  const s = pixelsSchema();
  it("accepts a typed array, a {data,…} object, or ImageData", () => {
    accepts(s, new Float32Array([1, 2, 3, 4]));
    accepts(s, new Uint8ClampedArray([0, 0, 0, 255]));
    accepts(s, { data: new Uint8ClampedArray(4), width: 1, height: 1 });
    if (typeof ImageData !== "undefined") accepts(s, new ImageData(1, 1));
  });
  it("rejects plain values with no pixel data", () => {
    rejects(s, "pixels");
    rejects(s, 7);
    rejects(s, { width: 1, height: 1 }); // no `data`, not a typed array
    rejects(s, null);
  });
});

describe("pointSchema", () => {
  const s = pointSchema();
  it("accepts a { x, y } with numeric coords", () => {
    accepts(s, { x: 0, y: 0 });
    accepts(s, { x: -3.5, y: 12, z: 99 }); // extra keys are fine
  });
  it("rejects missing/non-numeric coords", () => {
    rejects(s, { x: 1 });
    rejects(s, { x: "a", y: "b" });
    rejects(s, [1, 2]);
    rejects(s, null);
  });
});

describe("float32Schema", () => {
  const s = float32Schema();
  it("accepts any typed-array view", () => {
    accepts(s, new Float32Array([1, 2, 3]));
    accepts(s, new Uint8Array([1, 2]));
    accepts(s, new Int16Array(2));
  });
  it("rejects non-views", () => {
    rejects(s, [1, 2, 3]);
    rejects(s, "buf");
    rejects(s, { length: 3 });
    rejects(s, null);
  });
});

describe("streamSchema", () => {
  const s = streamSchema();
  it("accepts a MediaStream when the platform has one", () => {
    if (typeof MediaStream === "undefined") {
      // happy-dom may not implement MediaStream — nothing can be a valid value,
      // so the schema rejects everything (verified below). Skip the accept case.
      expect(true).toBe(true);
      return;
    }
    accepts(s, new MediaStream());
  });
  it("rejects non-MediaStream values", () => {
    rejects(s, {});
    rejects(s, "stream");
    rejects(s, 0);
    rejects(s, null);
  });
});

describe("enumSchema", () => {
  const s = enumSchema(["a", "b"]);
  it("accepts a member of the option set", () => {
    accepts(s, "a");
    accepts(s, "b");
  });
  it("rejects non-members", () => {
    rejects(s, "c");
    rejects(s, "");
    rejects(s, 1);
    rejects(s, null);
  });
});

describe("bangSchema", () => {
  const s = bangSchema();
  it("accepts anything (matching is by TYPE tag, not value)", () => {
    accepts(s, undefined);
    accepts(s, null);
    accepts(s, 0);
    accepts(s, { pulse: Symbol() });
    accepts(s, "go");
  });
});
