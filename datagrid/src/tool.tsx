import {
  RepoContext,
  useDocument,
  useDocHandle,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import Handsontable from "handsontable";
import { HotTable } from "@handsontable/react";
import "handsontable/dist/handsontable.full.min.css";
import { registerAllModules } from "handsontable/registry";
import { registerRenderer, textRenderer } from "handsontable/renderers";
import { HyperFormula } from "hyperformula";
import { createRoot } from "react-dom/client";
import type { DataGridDoc } from "./datatype";

registerAllModules();

registerRenderer("addedCell", (hotInstance, TD, ...rest) => {
  textRenderer(hotInstance, TD, ...rest);
  TD.style.outline = "solid 1px rgb(0 100 0 / 80%)";
  TD.style.background = "rgb(0 255 0 / 10%)";
});

function DataGridEditor({ docUrl }: { docUrl: AutomergeUrl }) {
  const [doc] = useDocument<DataGridDoc>(docUrl);
  const handle = useDocHandle<DataGridDoc>(docUrl)!;

  const onBeforeHotChange = (
    changes: Array<Handsontable.CellChange | null>
  ) => {
    handle.change((d) => {
      changes.forEach((change) => {
        if (!change) {
          return;
        }
        const [row, columnUntyped, , newValue] = change;
        const column = columnUntyped as number;
        if (column > d.data[0].length) {
          d.data[0][column] = "";
        }
        if (!d.data[row]) {
          d.data[row] = new Array(column).fill(null);
        }
        d.data[row][column] = newValue;
      });
    });
    return false;
  };

  const onBeforeCreateRow = (index: number, amount: number) => {
    handle.change((d) => {
      d.data.splice(
        index,
        0,
        ...new Array(amount).fill(new Array(d.data[0].length).fill(null))
      );
    });
    return false;
  };

  const onBeforeCreateCol = (index: number, amount: number) => {
    handle.change((d) => {
      d.data.forEach((row) => {
        row.splice(index, 0, ...new Array(amount).fill(null));
      });
    });
    return false;
  };

  if (!doc) {
    return null;
  }

  return (
    <div className="w-full h-full overflow-hidden">
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
        formulas={{ engine: HyperFormula }}
      />
    </div>
  );
}

export const DatagridTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <DataGridEditor docUrl={handle.url} />
    </RepoContext.Provider>
  );
  return () => root.unmount();
};
