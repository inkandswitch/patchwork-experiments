import { describe, expect, it } from "vitest";
import {
  cellIdsOn,
  cellRefUrl,
  cellsTargeted,
  describeCells,
  parseCellRef,
  refsOfThread,
  threadRefUrl,
  threadsByCell,
} from "../src/comments";
import type { Cell, GraphDoc } from "../src/model";
import { BLOCK_STYLES, EDGE_STYLE } from "../src/model";
import refView, { drawThumbnail, resolveCells } from "../src/ref-view";

const DOC = "automerge:2ErhaZ1xysyiKADAfYy129tCWPqc";
const OTHER = "automerge:4KM2LJxDr9pVYiwEz78JZcVxoJGH";
const ROOT = "automerge:3Wq8xLpRZrtnhUyfFz3Y7vM1aBcd";

const node = (id: string, value: string, style = BLOCK_STYLES.trusted): Cell => ({
  id,
  value,
  style,
  parent: "1",
  vertex: true,
});
const edge = (id: string): Cell => ({ id, value: "", style: EDGE_STYLE, parent: "1", edge: true, source: "a", target: "b" });

describe("ref urls", () => {
  it("are what automerge-repo's handle.sub(...).url makes", () => {
    // taken from automerge-repo 2.6.0-subduction.49
    expect(cellRefUrl(OTHER, "d1", "c/1")).toBe(
      `${OTHER}/diagrams/%7B%22id%22%3A%22d1%22%7D/cells/%7B%22id%22%3A%22c%2F1%22%7D`,
    );
    expect(threadRefUrl(DOC, "t1")).toBe(`${DOC}/%5C%40comments/threads/%7B%22id%22%3A%22t1%22%7D`);
  });

  it("keep the doc url's heads at the end", () => {
    const url = cellRefUrl(`${DOC}#abc|def`, "d", "c");
    expect(url.endsWith("#abc|def")).toBe(true);
    expect(parseCellRef(url)).toEqual({ documentId: DOC.slice(10), diagramId: "d", cellId: "c" });
  });

  it("parse back into the cell they point at, and nothing else", () => {
    expect(parseCellRef(cellRefUrl(DOC, "page 1", "x\"y"))).toEqual({
      documentId: DOC.slice(10),
      diagramId: "page 1",
      cellId: 'x"y',
    });
    expect(parseCellRef(DOC)).toBeNull();
    expect(parseCellRef(threadRefUrl(DOC, "t"))).toBeNull();
    expect(parseCellRef(`${DOC}/content/[1@a-2@b]`)).toBeNull();
    expect(parseCellRef(`${DOC}/diagrams/@0/cells/@3`)).toBeNull();
  });

  it("tell which cells of this doc a set of refs targets", () => {
    const refs = [
      cellRefUrl(DOC, "d1", "a"),
      cellRefUrl(DOC, "d2", "b"),
      cellRefUrl(DOC, "d1", "a"), // twice
      cellRefUrl(OTHER, "d1", "c"), // another doc
      DOC, // the whole doc
      threadRefUrl(DOC, "t"),
    ];
    expect(cellsTargeted(refs, DOC).map((r) => `${r.diagramId}/${r.cellId}`)).toEqual(["d1/a", "d2/b"]);
    expect([...cellIdsOn(refs, DOC, "d1")]).toEqual(["a"]);
    expect([...cellIdsOn(refs, DOC, "d3")]).toEqual([]);
  });
});

describe("threads", () => {
  it("are counted per cell, distinct only", () => {
    const a = cellRefUrl(DOC, "d", "a");
    const b = cellRefUrl(DOC, "d", "b");
    const [t1, t2] = [threadRefUrl(ROOT, "t1"), threadRefUrl(ROOT, "t2")];
    const entries = [
      { targetUrl: a, threadUrl: t1 },
      { targetUrl: b, threadUrl: t1 },
      { targetUrl: a, threadUrl: t2 },
      // the provider listing the same thread again doesn't count it twice
      { targetUrl: a, threadUrl: t1 },
      // another doc's cell
      { targetUrl: cellRefUrl(OTHER, "d", "a"), threadUrl: t2 },
    ];
    const counts = threadsByCell(entries, DOC, "d");
    expect(counts.get("a")?.size).toBe(2);
    expect(counts.get("b")?.size).toBe(1);
    expect(threadsByCell(entries, DOC, "other").size).toBe(0);
    expect(refsOfThread(entries, t1).sort()).toEqual([a, b].sort());
    expect(refsOfThread(entries, "automerge:none")).toEqual([]);
  });
});

describe("describing a thread's target", () => {
  it("names one node, several, and edges", () => {
    expect(describeCells([])).toBeNull();
    expect(describeCells([node("a", "<b>Secure</b> boot&nbsp;verified")])).toBe("Node “Secure boot verified”");
    expect(describeCells([node("g", "", BLOCK_STYLES.or)])).toBe("Node “OR”");
    expect(describeCells([edge("e")])).toBe("Edge");
    expect(describeCells([edge("e"), edge("f")])).toBe("2 edges");
    expect(describeCells([node("a", "AND", BLOCK_STYLES.and), node("b", "HSM-held key")])).toBe(
      "2 nodes · AND, HSM-held key",
    );
    expect(describeCells([node("a", "A"), node("b", "B"), node("c", "C"), node("d", "D"), edge("e")])).toBe(
      "4 nodes, 1 edge · A, B, C, …",
    );
  });

  it("resolves refs against the doc, as the ref-view plugin", () => {
    const graph: GraphDoc = {
      title: "g",
      diagrams: [{ id: "d", name: "Page-1", model: {}, cells: [node("a", "Secure boot verified"), edge("e")] }],
    };
    const doc = { url: DOC, doc: () => graph };
    const ref = (cellId: string) => ({ url: cellRefUrl(DOC, "d", cellId), doc: () => undefined });
    expect(refView.describe([ref("a")], doc)).toBe("Node “Secure boot verified”");
    expect(refView.describe([ref("e")], doc)).toBe("Edge");
    expect(refView.describe([ref("gone")], doc)).toBeNull();
    expect(resolveCells([ref("a"), ref("gone"), ref("e")], doc).map((c) => c.id)).toEqual(["a", "e"]);

    const box = document.createElement("div");
    const cleanup = refView.thumbnail([ref("a")], doc, box);
    const rect = box.querySelector("svg rect")!;
    expect(rect.getAttribute("fill")).toBe("#d5e8d4");
    expect(rect.getAttribute("stroke")).toBe("#82b366");
    cleanup();
    expect(box.childElementCount).toBe(0);
  });

  it("draws an OR as a diamond and an edge as an arrow", () => {
    expect(drawThumbnail([node("g", "OR", BLOCK_STYLES.or)]).querySelector("path")).not.toBeNull();
    expect(drawThumbnail([node("g", "OR", BLOCK_STYLES.or)]).querySelector("rect")).toBeNull();
    expect(drawThumbnail([edge("e")]).querySelectorAll("path").length).toBe(2);
  });
});
