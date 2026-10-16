import { describe, it, expect } from "vitest";
import { SliceJobDatatype, newJobDoc, normalizeJob } from "./datatype.js";
import { DEFAULT_SETTINGS, FILAMENTS, normalizeSettings, settingWrites, settingsKey, settingsWrites } from "./settings.js";

const URL_A = "automerge:2j9mK3vG7pQx4TzR8wYbN5cD6eF1";
const URL_B = "automerge:3k8nL4wH8qRy5UaS9xZcP6dE7fG2";

// What bambu-slicer's datatype init wrote.
const bambuDoc = () => ({
  title: "Bracket",
  modelUrl: URL_A,
  settings: { layerHeight: 0.28, infillDensity: 30, supports: true, filament: "PETG", nozzleTemp: 240, bedTemp: 80, printSpeed: 150, wallLoops: 4 },
  printer: "BambuLab H2D",
  createdAt: "2026-10-01T00:00:00.000Z",
});

describe("slice-job datatype", () => {
  it("init writes the whole schema", () => {
    const d = {};
    SliceJobDatatype.init(d);
    expect(d).toMatchObject({ title: "Slice job", source: null, auto: true, gcodeUrl: null, builtFrom: null, status: "idle", error: null, stats: null });
    expect(d.settings).toEqual({ ...DEFAULT_SETTINGS });
    expect(SliceJobDatatype.getTitle(d)).toBe("Slice job");
    SliceJobDatatype.setTitle(d, "Hull");
    expect(SliceJobDatatype.getTitle(d)).toBe("Hull");
  });

  it("newJobDoc carries its type and settings", () => {
    const d = newJobDoc({ title: "T", source: URL_A, settings: { layerHeight: 0.1 }, now: () => "x" });
    expect(d["@patchwork"]).toEqual({ type: "slice-job" });
    expect(d.settings.layerHeight).toBe(0.1);
    expect(d.createdAt).toBe("x");
  });
});

describe("migrating bambu-slicer docs on read", () => {
  it("maps modelUrl → source, printer → settings.printer, printSpeed → wallSpeed", () => {
    const j = normalizeJob(bambuDoc());
    expect(j.source).toBe(URL_A);
    expect(j.migratedSource).toBe(true);
    expect(j.settings).toMatchObject({ layerHeight: 0.28, infillDensity: 30, supports: true, filament: "PETG", nozzleTemp: 240, bedTemp: 80, wallLoops: 4, wallSpeed: 150, printer: "BambuLab H2D" });
    expect(j.settings.printSpeed).toBeUndefined();
    expect(j.auto).toBe(true);
    expect(j.builtFrom).toBe(null);
  });

  it("a source, once set, wins over modelUrl", () => {
    const j = normalizeJob({ ...bambuDoc(), source: URL_B });
    expect(j.source).toBe(URL_B);
    expect(j.migratedSource).toBe(false);
  });

  it("an empty or junk modelUrl is no source", () => {
    expect(normalizeJob({ modelUrl: "" }).source).toBe(null);
    expect(normalizeJob({ modelUrl: "my model.scad" }).source).toBe(null);
  });

  it("never writes the doc", () => {
    const d = Object.freeze(bambuDoc());
    expect(() => normalizeJob(d)).not.toThrow();
  });

  it("a null source counts as absent, so modelUrl still applies", () => {
    expect(normalizeJob({ ...bambuDoc(), source: null }).source).toBe(URL_A);
  });
});

describe("settings", () => {
  it("fills defaults, coerces and clamps", () => {
    const s = normalizeSettings({ layerHeight: "0.12", wallLoops: 3.6, infillDensity: 150, filament: "petg", supports: "true", bogus: 1 });
    expect(s.layerHeight).toBe(0.12);
    expect(s.wallLoops).toBe(4);
    expect(s.infillDensity).toBe(100);
    expect(s.filament).toBe("PETG");
    expect(s.supports).toBe(true);
    expect("bogus" in s).toBe(false);
    expect(normalizeSettings({ layerHeight: "abc" }).layerHeight).toBe(DEFAULT_SETTINGS.layerHeight);
  });

  it("changing the layer height never touches the first layer height", () => {
    expect(settingWrites("layerHeight", 0.12)).toEqual({ layerHeight: 0.12 });
  });

  it("choosing a filament writes its preset from the one table", () => {
    expect(settingWrites("filament", "PETG")).toEqual({ filament: "PETG", nozzleTemp: FILAMENTS.PETG.nozzleTemp, bedTemp: FILAMENTS.PETG.bedTemp, fanSpeed: FILAMENTS.PETG.fanSpeed });
    expect(DEFAULT_SETTINGS.nozzleTemp).toBe(FILAMENTS.PLA.nozzleTemp);
    expect(DEFAULT_SETTINGS.bedTemp).toBe(FILAMENTS.PLA.bedTemp);
    expect(DEFAULT_SETTINGS.fanSpeed).toBe(FILAMENTS.PLA.fanSpeed);
  });

  it("explicit temperatures beat the filament preset in a batch", () => {
    const { writes } = settingsWrites({ nozzleTemp: 250, filament: "PETG" });
    expect(writes).toMatchObject({ filament: "PETG", nozzleTemp: 250, bedTemp: FILAMENTS.PETG.bedTemp });
    const r = settingsWrites({ layerHeight: 0.1, nope: 1, wallLoops: "x" });
    expect(r.writes).toEqual({ layerHeight: 0.1 });
    expect(r.rejected.sort()).toEqual(["nope", "wallLoops"]);
  });

  it("settingsKey is stable across key order and stored defaults", () => {
    expect(settingsKey({ layerHeight: 0.2, filament: "PLA" })).toBe(settingsKey({ filament: "PLA" }));
    expect(settingsKey({})).not.toBe(settingsKey({ layerHeight: 0.1 }));
  });
});
