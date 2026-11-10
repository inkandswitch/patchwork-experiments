// contract/v1/fixtures: every valid fixture validates, every invalid one
// fails at the stage (and with the code) its manifest names, and the valid
// ones are what this package builds today (so sailing's agreement test,
// which copies them, reads current predictions).
//
// To rewrite them after a change that moves the numbers on purpose:
//   RIG_WRITE_CONTRACT_FIXTURES=1 npx vitest run src/contract-fixtures.test.js

import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { validate, errorText } from "../contract/v1/validate.js";
import { CASES, INVALID, buildCase, fixtureJson } from "./test/contract-cases.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../contract/v1");
const dir = (p) => resolve(ROOT, p);
const WRITE = !!process.env.RIG_WRITE_CONTRACT_FIXTURES;
const read = (p) => JSON.parse(readFileSync(dir(p), "utf8"));

/** Every number within rel (or 1e-9 absolute), everything else equal; the first difference's path, or null. */
function differs(a, b, rel = 1e-6, path = "$") {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= Math.max(1e-9, rel * Math.max(Math.abs(a), Math.abs(b))) ? null : `${path}: ${a} vs ${b}`;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return `${path}: arrays differ in length`;
    for (let i = 0; i < a.length; i++) {
      const d = differs(a[i], b[i], rel, `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const d = differs(a[k], b[k], rel, `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : `${path}: ${JSON.stringify(a)?.slice(0, 80)} vs ${JSON.stringify(b)?.slice(0, 80)}`;
}

if (WRITE) {
  describe("writing contract/v1 fixtures", () => {
    it("writes valid, invalid, the manifest and the example", () => {
      for (const p of ["fixtures/valid", "fixtures/invalid", "examples"]) mkdirSync(dir(p), { recursive: true });
      for (const c of CASES) writeFileSync(dir(`fixtures/valid/${c.id}.json`), fixtureJson(buildCase(c.id).contract));
      const minimal = JSON.parse(fixtureJson(buildCase("minimal").contract));
      writeFileSync(dir("examples/minimal.json"), fixtureJson(minimal));
      for (const inv of INVALID) {
        const c = structuredClone(minimal);
        inv.mutate(c);
        writeFileSync(dir(`fixtures/invalid/${inv.file}`), fixtureJson(c));
      }
      const manifest = [
        ...CASES.map((c) => ({ file: `valid/${c.id}.json`, stage: "valid", about: c.about })),
        ...INVALID.map((i) => ({ file: `invalid/${i.file}`, stage: i.stage, ...(i.error ? { error: i.error } : {}) })),
      ];
      writeFileSync(dir("fixtures/manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    });
  });
} else {
  describe("contract/v1 fixtures, as the manifest says", () => {
    const manifest = read("fixtures/manifest.json");

    it("lists every fixture file there is, and only those", () => {
      const files = ["valid", "invalid"].flatMap((d) => readdirSync(dir(`fixtures/${d}`)).map((f) => `${d}/${f}`)).sort();
      expect(manifest.map((m) => m.file).sort()).toEqual(files);
    });

    for (const m of manifest)
      it(`${m.file} → ${m.stage}${m.error ? ` (${m.error})` : ""}`, () => {
        const r = validate(read(`fixtures/${m.file}`));
        if (m.stage === "valid") {
          expect(r.ok, errorText(r)).toBe(true);
          return;
        }
        expect(r.ok).toBe(false);
        expect(r.stage).toBe(m.stage);
        if (m.error) expect(r.errors.map((e) => e.code), errorText(r)).toContain(m.error);
        console.log(`  ${m.file}: ${errorText(r).slice(0, 160)}`);
      });

    it("the example is the minimal fixture", () => {
      expect(read("examples/minimal.json")).toEqual(read("fixtures/valid/minimal.json"));
    });
  });

  describe("the valid fixtures are what this package builds today", () => {
    for (const c of CASES)
      it(c.id, () => {
        const path = `fixtures/valid/${c.id}.json`;
        expect(existsSync(dir(path)), `${path} is missing: run with RIG_WRITE_CONTRACT_FIXTURES=1`).toBe(true);
        const fresh = JSON.parse(fixtureJson(buildCase(c.id).contract));
        const d = differs(fresh, read(path));
        expect(d, `${path} is stale (${d}): rewrite with RIG_WRITE_CONTRACT_FIXTURES=1 if the change is meant`).toBeNull();
        const kb = (fixtureJson(fresh).length / 1024).toFixed(0);
        const pts = fresh.predicted.points;
        console.log(`  ${c.id}: ${kb} kB, ${pts.length} predicted points (${pts.filter((p) => p.hollow).length} hollow), helm ${fresh.predicted.helm?.text ?? "-"}`);
      });
  });
}
