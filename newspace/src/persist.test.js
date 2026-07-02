import { describe, it, expect, beforeEach } from "vitest";
import { migrateStorageKey } from "./persist.js";

const OLD = "newspace:camera:automerge:test";
const NEW = "sketchy:camera:automerge:test";

describe("migrateStorageKey — newspace: → sketchy: localStorage rename", () => {
  beforeEach(() => localStorage.clear());

  it("copies the old key to the new one and deletes the old", () => {
    localStorage.setItem(OLD, '{"x":1,"y":2,"z":0.5}');
    migrateStorageKey(OLD, NEW);
    expect(localStorage.getItem(NEW)).toBe('{"x":1,"y":2,"z":0.5}');
    expect(localStorage.getItem(OLD)).toBe(null);
  });

  it("leaves an existing new key alone (the migrate is one-time)", () => {
    localStorage.setItem(NEW, "kept");
    localStorage.setItem(OLD, "stale");
    migrateStorageKey(OLD, NEW);
    expect(localStorage.getItem(NEW)).toBe("kept");
    expect(localStorage.getItem(OLD)).toBe("stale");
  });

  it("does nothing when neither key exists", () => {
    migrateStorageKey(OLD, NEW);
    expect(localStorage.getItem(NEW)).toBe(null);
  });

  it("swallows a throwing storage (private mode) instead of breaking the caller", () => {
    const broken = { getItem() { throw new Error("denied"); } };
    expect(() => migrateStorageKey(OLD, NEW, broken)).not.toThrow();
  });
});
