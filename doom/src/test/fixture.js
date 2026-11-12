// The tests' WAD: Freedoom's E1M1 and what drawing it needs (probes/make-fixture.mjs;
// Freedoom's notice is COPYING.txt beside it).
import { readFileSync } from "node:fs";
import { readWad } from "../wad.js";

export const fixtureBytes = () => new Uint8Array(readFileSync(new URL("./e1m1.wad", import.meta.url)));
export const fixture = () => readWad(fixtureBytes());
