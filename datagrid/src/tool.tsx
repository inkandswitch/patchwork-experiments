import {
  RepoContext,
  useDocument,
} from "@automerge/automerge-repo-react-hooks";
import type { DocHandle } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import Handsontable from "handsontable";
import { HotTable, type HotTableRef } from "@handsontable/react-wrapper";
import "handsontable/styles/handsontable.min.css";
import "handsontable/styles/ht-theme-main.min.css";
import { registerAllModules } from "handsontable/registry";
import { HyperFormula } from "hyperformula";
import { useEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { DataGridDoc } from "./datatype";
import {
  columnCount,
  createEmptyCells,
  createEmptyRows,
  ensureCellWritable,
  ensureGridStructure,
} from "./grid-utils";

registerAllModules();

const FILL_CHAIN = `
.datagrid-root > div,
.datagrid-root .ht-root-wrapper,
.datagrid-root .ht-grid { height: 100%; }
`;

function DataGridEditor({ handle }: { handle: DocHandle<DataGridDoc> }) {
  const [doc] = useDocument<DataGridDoc>(handle.url);
  const containerRef = useRef<HTMLDivElement>(null);
  const hotRef = useRef<HotTableRef>(null);
  const formulaEngine = useRef(
    HyperFormula.buildEmpty({ licenseKey: "gpl-v3" }),
  ).current;
  const formulas = useMemo(() => ({ engine: formulaEngine }), [formulaEngine]);

  useEffect(() => {
    if (!doc) return;
    if (!doc.data?.length || !Array.isArray(doc.data[0])) {
      handle.change(ensureGridStructure);
    }
  }, [doc, handle]);

  const onBeforeHotChange = (
    changes: Array<Handsontable.CellChange | null>,
  ) => {
    handle.change((d) => {
      changes.forEach((change) => {
        if (!change) {
          return;
        }
        const [row, columnUntyped, , newValue] = change;
        const column = columnUntyped as number;
        ensureCellWritable(d, row, column);
        d.data[row][column] = newValue;
      });
    });
    return false;
  };

  const onBeforeCreateRow = (index: number, amount: number) => {
    handle.change((d) => {
      ensureGridStructure(d);
      const cols = columnCount(d.data);
      d.data.splice(index, 0, ...createEmptyRows(amount, cols));
    });
    return false;
  };

  const onBeforeCreateCol = (index: number, amount: number) => {
    handle.change((d) => {
      ensureGridStructure(d);
      d.data.forEach((row) => {
        row.splice(index, 0, ...createEmptyCells(amount));
      });
    });
    return false;
  };

  if (!doc?.data?.length) {
    return null;
  }

  return (
    // The grid fills the view and scrolls inside itself. It was `height="auto"`
    // in a div with no height (its `overflow-scroll` is a Tailwind class, and
    // there is no Tailwind here), so the table grew to every row and the view
    // clipped it: nothing below the fold could be reached.
    <div
      ref={containerRef}
      className="datagrid-root ht-theme-main"
      style={{ width: "100%", height: "100%", overflow: "hidden" }}
    >
      {/* Handsontable 17 wraps its grid in HotTable's div, .ht-root-wrapper
          and .ht-grid, none of which has a height, so its 100% came out as 0.
          Each fills the one above it, down to the grid. */}
      <style>{FILL_CHAIN}</style>
      <HotTable
        data={doc.data}
        beforeChange={onBeforeHotChange}
        beforeCreateRow={onBeforeCreateRow}
        beforeCreateCol={onBeforeCreateCol}
        rowHeaders={true}
        colHeaders={true}
        contextMenu={true}
        width="100%"
        height="100%"
        autoWrapRow={false}
        autoWrapCol={false}
        licenseKey="non-commercial-and-evaluation"
        formulas={formulas}
      />
    </div>
  );
}

export const DatagridTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <DataGridEditor handle={handle as DocHandle<DataGridDoc>} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};
