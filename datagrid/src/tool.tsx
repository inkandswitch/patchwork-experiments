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
    <div
      ref={containerRef}
      className="datagrid-root ht-theme-main overflow-scroll eldritch-horrors"
    >
      <HotTable
        data={doc.data}
        beforeChange={onBeforeHotChange}
        beforeCreateRow={onBeforeCreateRow}
        beforeCreateCol={onBeforeCreateCol}
        rowHeaders={true}
        colHeaders={true}
        contextMenu={true}
        width="auto"
        height="auto"
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
