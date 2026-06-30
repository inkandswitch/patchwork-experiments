import { describe, it, expect, vi } from "vitest";
import { fileHandleOpstream, fileSnapshot, diskChanged, isDirty, watchFileStream, startFileSource } from "./fs-opstream.js";
import { splice, Source } from "./opstreams.js";

// a fake handle whose disk content + lastModified can be mutated under us
function watchableHandle(name, content, lastModified = 1, type = "") {
  const store = { content, lastModified, type };
  return {
    store,
    set(c, lm) { store.content = c; store.lastModified = lm; },
    async getFile() {
      const s = store;
      return { name, type: s.type, size: s.content.length, lastModified: s.lastModified, text: async () => s.content };
    },
    async createWritable() {
      return { async write(d) { store.content = d; store.lastModified += 1; }, async close() {} };
    },
  };
}

// a fake FileSystemFileHandle backed by an in-memory string
function fakeFileHandle(name, content, type = "") {
  const store = { content };
  return {
    store,
    async getFile() {
      return { name, type, text: async () => store.content };
    },
    async createWritable() {
      return {
        async write(data) {
          store.content = data;
        },
        async close() {},
      };
    },
  };
}

describe("fileHandleOpstream", () => {
  it("reads the file text and carries file metadata + a save() capability", async () => {
    const fh = fakeFileHandle("notes.md", "# hi");
    const s = await fileHandleOpstream(fh);
    expect(s.value).toBe("# hi");
    expect(s.complement).toMatchObject({
      fileSystem: true,
      name: "notes.md",
      mimeType: "text/markdown", // derived from extension
      extension: "md",
    });
    expect(typeof s.complement.save).toBe("function"); // capability present (unlike automerge)
    expect(s.apply).toBeTypeOf("function"); // editable
  });

  it("edits apply in-memory and save() writes the current value back to disk", async () => {
    const fh = fakeFileHandle("a.txt", "hello");
    const s = await fileHandleOpstream(fh);
    s.apply(splice([], 0, 1, "H")); // edit text → "Hello"
    expect(s.value).toBe("Hello");
    expect(fh.store.content).toBe("hello"); // not yet written
    await s.complement.save();
    expect(fh.store.content).toBe("Hello"); // saved to the file
  });

  it("uses the file's own mime type when provided", async () => {
    const fh = fakeFileHandle("weird", "x", "application/x-custom");
    const s = await fileHandleOpstream(fh);
    expect(s.complement.mimeType).toBe("application/x-custom");
  });
});

describe("fileSnapshot / dirty helpers", () => {
  it("fileSnapshot is a plain, lens-friendly value", () => {
    const file = { name: "data.json", type: "application/json", size: 7, lastModified: 42 };
    expect(fileSnapshot(file, '{"a":1}')).toEqual({
      name: "data.json", type: "application/json", size: 7, lastModified: 42, extension: "json", text: '{"a":1}',
    });
  });
  it("diskChanged compares lastModified", () => {
    expect(diskChanged(1, { lastModified: 2 })).toBe(true);
    expect(diskChanged(2, { lastModified: 2 })).toBe(false);
    expect(diskChanged(1, null)).toBe(false);
  });
  it("isDirty = stream value differs from the disk baseline", () => {
    expect(isDirty("edited", "ondisk")).toBe(true);
    expect(isDirty("same", "same")).toBe(false);
  });
});

describe("watchFileStream (reload unless dirtied)", () => {
  it("reloads when the file changes on disk and the stream is clean", async () => {
    vi.useFakeTimers();
    const fh = watchableHandle("a.txt", "v1", 1);
    const s = await fileHandleOpstream(fh);
    expect(s.value).toBe("v1");
    const stop = watchFileStream(s, { intervalMs: 100 });
    fh.set("v2", 2); // external change
    await vi.advanceTimersByTimeAsync(120);
    expect(s.value).toBe("v2"); // reloaded
    stop();
    vi.useRealTimers();
  });

  it("does NOT clobber unsaved edits when the file changes on disk", async () => {
    vi.useFakeTimers();
    const fh = watchableHandle("a.txt", "v1", 1);
    const s = await fileHandleOpstream(fh);
    const stop = watchFileStream(s, { intervalMs: 100 });
    s.apply(splice([], 0, 2, "EDITED")); // local edit → dirty
    expect(s.value).toBe("EDITED");
    fh.set("v3", 3); // external change while dirty
    await vi.advanceTimersByTimeAsync(120);
    expect(s.value).toBe("EDITED"); // kept the edit
    stop();
    vi.useRealTimers();
  });

  it("after save(), later external changes reload again", async () => {
    vi.useFakeTimers();
    const fh = watchableHandle("a.txt", "v1", 1);
    const s = await fileHandleOpstream(fh);
    const stop = watchFileStream(s, { intervalMs: 100 });
    s.apply(splice([], 0, 2, "mine"));
    await s.complement.save(); // writes "mine", re-baselines
    fh.set("external", 9); // someone else edits
    await vi.advanceTimersByTimeAsync(120);
    expect(s.value).toBe("external"); // reloads (no longer dirty)
    stop();
    vi.useRealTimers();
  });
});

describe("startFileSource (read-only File Source)", () => {
  it("emits a snapshot and unconditionally reflects disk changes", async () => {
    vi.useFakeTimers();
    const s = new Source(null, { complement: {} });
    const fh = watchableHandle("d.json", '{"a":1}', 1);
    const stop = await startFileSource(s, fh, { intervalMs: 100 });
    expect(s.value).toMatchObject({ name: "d.json", text: '{"a":1}' });
    expect(s.apply).toBeUndefined(); // a Source is read-only
    fh.set('{"a":2}', 2);
    await vi.advanceTimersByTimeAsync(120);
    expect(s.value.text).toBe('{"a":2}'); // always reflects disk
    stop();
    vi.useRealTimers();
  });
});
