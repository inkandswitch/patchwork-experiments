// The plugin metadata (index.js): one scene extension on one scene trait whose
// fields are the weather's data shape (WEATHER.md, "The data"), every field a
// default the inspector can show and return to, every number a bounded
// slider, and an entry a worker can evaluate on its own. Finite tables: every
// field, every trait case.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { plugins } from "./index.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** WEATHER.md's data table ("## The data"), each row as [key, kind, default, min, max, step, log]: the doc is the spec the fields are checked against. */
function docTable(md) {
  const section = md.split(/^## /m).find((s) => s.startsWith("The data\n"));
  const lines = section.split("\n").filter((l) => l.startsWith("|"));
  const head = lines[0].split("|").slice(1, -1).map((c) => c.trim());
  expect(head.slice(0, 7)).toEqual(["Field", "Kind", "Default", "Min", "Max", "Step", "Slider"]);
  const bare = (c) => c.trim().replace(/^`(.*)`$/, "$1");
  const value = (c) => (bare(c) === "" ? null : JSON.parse(bare(c)));
  return lines.slice(2).map((l) => {
    const c = l.split("|").slice(1, -1);
    return [bare(c[0]), bare(c[1]), value(c[2]), value(c[3]), value(c[4]), value(c[5]), bare(c[6]) === "log"];
  });
}

/** A described field in the same shape. */
const row = (f) => [f.key, f.kind, f.default ?? null, f.min ?? null, f.max ?? null, f.step ?? null, f.log === true];

describe("the weather plugin", () => {
  it("is exactly one scene extension, `weather`, on the scene trait `weather`", () => {
    expect(plugins.map((p) => [p.type, p.id, p.traits])).toEqual([["scene:extension", "weather", ["weather"]]]);
    expect(Object.keys(plugins[0].describes)).toEqual(["weather"]);
    expect(plugins[0].describes.weather.on).toBe("scene");
  });

  it("survives structuredClone but for load()", () => {
    const meta = plugins.map(({ load, ...p }) => p);
    expect(structuredClone(meta)).toEqual(meta);
  });

  // A worker evaluates the entry with nothing beside it. So the proof is to
  // do exactly that: copy it alone into an empty folder and import it. Any
  // static import or re-export of a file or package, in whatever spelling,
  // fails there; only load() may reach for extension.js, and does.
  it("evaluates alone in an empty folder, and only load() reaches for extension.js", () => {
    const dir = mkdtempSync(join(tmpdir(), "weather-entry-"));
    try {
      writeFileSync(join(dir, "index.mjs"), readFileSync(join(HERE, "index.js"), "utf8"));
      const probe = [
        'const m = await import("./index.mjs");',
        "console.log(JSON.stringify(m.plugins.map((p) => p.id)));",
        "try { await m.plugins[0].load(); console.log('loaded'); } catch (e) { console.log(e.code, String(e.url ?? e.message).includes('/extension.js')); }",
      ].join("\n");
      const out = execFileSync(process.execPath, ["--input-type=module", "-e", probe], { cwd: dir, encoding: "utf8" });
      expect(out.trim().split("\n")).toEqual(['["weather"]', "ERR_MODULE_NOT_FOUND true"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the weather trait's fields", () => {
  const d = plugins[0].describes.weather;
  const table = docTable(readFileSync(join(HERE, "..", "WEATHER.md"), "utf8"));

  it("WEATHER.md's data table has a row per described field, in order", () => expect(table.map((r) => r[0])).toEqual(d.fields.map((f) => f.key)));
  for (const f of d.fields) it(`${f.key}: kind, default, range, step and slider are WEATHER.md's`, () => expect(row(f)).toEqual(table.find((r) => r[0] === f.key)));

  // A field with no default can't be cleared once set (an emptied number
  // input writes nothing), and its slider shows a value that isn't in force.
  // So every field has one, and init is exactly the defaults.
  it("every field has a default, and init is exactly the defaults", () => {
    expect(d.fields.filter((f) => f.default === undefined).map((f) => f.key)).toEqual([]);
    expect(d.init).toEqual(Object.fromEntries(d.fields.map((f) => [f.key, f.default])));
  });

  for (const f of d.fields) {
    if (f.kind === "number")
      it(`${f.key}: a bounded slider, its default inside`, () => {
        expect(f.min).toBeLessThan(f.max);
        expect(f.default).toBeGreaterThanOrEqual(f.min);
        expect(f.default).toBeLessThanOrEqual(f.max);
        if (f.log) expect(f.min).toBeGreaterThan(0);
      });
    if (f.kind === "enum") it(`${f.key}: its default is an option`, () => expect(f.options.map((o) => o.value)).toContain(f.default));
  }

  it("the cloud kinds are the four the sky model knows", () => expect(d.fields.find((f) => f.key === "clouds").options.map((o) => o.value)).toEqual(["cumulus", "stratocumulus", "stratus", "cirrus"]));
  it("the default zone is a zone Intl knows", () => expect(new Intl.DateTimeFormat("en", { timeZone: d.init.zone }).resolvedOptions().timeZone).toBe(d.init.zone));
  it("the default date is a real calendar date, YYYY-MM-DD", () => {
    expect(d.init.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${d.init.date}T00:00:00Z`).toISOString().slice(0, 10)).toBe(d.init.date);
  });
});

describe("the extension (the scaffold)", () => {
  const api = (traits) => ({ doc: () => ({ traits: traits === undefined ? {} : { weather: traits } }) });
  const cases = { absent: undefined, empty: {}, full: plugins[0].describes.weather.init };
  for (const [name, trait] of Object.entries(cases))
    it(`offers nothing yet: trait ${name}`, async () => {
      const ext = await plugins[0].load();
      expect(ext.create(api(trait)).ambient()).toBe(null);
    });
});
