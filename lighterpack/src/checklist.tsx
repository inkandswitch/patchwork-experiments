import React, { useMemo } from "react";
import { useDocHandle, RepoContext } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { createRoot } from "react-dom/client";
import { Button } from "./ui";
import { Doc, GearItem, formatWeightLb } from "./datatype";

function PackingChecklistView({ docUrl }: { docUrl: AutomergeUrl }) {
  const handle = useDocHandle<Doc>(docUrl, { suspense: true });
  const doc = handle.docSync();
  const items = useMemo(() => doc?.items || [], [doc?.items]);
  const packedItems = useMemo(
    () => new Set(doc?.packedItems || []),
    [doc?.packedItems]
  );

  // Group items by category, ensuring all categories are represented
  // Memoize this to prevent unnecessary re-renders when only packed state changes
  const groupedItems = useMemo(() => {
    if (!doc) return {};
    return doc.categories.reduce((acc, category) => {
      acc[category] = items.filter((item) => item.category === category);
      return acc;
    }, {} as Record<string, GearItem[]>);
  }, [doc, items]);

  if (!doc) {
    return null;
  }

  const togglePacked = (itemId: string) => {
    handle.change((d) => {
      const index = d.packedItems.indexOf(itemId);
      if (index !== -1) {
        d.packedItems.splice(index, 1);
      } else {
        d.packedItems.push(itemId);
      }
    });
  };

  const totalItems = items.length;
  const packedCount = packedItems.size;
  const progressPercent =
    totalItems > 0 ? Math.round((packedCount / totalItems) * 100) : 0;

  const clearAll = () => {
    handle.change((d) => {
      d.packedItems.splice(0, d.packedItems.length);
    });
  };

  const checkAll = () => {
    handle.change((d) => {
      d.packedItems.splice(0, d.packedItems.length);
      items.forEach((item) => {
        d.packedItems.push(item.id);
      });
    });
  };

  return (
    <div className="lp-checklist">
      <div className="lp-checklist__sheet">
        {/* Header */}
        <div className="lp-checklist__header">
          <h1>
            Packing Checklist
          </h1>
          <div className="lp-checklist__summary">
            <div className="lp-checklist__count">
              <span className="lp-checklist__packed">
                {packedCount}
              </span>
              <span className="lp-muted"> of </span>
              <span className="lp-strong">{totalItems}</span>
              <span className="lp-muted">
                {" "}
                items packed ({progressPercent}%)
              </span>
            </div>
            <div className="lp-checklist__actions">
              <Button
                onClick={clearAll}
                variant="outline"
                size="sm"
                className="lp-button"
              >
                Clear All
              </Button>
              <Button
                onClick={checkAll}
                variant="outline"
                size="sm"
                className="lp-button"
              >
                Check All
              </Button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="lp-progress">
            <div
              className="lp-progress__bar"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Items by Category */}
        <div className="lp-checklist__groups">
          {Object.entries(groupedItems).map(([category, categoryItems]) => {
            if (categoryItems.length === 0) return null;

            const categoryPacked = categoryItems.filter((item) =>
              packedItems.has(item.id)
            ).length;
            const categoryTotal = categoryItems.length;
            const categoryWeight = categoryItems.reduce(
              (sum, item) => sum + item.weight * item.quantity,
              0
            );

            return (
              <div key={category} className="lp-group">
                <div className="lp-group__head">
                  <h3>
                    {category}
                  </h3>
                  <div className="lp-group__meta">
                    <span className="lp-strong">
                      {categoryPacked}/{categoryTotal}
                    </span>
                    <span className="lp-gap">
                      ({formatWeightLb(categoryWeight)})
                    </span>
                  </div>
                </div>

                <div className="lp-group__items">
                  {categoryItems.map((item) => (
                    <label
                      key={item.id}
                      className="lp-item"
                      data-packed={packedItems.has(item.id) || undefined}
                    >
                      <input
                        type="checkbox"
                        checked={packedItems.has(item.id)}
                        onChange={() => togglePacked(item.id)}
                        className="lp-item__check"
                      />
                      <div className="lp-item__body">
                        <div className="lp-item__name">
                          {item.name}
                          {item.quantity > 1 && (
                            <span className="lp-item__qty">
                              (×{item.quantity})
                            </span>
                          )}
                        </div>
                        {item.description && (
                          <div className="lp-item__description">
                            {item.description}
                          </div>
                        )}
                      </div>
                      <div className="lp-item__weight">
                        {formatWeightLb(item.weight * item.quantity)}
                        {item.worn && <span className="lp-gap-sm">👔</span>}
                        {item.consumable && <span className="lp-gap-sm">🍎</span>}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {totalItems === 0 && (
          <div className="lp-empty">
            <p className="lp-empty__title">No items to pack yet.</p>
            <p className="lp-empty__hint">Add items to your gear list first.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export const LighterpackChecklistTool: ToolRender = (handle, element) => {
  const repo = element.repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <PackingChecklistView docUrl={handle.url} />
    </RepoContext.Provider>
  );
  return () => root.unmount();
};
