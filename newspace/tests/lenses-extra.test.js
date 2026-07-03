import { describe, it, expect } from "vitest";
import { lensDescriptor, lensSpec, applyLens } from "../src/lenses.js";
import { snapshot } from "../src/ops.js";

// A minimal FAKE source opstream (per harness rules): connect() replays one
// snapshot then nothing; apply() records the op. Omit `apply` for a read-only
// source (the absence of the function IS the read-only-ness).
function fakeSource(value, { writable = true } = {}) {
  const applied = [];
  const src = {
    value,
    complement: {},
    connect(cb) {
      cb({ type: "snapshot", value: src.value });
      return () => {};
    },
  };
  if (writable) {
    src.apply = (op) => {
      applied.push(op);
      if (op && op.type === "snapshot") src.value = op.value;
    };
  }
  src.applied = applied;
  return src;
}

// project-only descriptor: a pure GETTER (no unproject / no apply)
const projectOnly = {
  type: "sketchy:lens",
  id: "double",
  name: "double",
  project: (v) => (typeof v === "number" ? v * 2 : 0),
};

// project + unproject descriptor: a real LENS (bidirectional)
const biLens = {
  type: "sketchy:lens",
  id: "halve",
  name: "halve",
  project: (v) => (typeof v === "number" ? v * 2 : 0),
  unproject: (view) => (typeof view === "number" ? view / 2 : undefined),
};

describe("lensSpec: getter vs lens shape", () => {
  it("a project-only descriptor produces a spec WITHOUT apply (read-only getter)", () => {
    const spec = lensSpec(projectOnly);
    expect(spec.value(5)).toBe(10);
    expect(spec.apply).toBeUndefined(); // no unproject, no explicit apply ⇒ getter
  });

  it("defaults the projection to identity when no `project` is given", () => {
    const spec = lensSpec({ id: "id" });
    expect(spec.value(99)).toBe(99);
    expect(spec.value("x")).toBe("x");
  });

  it("a descriptor with `unproject` derives an apply (becomes a lens)", () => {
    const spec = lensSpec(biLens);
    expect(typeof spec.apply).toBe("function");
  });

  it("an explicit `apply` is preferred over the derived one (unproject not used)", () => {
    let called = 0;
    const explicit = lensSpec({ id: "e", apply: () => { called++; }, unproject: () => 123 });
    explicit.apply(snapshot(1), fakeSource(0));
    expect(called).toBe(1); // the explicit apply ran, not the unproject-derived one
  });
});

describe("applyLens: project-only lens is read-only", () => {
  it("the derived stream has NO apply even over a writable source", () => {
    const out = applyLens(lensDescriptor(projectOnly), fakeSource(21));
    expect(out.value).toBe(42);
    expect(out.apply).toBeUndefined(); // getter ⇒ never writable downstream
  });
});

describe("applyLens: project+unproject is bidirectional", () => {
  it("over a writable source the derived stream is writable and inverts edits back", () => {
    const src = fakeSource(3); // source value 3 ⇒ projected view 6
    const out = applyLens(lensDescriptor(biLens), src);
    expect(out.value).toBe(6);
    expect(typeof out.apply).toBe("function");

    out.apply(snapshot(20)); // downstream sets the VIEW to 20
    expect(src.value).toBe(10); // unproject(20) = 10 written back to the source
    expect(src.applied.length).toBe(1);
    expect(src.applied[0]).toEqual(snapshot(10)); // written as a snapshot of the source value
  });

  it("a write that doesn't move the view re-derives the same source value (still a write here)", () => {
    const src = fakeSource(4); // view = 8
    const out = applyLens(lensDescriptor(biLens), src);
    out.apply(snapshot(8)); // view unchanged at 8 ⇒ unproject(8)=4 == source 4 ⇒ idempotent skip
    expect(src.applied.length).toBe(0); // back === source.value ⇒ no write
    expect(src.value).toBe(4);
  });

  it("skips a write when unproject returns undefined (invalid edit)", () => {
    const src = fakeSource(2);
    const out = applyLens(lensDescriptor(biLens), src);
    out.apply(snapshot("not a number")); // unproject(string) ⇒ undefined
    expect(src.applied.length).toBe(0);
    expect(src.value).toBe(2);
  });
});

describe("applyLens: read-only source (no apply) drops the apply", () => {
  it("a bidirectional lens over a source WITHOUT apply presents as read-only", () => {
    const src = fakeSource(5, { writable: false });
    expect(src.apply).toBeUndefined();
    const out = applyLens(lensDescriptor(biLens), src);
    expect(out.value).toBe(10); // still projects
    expect(out.apply).toBeUndefined(); // can't write through ⇒ no silent-drop apply
  });
});

describe("write-back is idempotent (no feedback storm)", () => {
  it("applying the same view value twice in a row writes at most once", () => {
    const src = fakeSource(1); // view = 2
    const out = applyLens(lensDescriptor(biLens), src);
    out.apply(snapshot(50)); // view 50 ⇒ source 25, changes ⇒ 1 write
    expect(src.value).toBe(25);
    expect(src.applied.length).toBe(1);
    out.apply(snapshot(50)); // view 50 again ⇒ source would be 25 == current ⇒ skip
    expect(src.applied.length).toBe(1); // NO second write
    expect(src.value).toBe(25);
  });

  it("the derived apply does not call source.apply when nothing changes", () => {
    let calls = 0;
    const src = {
      value: 9, // view = 18
      complement: {},
      connect(cb) { cb({ type: "snapshot", value: 9 }); return () => {}; },
      apply() { calls++; },
    };
    const out = applyLens(lensDescriptor(biLens), src);
    out.apply(snapshot(18)); // unproject(18)=9 == source 9 ⇒ no call
    expect(calls).toBe(0);
  });
});

describe("applyLens: no source", () => {
  it("returns null", () => {
    expect(applyLens(lensDescriptor(biLens), null)).toBe(null);
    expect(applyLens(lensDescriptor(projectOnly), undefined)).toBe(null);
  });
});
