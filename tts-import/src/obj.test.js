// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseOBJ } from "./obj.js";
import { FIXTURE } from "./test/fixture.js";

const modelFile = (match) => {
  const dir = join(FIXTURE, "Models");
  return readFileSync(join(dir, readdirSync(dir).find((f) => f.includes(match))), "utf8");
};

describe("parseOBJ", () => {
  it("reads the fixture cube: quads fan-triangulated, vertices split per (v, vt, vn)", () => {
    const m = parseOBJ(modelFile("CCCC3333"));
    expect(m.faces).toBe(6);
    expect(m.indices.length).toBe(36);
    expect(m.positions.length / 3).toBe(24); // 6 faces × 4 corners, each with its own normal
    expect(m.uvs.length).toBe(48);
    expect(m.normals.length).toBe(72);
    // the -z face's first corner: v 2 (0.5, 0, -0.5), vt 1 (0, 0), vn 1 (0, 0, -1)
    expect([...m.positions.slice(0, 3)]).toEqual([0.5, 0, -0.5]);
    expect([...m.uvs.slice(0, 2)]).toEqual([0, 0]);
    expect([...m.normals.slice(0, 3)]).toEqual([0, 0, -1]);
  });

  it("takes negative indices, polygons, no uvs or normals", () => {
    const m = parseOBJ(modelFile("EEEE5555"));
    expect(m.faces).toBe(9);
    expect(m.uvs).toBeNull();
    expect(m.normals).toBeNull();
    // 8 side quads (16 tris) + an octagon (6 tris)
    expect(m.indices.length).toBe((16 + 6) * 3);
  });

  it("handles v//vn, comments, line continuations and CRLF; refuses a missing vertex", () => {
    const m = parseOBJ("# hi\r\nv 0 0 0\r\nv 1 0 0\r\nv 0 1 \\\n0\r\nvn 0 0 1\r\nf 1//1 2//1 3//1\r\n");
    expect(m.faces).toBe(1);
    expect([...m.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(m.uvs).toBeNull();
    expect([...m.normals.slice(0, 3)]).toEqual([0, 0, 1]);
    expect(() => parseOBJ("v 0 0 0\nf 1 2 3\n")).toThrow(/vertex 2/);
    expect(parseOBJ(new TextEncoder().encode("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3")).faces).toBe(1);
  });
});
