import { render } from "solid-js/web";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";
import {
  RepoContext,
  useDocument,
} from "@automerge/automerge-repo-solid-primitives";
import type { DocHandle, AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import type { DatalogDoc } from "../spec/types";
import type { SpecDoc, WorkflowArtifactDoc } from "../workflow-types";
import {
  appendProjectionRow,
  applyProjectionCellEdit,
  deleteProjectionRow,
  materializeProjection,
  type ArtifactProjectionAnnotation,
  type MaterializedProjection,
  type ProjectionDoc,
  type TableProjectionSpecDoc,
} from "./artifact-projection";
import "./artifact-projection.css";

type ToolElement = HTMLElement & { repo: any };
type CellPosition = { row: number; col: number };
type ArtifactDocLike = Pick<DatalogDoc, "title" | "facts" | "draftText">;

function isTableProjectionDoc(
  projection: ProjectionDoc | undefined,
): projection is TableProjectionSpecDoc {
  return Boolean(
    projection &&
    (projection.viewKind ?? "table") === "table" &&
    projection.rows &&
    Array.isArray(projection.columns),
  );
}

export const ArtifactProjectionTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <ArtifactProjectionWorkspace
          handle={handle as DocHandle<WorkflowArtifactDoc>}
          element={element as ToolElement}
        />
      </RepoContext.Provider>
    ),
    element,
  );
  return () => dispose();
};

function ArtifactProjectionWorkspace(props: {
  handle: DocHandle<WorkflowArtifactDoc>;
  element: ToolElement;
}) {
  const [workflowArtifact] = useDocument<WorkflowArtifactDoc>(
    () => props.handle.url,
  );
  const [externalAnnotations, setExternalAnnotations] = createSignal<
    ArtifactProjectionAnnotation[]
  >(readAnnotations(props.element));

  const observer = new MutationObserver(() => {
    setExternalAnnotations(readAnnotations(props.element));
  });
  observer.observe(props.element, {
    attributes: true,
    attributeFilter: ["data-annotations"],
  });
  onCleanup(() => observer.disconnect());

  const [artifactDoc] = useDocument<ArtifactDocLike>(
    () => workflowArtifact()?.artifactDocUrl,
  );
  const [artifactHandle] = createHandleResource<ArtifactDocLike>(
    props.element.repo,
    () => workflowArtifact()?.artifactDocUrl,
  );
  const [specDoc] = useDocument<SpecDoc>(() => workflowArtifact()?.specDocUrl);
  const projectionUrl = createMemo(() => specDoc()?.spec?.projectionDocUrl);
  const [projectionDoc] = useDocument<ProjectionDoc>(() => projectionUrl());
  const [projectionHandle] = createHandleResource<ProjectionDoc>(
    props.element.repo,
    projectionUrl,
  );

  return (
    <div class="artifact-projection-root">
      <Show
        when={workflowArtifact()}
        fallback={<div class="artifact-projection-loading">Loading...</div>}
      >
        {(artifact) => (
          <div class="artifact-projection-shell no-picker">
            <div class="artifact-projection-panel">
              <Show
                when={
                  artifactDoc() &&
                  specDoc() &&
                  projectionDoc() &&
                  projectionUrl()
                }
                fallback={
                  <Show
                    when={artifactDoc() && specDoc()}
                    fallback={
                      <div class="artifact-projection-loading">Loading...</div>
                    }
                  >
                    <Show
                      when={!projectionUrl()}
                      fallback={
                        <div class="artifact-projection-loading">
                          Loading...
                        </div>
                      }
                    >
                      <div class="artifact-projection-empty-state">
                        <div class="artifact-projection-empty-card">
                          <div class="artifact-projection-empty-eyebrow">
                            Artifact Sheet
                          </div>
                          <h2>No projection yet</h2>
                          <p>
                            This artifact&apos;s spec does not have a reusable
                            projection definition yet.
                          </p>
                        </div>
                      </div>
                    </Show>
                  </Show>
                }
              >
                <ProjectionViewSwitcher
                  projection={projectionDoc}
                  projectionHandle={projectionHandle}
                  projectionUrl={projectionUrl}
                  artifactDoc={artifactDoc}
                  artifactHandle={artifactHandle}
                  artifactUrl={() => artifact().artifactDocUrl}
                  externalAnnotations={externalAnnotations}
                />
              </Show>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

function ProjectionViewSwitcher(props: {
  projection: () => ProjectionDoc | undefined;
  projectionHandle: () => DocHandle<ProjectionDoc> | undefined;
  projectionUrl: () => AutomergeUrl | undefined;
  artifactDoc: () => ArtifactDocLike | undefined;
  artifactHandle: () => DocHandle<ArtifactDocLike> | undefined;
  artifactUrl: () => AutomergeUrl | undefined;
  externalAnnotations: () => ArtifactProjectionAnnotation[];
}) {
  const viewKind = createMemo(() => props.projection()?.viewKind ?? "table");

  return (
    <Show
      when={viewKind() === "key-value"}
      fallback={<ProjectionSheetView {...props} />}
    >
      <ProjectionKeyValueView {...props} />
    </Show>
  );
}

function ProjectionSheetView(props: {
  projection: () => ProjectionDoc | undefined;
  projectionHandle: () => DocHandle<ProjectionDoc> | undefined;
  projectionUrl: () => AutomergeUrl | undefined;
  artifactDoc: () => ArtifactDocLike | undefined;
  artifactHandle: () => DocHandle<ArtifactDocLike> | undefined;
  artifactUrl: () => AutomergeUrl | undefined;
  externalAnnotations: () => ArtifactProjectionAnnotation[];
}) {
  const [selection, setSelection] = createSignal<CellPosition | null>(null);
  const [editingCell, setEditingCell] = createSignal<CellPosition | null>(null);
  const [draftValue, setDraftValue] = createSignal("");
  const [localAnnotations, setLocalAnnotations] = createSignal<
    ArtifactProjectionAnnotation[]
  >([]);
  const [localError, setLocalError] = createSignal<string | null>(null);
  let gridRoot!: HTMLDivElement;

  createEffect(() => {
    const activeCell = editingCell();
    if (!activeCell) return;

    queueMicrotask(() => {
      const input = gridRoot?.querySelector<HTMLInputElement>(
        `[data-cell-input="${activeCell.row}:${activeCell.col}"]`,
      );
      input?.focus();
      input?.select();
    });
  });

  const materialized = createMemo<Extract<
    MaterializedProjection,
    { viewKind: "table" }
  > | null>(() => {
    const currentProjection = props.projection();
    const currentArtifact = props.artifactDoc();
    const currentProjectionUrl = props.projectionUrl();
    if (!currentProjection || !currentArtifact || !currentProjectionUrl)
      return null;
    const next = materializeProjection(currentProjection, currentArtifact, {
      projectionUrl: currentProjectionUrl,
    });
    return next.viewKind === "table" ? next : null;
  });
  const visibleSheet = createMemo(() => {
    const current = materialized();
    return current && current.columns.length > 0 ? current : null;
  });

  const annotations = createMemo(() =>
    dedupeAnnotations([
      ...(materialized()?.annotations ?? []),
      ...props.externalAnnotations(),
      ...localAnnotations(),
    ]),
  );
  const columnCount = createMemo(() => materialized()?.columns.length ?? 0);
  const selectionLabel = createMemo(() => {
    const currentSelection = selection();
    const currentMaterialized = materialized();
    if (!currentSelection || !currentMaterialized) return "No selection";

    const column = currentMaterialized.columns[currentSelection.col];
    if (!column) return "No selection";
    if (currentSelection.row === 0)
      return `Header ${columnLabel(currentSelection.col)}`;
    return `${columnLabel(currentSelection.col)}${currentSelection.row + 1}`;
  });

  const annotationSummary = createMemo(() => {
    const currentSelection = selection();
    const currentMaterialized = materialized();
    const all = annotations();
    if (!currentSelection || !currentMaterialized) return all;

    const currentColumn = currentMaterialized.columns[currentSelection.col];
    if (!currentColumn) return all;

    const focused =
      currentSelection.row === 0
        ? all.filter(
            (annotation) =>
              annotation.kind === "sheet" ||
              annotation.columnId === currentColumn.id,
          )
        : all.filter((annotation) => {
            const currentRow =
              currentMaterialized.rows[currentSelection.row - 1];
            if (!currentRow) return annotation.kind === "sheet";
            return (
              annotation.kind === "sheet" ||
              annotation.rowId === currentRow.rowId ||
              annotation.columnId === currentColumn.id
            );
          });
    return focused.length > 0 ? focused : all;
  });

  createEffect(() => {
    const currentMaterialized = materialized();
    const currentSelection = selection();

    if (!currentMaterialized || currentMaterialized.columns.length === 0) {
      setSelection(null);
      setEditingCell(null);
      setDraftValue("");
      return;
    }

    const maxRow = currentMaterialized.rows.length;
    const maxCol = currentMaterialized.columns.length - 1;

    if (!currentSelection) {
      setSelection({ row: 0, col: 0 });
      return;
    }

    const nextRow = clamp(currentSelection.row, 0, maxRow);
    const nextCol = clamp(currentSelection.col, 0, maxCol);
    if (nextRow !== currentSelection.row || nextCol !== currentSelection.col) {
      setSelection({ row: nextRow, col: nextCol });
    }
  });

  function focusGrid() {
    queueMicrotask(() => gridRoot?.focus());
  }

  function clearLocalFeedback() {
    setLocalError(null);
    setLocalAnnotations([]);
  }

  function persistArtifactDoc(nextDoc: ArtifactDocLike) {
    const handle = props.artifactHandle();
    if (!handle) return;
    handle.change((doc: ArtifactDocLike) => {
      doc.title = nextDoc.title;
      doc.facts = nextDoc.facts.map((fact) => ({
        ...fact,
        args: [...fact.args],
      }));
      doc.draftText = nextDoc.draftText;
    });
  }

  function selectCell(position: CellPosition) {
    setSelection(position);
    focusGrid();
  }

  function isEditable(position: CellPosition) {
    const currentMaterialized = materialized();
    if (!currentMaterialized) return false;
    if (position.row === 0) return true;
    return (
      currentMaterialized.rows[position.row - 1]?.cells[position.col]
        ?.editable ?? false
    );
  }

  function getCellValue(position: CellPosition) {
    const currentMaterialized = materialized();
    if (!currentMaterialized) return "";
    if (position.row === 0)
      return currentMaterialized.columns[position.col]?.header ?? "";
    return (
      currentMaterialized.rows[position.row - 1]?.cells[position.col]?.value ??
      ""
    );
  }

  function startEditing(position: CellPosition, seedValue?: string) {
    if (!isEditable(position)) return;
    setSelection(position);
    setEditingCell(position);
    setDraftValue(seedValue ?? getCellValue(position));
  }

  function commitHeaderEdit(position: CellPosition, value: string) {
    const currentProjection = props.projection();
    const handle = props.projectionHandle();
    if (!isTableProjectionDoc(currentProjection) || !handle) return;
    const currentColumn = currentProjection.columns.filter(
      (column) => !column.hidden,
    )[position.col];
    if (!currentColumn) return;

    handle.change((doc) => {
      if (!isTableProjectionDoc(doc)) return;
      const target = doc.columns.find(
        (column) => column.id === currentColumn.id,
      );
      if (target) target.header = value.trim();
    });
    clearLocalFeedback();
  }

  function commitBodyEdit(position: CellPosition, value: string) {
    const currentProjection = props.projection();
    const currentArtifact = props.artifactDoc();
    const currentMaterialized = materialized();
    const currentProjectionUrl = props.projectionUrl();
    if (
      !currentProjection ||
      !currentArtifact ||
      !currentMaterialized ||
      !currentProjectionUrl
    )
      return;

    const row = currentMaterialized.rows[position.row - 1];
    const column = currentMaterialized.columns[position.col];
    if (!row || !column) return;

    const result = applyProjectionCellEdit(
      currentProjection,
      currentArtifact,
      row.rowId,
      column.id,
      value,
      props.artifactUrl(),
      { projectionUrl: currentProjectionUrl },
    );

    if (!result.ok) {
      setLocalError(result.error);
      setLocalAnnotations(result.annotations);
      return;
    }

    persistArtifactDoc(result.doc);
    clearLocalFeedback();
  }

  function finishEditing(options?: {
    commit?: boolean;
    nextSelection?: CellPosition;
  }) {
    const activeCell = editingCell();
    if (!activeCell) {
      if (options?.nextSelection) setSelection(options.nextSelection);
      focusGrid();
      return;
    }

    if (options?.commit ?? true) {
      if (activeCell.row === 0) commitHeaderEdit(activeCell, draftValue());
      else commitBodyEdit(activeCell, draftValue());
    }

    setEditingCell(null);
    setDraftValue("");
    setSelection(options?.nextSelection ?? activeCell);
    focusGrid();
  }

  function moveSelection(rowDelta: number, colDelta: number) {
    const currentSelection = selection();
    const currentMaterialized = materialized();
    if (!currentSelection || !currentMaterialized) return;

    setSelection({
      row: clamp(
        currentSelection.row + rowDelta,
        0,
        currentMaterialized.rows.length,
      ),
      col: clamp(
        currentSelection.col + colDelta,
        0,
        Math.max(0, currentMaterialized.columns.length - 1),
      ),
    });
  }

  function appendRow() {
    const currentProjection = props.projection();
    const currentArtifact = props.artifactDoc();
    const currentProjectionUrl = props.projectionUrl();
    if (!currentProjection || !currentArtifact || !currentProjectionUrl) return;

    const result = appendProjectionRow(currentProjection, currentArtifact, {
      projectionUrl: currentProjectionUrl,
    });
    if (!result.ok) {
      setLocalError(result.error);
      setLocalAnnotations(result.annotations);
      focusGrid();
      return;
    }
    persistArtifactDoc(result.doc);
    clearLocalFeedback();
    setSelection({
      row: (materialized()?.rows.length ?? 0) + 1,
      col: selection()?.col ?? 0,
    });
    focusGrid();
  }

  function deleteRow(rowIndex: number) {
    const currentProjection = props.projection();
    const currentArtifact = props.artifactDoc();
    const currentMaterialized = materialized();
    const currentProjectionUrl = props.projectionUrl();
    if (
      !currentProjection ||
      !currentArtifact ||
      !currentMaterialized ||
      !currentProjectionUrl
    )
      return;

    const row = currentMaterialized.rows[rowIndex - 1];
    if (!row) return;

    const result = deleteProjectionRow(
      currentProjection,
      currentArtifact,
      row.rowId,
      props.artifactUrl(),
      { projectionUrl: currentProjectionUrl },
    );
    if (!result.ok) {
      setLocalError(result.error);
      setLocalAnnotations(result.annotations);
      focusGrid();
      return;
    }

    persistArtifactDoc(result.doc);
    clearLocalFeedback();
    setSelection({
      row: clamp(rowIndex, 0, Math.max(0, currentMaterialized.rows.length - 1)),
      col: clamp(selection()?.col ?? 0, 0, Math.max(0, columnCount() - 1)),
    });
    focusGrid();
  }

  function selectedVisibleColumnId() {
    const currentSelection = selection();
    const currentMaterialized = materialized();
    if (!currentSelection || !currentMaterialized) return null;
    return currentMaterialized.columns[currentSelection.col]?.id ?? null;
  }

  function moveSelectedColumn(direction: -1 | 1) {
    const targetColumnId = selectedVisibleColumnId();
    const handle = props.projectionHandle();
    if (!targetColumnId || !handle) return;

    handle.change((doc) => {
      if (!isTableProjectionDoc(doc)) return;
      const currentIndex = doc.columns.findIndex(
        (column) => column.id === targetColumnId,
      );
      if (currentIndex < 0) return;

      let swapIndex = currentIndex + direction;
      while (
        swapIndex >= 0 &&
        swapIndex < doc.columns.length &&
        doc.columns[swapIndex]?.hidden
      ) {
        swapIndex += direction;
      }
      if (swapIndex < 0 || swapIndex >= doc.columns.length) return;

      const [column] = doc.columns.splice(currentIndex, 1);
      doc.columns.splice(swapIndex, 0, column);
    });
    clearLocalFeedback();
  }

  function hideSelectedColumn() {
    const targetColumnId = selectedVisibleColumnId();
    const handle = props.projectionHandle();
    if (!targetColumnId || !handle) return;

    handle.change((doc) => {
      if (!isTableProjectionDoc(doc)) return;
      const column = doc.columns.find((entry) => entry.id === targetColumnId);
      if (column) column.hidden = true;
    });
    clearLocalFeedback();
    setSelection((current) =>
      current
        ? {
            row: current.row,
            col: clamp(current.col, 0, Math.max(0, columnCount() - 2)),
          }
        : current,
    );
  }

  function showHiddenColumn(columnId: string) {
    const handle = props.projectionHandle();
    if (!handle) return;

    handle.change((doc) => {
      if (!isTableProjectionDoc(doc)) return;
      const column = doc.columns.find((entry) => entry.id === columnId);
      if (column) column.hidden = false;
    });
    clearLocalFeedback();
  }

  function clearSelectedCell() {
    const currentSelection = selection();
    if (!currentSelection || !isEditable(currentSelection)) return;
    if (currentSelection.row === 0) return;
    commitBodyEdit(currentSelection, "");
  }

  function handleGridKeyDown(event: KeyboardEvent) {
    if (editingCell()) return;
    const currentSelection = selection();
    const currentMaterialized = materialized();
    if (
      !currentSelection ||
      !currentMaterialized ||
      currentMaterialized.columns.length === 0
    )
      return;

    const isPrintable =
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey;

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        moveSelection(-1, 0);
        break;
      case "ArrowDown":
        event.preventDefault();
        moveSelection(1, 0);
        break;
      case "ArrowLeft":
        event.preventDefault();
        moveSelection(0, -1);
        break;
      case "ArrowRight":
        event.preventDefault();
        moveSelection(0, 1);
        break;
      case "Tab": {
        event.preventDefault();
        const nextCol = currentSelection.col + (event.shiftKey ? -1 : 1);
        if (nextCol >= currentMaterialized.columns.length) {
          if (
            currentSelection.row === currentMaterialized.rows.length &&
            currentSelection.row > 0
          ) {
            appendRow();
          } else {
            setSelection({
              row: clamp(
                currentSelection.row + 1,
                0,
                currentMaterialized.rows.length,
              ),
              col: 0,
            });
          }
        } else if (nextCol < 0) {
          setSelection({
            row: clamp(
              currentSelection.row - 1,
              0,
              currentMaterialized.rows.length,
            ),
            col: currentMaterialized.columns.length - 1,
          });
        } else {
          setSelection({ row: currentSelection.row, col: nextCol });
        }
        break;
      }
      case "Enter":
      case "F2":
        event.preventDefault();
        startEditing(currentSelection);
        break;
      case "Backspace":
      case "Delete":
        event.preventDefault();
        clearSelectedCell();
        break;
      default:
        if (isPrintable && isEditable(currentSelection)) {
          event.preventDefault();
          startEditing(currentSelection, event.key);
        }
    }
  }

  function handleInputKeyDown(event: KeyboardEvent) {
    const activeCell = editingCell();
    const currentMaterialized = materialized();
    if (!activeCell || !currentMaterialized) return;

    if (event.key === "Escape") {
      event.preventDefault();
      finishEditing({ commit: false });
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      finishEditing({
        nextSelection: {
          row: clamp(activeCell.row + 1, 0, currentMaterialized.rows.length),
          col: activeCell.col,
        },
      });
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      const nextCol = activeCell.col + (event.shiftKey ? -1 : 1);
      const nextSelection =
        nextCol >= currentMaterialized.columns.length
          ? {
              row: clamp(
                activeCell.row + 1,
                0,
                currentMaterialized.rows.length,
              ),
              col: 0,
            }
          : nextCol < 0
            ? {
                row: clamp(
                  activeCell.row - 1,
                  0,
                  currentMaterialized.rows.length,
                ),
                col: currentMaterialized.columns.length - 1,
              }
            : { row: activeCell.row, col: nextCol };
      finishEditing({ nextSelection });
    }
  }

  function isSelected(row: number, col: number) {
    const currentSelection = selection();
    return currentSelection?.row === row && currentSelection?.col === col;
  }

  function isEditing(row: number, col: number) {
    const activeCell = editingCell();
    return activeCell?.row === row && activeCell?.col === col;
  }

  function annotationsForColumn(columnId: string) {
    return annotations().filter(
      (annotation) => annotation.columnId === columnId,
    );
  }

  function annotationsForRow(rowId: string) {
    return annotations().filter(
      (annotation) => annotation.rowId === rowId && annotation.kind === "row",
    );
  }

  function annotationsForCell(rowId: string, columnId: string) {
    return annotations().filter(
      (annotation) =>
        (annotation.kind === "cell" &&
          annotation.rowId === rowId &&
          annotation.columnId === columnId) ||
        (annotation.kind === "row" && annotation.rowId === rowId) ||
        (annotation.kind === "column" && annotation.columnId === columnId),
    );
  }

  return (
    <Show
      when={visibleSheet()}
      fallback={
        <div class="artifact-projection-empty-state">
          <div class="artifact-projection-empty-card">
            <div class="artifact-projection-empty-eyebrow">Artifact Sheet</div>
            <h2>Projection unavailable</h2>
            <p>This projection does not define any visible columns yet.</p>
          </div>
        </div>
      }
    >
      {(sheet) => (
        <div
          class="artifact-projection-workspace"
          ref={gridRoot}
          tabindex="0"
          onKeyDown={(event) => handleGridKeyDown(event)}
        >
          <div class="artifact-projection-toolbar">
            <div class="artifact-projection-toolbar-group">
              <button
                class="artifact-projection-toolbar-button"
                onClick={appendRow}
              >
                Add row
              </button>
            </div>
            <div class="artifact-projection-toolbar-group">
              <button
                class="artifact-projection-toolbar-button"
                onClick={() => moveSelectedColumn(-1)}
                disabled={(selection()?.col ?? 0) <= 0}
              >
                Move column left
              </button>
              <button
                class="artifact-projection-toolbar-button"
                onClick={() => moveSelectedColumn(1)}
                disabled={(selection()?.col ?? 0) >= sheet().columns.length - 1}
              >
                Move column right
              </button>
              <button
                class="artifact-projection-toolbar-button"
                onClick={hideSelectedColumn}
                disabled={sheet().columns.length <= 1}
              >
                Hide column
              </button>
              <button
                class="artifact-projection-toolbar-button"
                onClick={() => deleteRow(selection()?.row ?? -1)}
                disabled={(selection()?.row ?? 0) <= 0}
              >
                Delete row
              </button>
            </div>
            <div class="artifact-projection-toolbar-status">
              {selectionLabel()}
            </div>
          </div>

          <Show when={sheet().hiddenColumns.length > 0}>
            <div class="artifact-projection-toolbar">
              <div class="artifact-projection-toolbar-group">
                <For each={sheet().hiddenColumns}>
                  {(column) => (
                    <button
                      class="artifact-projection-toolbar-button"
                      onClick={() => showHiddenColumn(column.id)}
                    >
                      Show {column.header}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <Show when={localError()}>
            {(message) => (
              <div class="artifact-projection-issues">
                <div class="artifact-projection-issues-header">
                  <span>Edit issue</span>
                </div>
                <div class="artifact-projection-issue-list">
                  <div class="artifact-projection-issue-card">
                    <div class="artifact-projection-issue-label">
                      Current edit
                    </div>
                    <div class="artifact-projection-issue-text">
                      {message()}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Show>

          <Show when={annotations().length > 0}>
            <div class="artifact-projection-issues">
              <div class="artifact-projection-issues-header">
                <span>Verification issues</span>
                <span>{annotations().length}</span>
              </div>
              <div class="artifact-projection-issue-list">
                <For each={annotationSummary()}>
                  {(annotation) => (
                    <div class="artifact-projection-issue-card">
                      <div class="artifact-projection-issue-label">
                        {describeAnnotation(annotation, sheet())}
                      </div>
                      <div class="artifact-projection-issue-text">
                        {annotation.message}
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <div class="artifact-projection-table-wrapper">
            <table class="artifact-projection-table">
              <thead>
                <tr>
                  <th class="artifact-projection-corner-cell">#</th>
                  <For each={sheet().columns}>
                    {(column, colIndex) => (
                      <th
                        classList={{
                          "artifact-projection-header-cell": true,
                          "artifact-projection-selected": isSelected(
                            0,
                            colIndex(),
                          ),
                          "artifact-projection-has-issue":
                            annotationsForColumn(column.id).length > 0,
                        }}
                        onClick={() => selectCell({ row: 0, col: colIndex() })}
                        onDblClick={() =>
                          startEditing({ row: 0, col: colIndex() })
                        }
                      >
                        <div class="artifact-projection-header-content">
                          <div class="artifact-projection-column-label">
                            {columnLabel(colIndex())}
                          </div>
                          <Show
                            when={isEditing(0, colIndex())}
                            fallback={
                              <span class="artifact-projection-cell-text">
                                {column.header}
                              </span>
                            }
                          >
                            <input
                              class="artifact-projection-cell-input"
                              data-cell-input={`0:${colIndex()}`}
                              value={draftValue()}
                              onInput={(event) =>
                                setDraftValue(event.currentTarget.value)
                              }
                              onKeyDown={(event) => handleInputKeyDown(event)}
                              onBlur={() => finishEditing()}
                            />
                          </Show>
                        </div>
                      </th>
                    )}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={sheet().rows}>
                  {(row, rowIndex) => {
                    const actualRow = () => rowIndex() + 1;
                    return (
                      <tr
                        classList={{
                          "artifact-projection-row-has-issue":
                            annotationsForRow(row.rowId).length > 0,
                        }}
                      >
                        <td class="artifact-projection-row-number">
                          <div class="artifact-projection-row-number-label">
                            {actualRow()}
                          </div>
                          <div class="artifact-projection-row-actions">
                            <button
                              class="artifact-projection-action-button"
                              title="Delete row"
                              onClick={() => deleteRow(actualRow())}
                            >
                              -
                            </button>
                          </div>
                        </td>
                        <For each={row.cells}>
                          {(cell, colIndex) => (
                            <td
                              classList={{
                                "artifact-projection-cell": true,
                                "artifact-projection-selected": isSelected(
                                  actualRow(),
                                  colIndex(),
                                ),
                                "artifact-projection-has-issue":
                                  annotationsForCell(row.rowId, cell.columnId)
                                    .length > 0,
                              }}
                              onClick={() =>
                                selectCell({
                                  row: actualRow(),
                                  col: colIndex(),
                                })
                              }
                              onDblClick={() =>
                                startEditing({
                                  row: actualRow(),
                                  col: colIndex(),
                                })
                              }
                            >
                              <Show
                                when={isEditing(actualRow(), colIndex())}
                                fallback={
                                  <span class="artifact-projection-cell-text">
                                    {cell.value}
                                  </span>
                                }
                              >
                                <input
                                  class="artifact-projection-cell-input"
                                  data-cell-input={`${actualRow()}:${colIndex()}`}
                                  value={draftValue()}
                                  onInput={(event) =>
                                    setDraftValue(event.currentTarget.value)
                                  }
                                  onKeyDown={(event) =>
                                    handleInputKeyDown(event)
                                  }
                                  onBlur={() => finishEditing()}
                                />
                              </Show>
                            </td>
                          )}
                        </For>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Show>
  );
}

function ProjectionKeyValueView(props: {
  projection: () => ProjectionDoc | undefined;
  projectionHandle: () => DocHandle<ProjectionDoc> | undefined;
  projectionUrl: () => AutomergeUrl | undefined;
  artifactDoc: () => ArtifactDocLike | undefined;
  artifactHandle: () => DocHandle<ArtifactDocLike> | undefined;
  artifactUrl: () => AutomergeUrl | undefined;
  externalAnnotations: () => ArtifactProjectionAnnotation[];
}) {
  const [editingEntryId, setEditingEntryId] = createSignal<string | null>(null);
  const [draftValue, setDraftValue] = createSignal("");
  const [localAnnotations, setLocalAnnotations] = createSignal<
    ArtifactProjectionAnnotation[]
  >([]);
  const [localError, setLocalError] = createSignal<string | null>(null);

  const materialized = createMemo(() => {
    const currentProjection = props.projection();
    const currentArtifact = props.artifactDoc();
    const currentProjectionUrl = props.projectionUrl();
    if (!currentProjection || !currentArtifact || !currentProjectionUrl)
      return null;
    const next = materializeProjection(currentProjection, currentArtifact, {
      projectionUrl: currentProjectionUrl,
    });
    return next.viewKind === "key-value" ? next : null;
  });

  const annotations = createMemo(() =>
    dedupeAnnotations([
      ...(materialized()?.annotations ?? []),
      ...props.externalAnnotations(),
      ...localAnnotations(),
    ]),
  );

  function clearLocalFeedback() {
    setLocalError(null);
    setLocalAnnotations([]);
  }

  function persistArtifactDoc(nextDoc: ArtifactDocLike) {
    const handle = props.artifactHandle();
    if (!handle) return;
    handle.change((doc: ArtifactDocLike) => {
      doc.title = nextDoc.title;
      doc.facts = nextDoc.facts.map((fact) => ({
        ...fact,
        args: [...fact.args],
      }));
      doc.draftText = nextDoc.draftText;
    });
  }

  function startEditing(entryId: string, seedValue: string) {
    setEditingEntryId(entryId);
    setDraftValue(seedValue);
  }

  function finishEditing(commit = true) {
    const activeEntryId = editingEntryId();
    const currentProjection = props.projection();
    const currentArtifact = props.artifactDoc();
    const currentProjectionUrl = props.projectionUrl();
    if (!activeEntryId) return;

    if (
      commit &&
      currentProjection &&
      currentArtifact &&
      currentProjectionUrl
    ) {
      const result = applyProjectionCellEdit(
        currentProjection,
        currentArtifact,
        "",
        activeEntryId,
        draftValue(),
        props.artifactUrl(),
        { projectionUrl: currentProjectionUrl },
      );
      if (!result.ok) {
        setLocalError(result.error);
        setLocalAnnotations(result.annotations);
        return;
      }
      persistArtifactDoc(result.doc);
      clearLocalFeedback();
    }

    setEditingEntryId(null);
    setDraftValue("");
  }

  function annotationsForEntry(entryId: string) {
    return annotations().filter(
      (annotation) =>
        annotation.kind === "entry" && annotation.entryId === entryId,
    );
  }

  return (
    <Show
      when={materialized()}
      fallback={
        <div class="artifact-projection-empty-state">
          <div class="artifact-projection-empty-card">
            <div class="artifact-projection-empty-eyebrow">Artifact View</div>
            <h2>Projection unavailable</h2>
            <p>This projection does not define any visible entries yet.</p>
          </div>
        </div>
      }
    >
      {(view) => (
        <div class="artifact-projection-workspace">
          <div class="artifact-projection-toolbar">
            <div class="artifact-projection-toolbar-group">
              <strong>{view().title}</strong>
            </div>
            <div class="artifact-projection-toolbar-status">
              {view().entries.length} entries
            </div>
          </div>

          <Show when={localError()}>
            {(message) => (
              <div class="artifact-projection-issues">
                <div class="artifact-projection-issues-header">
                  <span>Edit issue</span>
                </div>
                <div class="artifact-projection-issue-list">
                  <div class="artifact-projection-issue-card">
                    <div class="artifact-projection-issue-label">
                      Current edit
                    </div>
                    <div class="artifact-projection-issue-text">
                      {message()}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Show>

          <Show when={annotations().length > 0}>
            <div class="artifact-projection-issues">
              <div class="artifact-projection-issues-header">
                <span>Verification issues</span>
                <span>{annotations().length}</span>
              </div>
              <div class="artifact-projection-issue-list">
                <For each={annotations()}>
                  {(annotation) => (
                    <div class="artifact-projection-issue-card">
                      <div class="artifact-projection-issue-label">
                        {describeKeyValueAnnotation(annotation, view())}
                      </div>
                      <div class="artifact-projection-issue-text">
                        {annotation.message}
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <div class="artifact-projection-issues">
            <div class="artifact-projection-issues-header">
              <span>Settings</span>
              <span>{view().entries.length}</span>
            </div>
            <div class="artifact-projection-issue-list">
              <For each={view().entries}>
                {(entry) => (
                  <div
                    class="artifact-projection-issue-card"
                    classList={{
                      "artifact-projection-has-issue":
                        annotationsForEntry(entry.id).length > 0,
                    }}
                  >
                    <div class="artifact-projection-issue-label">
                      {entry.label}
                    </div>
                    <div class="artifact-projection-issue-text">
                      <Show
                        when={editingEntryId() === entry.id}
                        fallback={
                          <button
                            class="artifact-projection-toolbar-button"
                            onClick={() => startEditing(entry.id, entry.value)}
                            disabled={!entry.editable}
                            type="button"
                          >
                            {entry.value || "(blank)"}
                          </button>
                        }
                      >
                        <input
                          class="artifact-projection-cell-input"
                          value={draftValue()}
                          onInput={(event) =>
                            setDraftValue(event.currentTarget.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              finishEditing(true);
                            }
                            if (event.key === "Escape") {
                              event.preventDefault();
                              finishEditing(false);
                            }
                          }}
                          onBlur={() => finishEditing(true)}
                        />
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}

function readAnnotations(element: HTMLElement): ArtifactProjectionAnnotation[] {
  const raw = element.getAttribute("data-annotations");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed as ArtifactProjectionAnnotation[])
      : [];
  } catch {
    return [];
  }
}

function dedupeAnnotations(annotations: ArtifactProjectionAnnotation[]) {
  const seen = new Set<string>();
  return annotations.filter((annotation) => {
    const key = JSON.stringify([
      annotation.kind,
      annotation.rowId ?? null,
      annotation.columnId ?? null,
      annotation.entryId ?? null,
      annotation.message,
      annotation.constraintLabel ?? null,
      annotation.source,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function columnLabel(index: number): string {
  let label = "";
  let value = index;
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function describeAnnotation(
  annotation: ArtifactProjectionAnnotation,
  sheet: Extract<MaterializedProjection, { viewKind: "table" }>,
) {
  if (annotation.kind === "cell" && annotation.rowId && annotation.columnId) {
    const rowIndex = sheet.rows.findIndex(
      (row) => row.rowId === annotation.rowId,
    );
    const colIndex = sheet.columns.findIndex(
      (column) => column.id === annotation.columnId,
    );
    if (rowIndex >= 0 && colIndex >= 0)
      return `${columnLabel(colIndex)}${rowIndex + 2}`;
  }
  if (annotation.kind === "row" && annotation.rowId) {
    const rowIndex = sheet.rows.findIndex(
      (row) => row.rowId === annotation.rowId,
    );
    if (rowIndex >= 0) return `Row ${rowIndex + 2}`;
  }
  if (annotation.kind === "column" && annotation.columnId) {
    const colIndex = sheet.columns.findIndex(
      (column) => column.id === annotation.columnId,
    );
    if (colIndex >= 0) return `Column ${columnLabel(colIndex)}`;
  }
  return "Sheet";
}

function describeKeyValueAnnotation(
  annotation: ArtifactProjectionAnnotation,
  view: Extract<MaterializedProjection, { viewKind: "key-value" }>,
) {
  if (annotation.kind === "entry" && annotation.entryId) {
    const entry = view.entries.find(
      (candidate) => candidate.id === annotation.entryId,
    );
    if (entry) return entry.label;
  }
  return "Sheet";
}

function createHandleResource<T>(
  repo: any,
  url: () => AutomergeUrl | undefined,
) {
  return createResource(url, async (currentUrl) => {
    if (!currentUrl) return undefined;
    return (await repo.find(currentUrl)) as DocHandle<T>;
  });
}
