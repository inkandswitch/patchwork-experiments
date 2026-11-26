// What a person is shown of a TTS import (status.js), over every case: the
// doc asking for nothing or for a request R; its outcome none, a game for R,
// a failure for R, or a game for an earlier request; and the work this page
// knows of: still finding out, none, keeping a drop (going, failed,
// stopped), work for another request, and work for R in each state a task
// view can have. The invariant under test: "importing" is shown only while
// work is going on, and an asked import with neither an outcome nor work is
// shown as interrupted.
import { describe, it, expect } from "vitest";
import { shownStatus, underWay, workLines, LINES } from "./status.js";

const R = "r".repeat(64);
const OLD = "o".repeat(64);
const GAME = "automerge:game";
const REPORT = { mod: { saveName: "Tiny" } };

const docs = {
  "nothing asked": { request: null, imported: null },
  "asked, no outcome": { request: { id: R }, imported: null },
  "asked, a game for it": { request: { id: R }, imported: { id: R, gameUrl: GAME, report: REPORT } },
  "asked, a failure for it": { request: { id: R }, imported: { id: R, error: "No save" } },
  "asked, a game for an earlier request": { request: { id: R }, imported: { id: OLD, gameUrl: "automerge:old", report: REPORT } },
};

const forR = (state, more = {}) => ({ request: R, state, progress: null, logs: [], error: null, taskUrl: null, ...more });
const works = {
  "still finding out": undefined,
  none: null,
  "keeping a drop": { request: null, state: "running", progress: { phase: "Keeping what was dropped", done: 1, total: 3 } },
  "keeping a drop failed": { request: null, state: "failed", error: "No Tabletop Simulator save found" },
  "keeping a drop stopped": { request: null, state: "cancelled" },
  "running for another request": { request: OLD, state: "running" },
  starting: forR("starting"),
  waiting: forR("waiting", { taskUrl: "automerge:t" }),
  running: forR("running"),
  stalled: forR("stalled", { taskUrl: "automerge:t" }),
  stopping: forR("stopping", { taskUrl: "automerge:t" }),
  "succeeded, imported": forR("succeeded", { result: { imported: true, gameUrl: GAME, message: "Imported" } }),
  "succeeded, asked for something else": forR("succeeded", { result: { imported: false, message: "Another mod was chosen" } }),
  failed: forR("failed", { error: "boom" }),
  cancelled: forR("cancelled"),
  missing: forR("missing"),
};

// what is shown for "asked, no outcome", work by work; the other docs are stated from it below
const ASKED = {
  "still finding out": { status: "looking", line: LINES.looking },
  none: { status: "interrupted", line: LINES.interrupted },
  "keeping a drop": { status: "importing" },
  "keeping a drop failed": { status: "failed", line: "No Tabletop Simulator save found" },
  "keeping a drop stopped": { status: "stopped", line: LINES.stopped },
  "running for another request": { status: "interrupted", line: LINES.interrupted },
  starting: { status: "importing" },
  waiting: { status: "importing" },
  running: { status: "importing" },
  stalled: { status: "importing" },
  stopping: { status: "importing" },
  "succeeded, imported": { status: "done", gameUrl: GAME, report: null, line: LINES.arriving },
  "succeeded, asked for something else": { status: "interrupted", line: "Another mod was chosen" },
  failed: { status: "failed", line: "boom" },
  cancelled: { status: "stopped", line: LINES.stopped },
  missing: { status: "interrupted", line: LINES.interrupted },
};

const going = ["keeping a drop", "starting", "waiting", "running", "stalled", "stopping"];
const dropEnded = { "keeping a drop failed": ASKED["keeping a drop failed"], "keeping a drop stopped": ASKED["keeping a drop stopped"] };

describe("shownStatus, every doc with every work", () => {
  it("covers every case of the table", () => {
    expect(Object.keys(ASKED).sort()).toEqual(Object.keys(works).sort());
  });

  for (const [workName, work] of Object.entries(works)) {
    it(`nothing asked, work ${workName}`, () => {
      const s = shownStatus(docs["nothing asked"], work);
      // only a drop being kept, which has no request yet, says anything
      if (workName === "keeping a drop") expect(s).toMatchObject({ status: "importing", work });
      else if (dropEnded[workName]) expect(s).toEqual(dropEnded[workName]);
      else expect(s).toEqual({ status: "empty" });
    });

    it(`asked with no outcome, work ${workName}`, () => {
      const s = shownStatus(docs["asked, no outcome"], work);
      expect(s).toMatchObject(ASKED[workName]);
      if (s.status === "importing") expect(s.work).toBe(work);
    });

    it(`asked with a game for it, work ${workName}`, () => {
      const s = shownStatus(docs["asked, a game for it"], work);
      // a drop being kept is about the next request; otherwise the doc's game is the answer, whatever the work says
      if (going.includes(workName) && work.request === null) expect(s.status).toBe("importing");
      else if (dropEnded[workName]) expect(s).toEqual(dropEnded[workName]);
      else expect(s).toEqual({ status: "done", gameUrl: GAME, report: REPORT });
    });

    it(`asked with a failure for it, work ${workName}`, () => {
      const s = shownStatus(docs["asked, a failure for it"], work);
      // work going on (asked again) is shown; otherwise the failure the doc keeps
      if (going.includes(workName)) expect(s.status).toBe("importing");
      else if (dropEnded[workName]) expect(s).toEqual(dropEnded[workName]);
      else expect(s).toEqual({ status: "failed", line: "No save" });
    });

    it(`asked with a game for an earlier request, work ${workName}`, () => {
      // an outcome for another request says nothing about this one
      expect(shownStatus(docs["asked, a game for an earlier request"], work)).toEqual(shownStatus(docs["asked, no outcome"], work));
    });
  }

  it("importing is shown only while work is going on", () => {
    for (const doc of Object.values(docs)) {
      for (const work of Object.values(works)) {
        if (shownStatus(doc, work).status === "importing") expect(underWay(work?.state)).toBe(true);
      }
    }
  });
});

describe("what is said of work going on", () => {
  it("the stage, and where it runs, always true", () => {
    expect(workLines(forR("starting"))).toEqual({ stage: LINES.starting, where: null, done: null, total: null });
    expect(workLines(forR("running", { progress: { phase: "Storing assets", done: 2, total: 8 } }))).toEqual({ stage: "Storing assets: 2 of 8", where: "In this page: closing it stops the import.", done: 2, total: 8 });
    expect(workLines(forR("running", { taskUrl: "automerge:t", progress: { phase: "Translating the game", done: 0, total: 0 } }))).toEqual({ stage: "Translating the game", where: "On your own machines: closing this does not stop it.", done: null, total: null });
    expect(workLines(forR("waiting", { taskUrl: "automerge:t" })).stage).toBe(LINES.waiting);
    expect(workLines(forR("stalled", { taskUrl: "automerge:t" })).stage).toBe(LINES.waiting);
    // where this page takes no part in its browser's pool (the tasks package not installed here), waiting says so
    expect(workLines(forR("waiting", { taskUrl: "automerge:t" }), false).stage).toBe(LINES.waitingWithoutThisBrowser);
    expect(workLines(forR("stalled", { taskUrl: "automerge:t" }), false).stage).toBe(LINES.waitingWithoutThisBrowser);
    expect(workLines(forR("stopping", { taskUrl: "automerge:t" })).stage).toBe(LINES.stopping);
    expect(workLines(works["keeping a drop"])).toMatchObject({ stage: "Keeping what was dropped: 1 of 3", where: "In this page: closing it stops the import." });
  });
});
