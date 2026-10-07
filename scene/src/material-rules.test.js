import { describe, it, expect } from "vitest";
import { resolveMaterialSet, ruleMatches, rulesKey, sanitizeRules } from "./material-rules.js";

// The importer's four rules: the Solander 38 site's configureMaterial.
const SITE = [
  { match: { nameIncludes: "Alum" }, set: { metalness: 1, roughness: 0.2 } },
  { match: { nameIncludes: "Wood" }, set: { metalness: 1, roughness: 1 } },
  { match: { nameIncludes: "Plastic" }, set: { metalness: 1, roughness: 1 } },
  { match: { nameEquals: "Plastic" }, set: { color: "#ff4d00" } },
];

describe("material rules", () => {
  it("keeps well-formed rules and drops the rest", () => {
    expect(sanitizeRules(SITE)).toEqual(SITE);
    expect(sanitizeRules(null)).toEqual([]);
    expect(
      sanitizeRules([
        { match: {}, set: { metalness: 1 } },
        { match: { nameEquals: "x" }, set: {} },
        { match: { nameEquals: "x" }, set: { color: "red", roughness: "0.3", opacity: 7, bogus: 1 } },
        { match: { unnamed: true }, set: { emissive: "#ABCDEF", transmission: -1 } },
      ]),
    ).toEqual([
      { match: { nameEquals: "x" }, set: { roughness: 0.3, opacity: 1 } },
      { match: { unnamed: true }, set: { emissive: "#abcdef", transmission: 0 } },
    ]);
  });

  it("matches case-sensitively, like the site (\"Black plastic\" is not \"Plastic\")", () => {
    expect(ruleMatches({ nameIncludes: "Plastic" }, "Black plastic")).toBe(false);
    expect(ruleMatches({ nameIncludes: "Alum" }, "Aluminum 6061")).toBe(true);
    expect(ruleMatches({ nameEquals: "Plastic" }, "Plastic")).toBe(true);
    expect(ruleMatches({ unnamed: true }, "")).toBe(true);
    expect(ruleMatches({ unnamed: true }, "Wood")).toBe(false);
  });

  it("merges every matching rule in order, later ones winning", () => {
    const rules = sanitizeRules(SITE);
    expect(resolveMaterialSet("Aluminum 5052", rules)).toEqual({ metalness: 1, roughness: 0.2 });
    expect(resolveMaterialSet("Plastic", rules)).toEqual({ metalness: 1, roughness: 1, color: "#ff4d00" });
    expect(resolveMaterialSet("Bronze", rules)).toEqual({});
    expect(rulesKey(rules)).toBe(rulesKey(sanitizeRules(JSON.parse(JSON.stringify(SITE)))));
  });
});
