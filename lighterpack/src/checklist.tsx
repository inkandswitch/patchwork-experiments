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
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 bg-white">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Packing Checklist
          </h1>
          <div className="flex items-center justify-between">
            <div className="text-lg">
              <span className="font-semibold text-green-600">
                {packedCount}
              </span>
              <span className="text-gray-600"> of </span>
              <span className="font-semibold">{totalItems}</span>
              <span className="text-gray-600">
                {" "}
                items packed ({progressPercent}%)
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={clearAll}
                variant="outline"
                size="sm"
                className="text-sm"
              >
                Clear All
              </Button>
              <Button
                onClick={checkAll}
                variant="outline"
                size="sm"
                className="text-sm"
              >
                Check All
              </Button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-3 w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-green-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Items by Category */}
        <div className="space-y-6">
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
              <div key={category} className="border rounded-lg p-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {category}
                  </h3>
                  <div className="text-sm text-gray-600">
                    <span className="font-medium">
                      {categoryPacked}/{categoryTotal}
                    </span>
                    <span className="ml-2">
                      ({formatWeightLb(categoryWeight)})
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  {categoryItems.map((item) => (
                    <label
                      key={item.id}
                      className={`flex items-center p-2 rounded cursor-pointer transition-colors ${
                        packedItems.has(item.id)
                          ? "bg-green-50 text-green-900"
                          : "hover:bg-gray-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={packedItems.has(item.id)}
                        onChange={() => togglePacked(item.id)}
                        className="mr-3 h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <div
                          className={`font-medium ${
                            packedItems.has(item.id)
                              ? "line-through text-green-700"
                              : "text-gray-900"
                          }`}
                        >
                          {item.name}
                          {item.quantity > 1 && (
                            <span className="text-sm text-gray-500 ml-1">
                              (×{item.quantity})
                            </span>
                          )}
                        </div>
                        {item.description && (
                          <div
                            className={`text-sm ${
                              packedItems.has(item.id)
                                ? "text-green-600"
                                : "text-gray-600"
                            }`}
                          >
                            {item.description}
                          </div>
                        )}
                      </div>
                      <div
                        className={`text-sm font-medium ${
                          packedItems.has(item.id)
                            ? "text-green-700"
                            : "text-gray-500"
                        }`}
                      >
                        {formatWeightLb(item.weight * item.quantity)}
                        {item.worn && <span className="ml-1">👔</span>}
                        {item.consumable && <span className="ml-1">🍎</span>}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {totalItems === 0 && (
          <div className="text-center py-12 text-gray-500">
            <p className="text-lg">No items to pack yet.</p>
            <p className="text-sm mt-1">Add items to your gear list first.</p>
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
