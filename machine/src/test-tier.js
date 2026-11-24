// The test tiers. `pnpm test` is the fast tier, for iterating; `pnpm
// test:full` (MACHINE_FULL=1) runs every exhaustive case as well, at commit.
// A case that is only in the full tier is marked test.skipIf(!FULL); one
// that the fast tier runs on a prefix says so where it cuts.
export const FULL = !!process.env.MACHINE_FULL;
