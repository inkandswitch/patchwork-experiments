import { describe, it, expect } from "vitest";
import { cleanText, clipboardSource, plugin } from "./clipboard-source.js";

describe("cleanText (pure)", () => {
  it("passes a string through unchanged", () => {
    expect(cleanText("hello world")).toBe("hello world");
  });
  it("coerces null/undefined to empty string", () => {
    expect(cleanText(null)).toBe("");
    expect(cleanText(undefined)).toBe("");
  });
  it("stringifies non-string readings", () => {
    expect(cleanText(42)).toBe("42");
    // a faked DataTransfer-ish reading
    expect(cleanText({ toString: () => "faked" })).toBe("faked");
  });
});

describe("plugin descriptor", () => {
  it("has the expected shape", () => {
    expect(plugin.type).toBe("sketchy:window");
    expect(plugin.id).toBe("clipboard");
    expect(plugin.name).toBe("Clipboard");
    expect(plugin.icon).toBe("Clipboard");
    expect(plugin.inlets).toEqual([]);
    expect(plugin.outlets).toHaveLength(1);
    expect(plugin.outlets[0].name).toBe("text");
    expect(plugin.outlets[0].type).toBe("json");
    expect(plugin.outlets[0].schema).toBeTruthy();
  });
  it("load() returns a mount function (gated source)", async () => {
    const mount = await plugin.load();
    expect(typeof mount).toBe("function");
  });
});

describe("clipboardSource factory (device absent under happy-dom)", () => {
  it("returns { stream, stop } and pushes an error without throwing", () => {
    const { stream, stop } = clipboardSource();
    expect(stream).toBeTruthy();
    expect(typeof stop).toBe("function");
    // device unavailable / not yet resolved: the stream carries either the
    // initial "" value or an { error } object — never throws.
    const v = stream.value;
    const isError = v && typeof v === "object" && "error" in v;
    expect(isError || v === "").toBe(true);
    expect(() => stop()).not.toThrow();
  });
});
