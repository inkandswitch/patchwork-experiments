import { describe, it, expect } from "vitest";
import { fileHandleOpstream } from "./fs-opstream.js";
import { splice } from "./opstreams.js";

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
