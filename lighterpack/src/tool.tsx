import { useDocHandle } from "@automerge/automerge-repo-react-hooks";
import { EditorProps } from "@patchwork/sdk";
import { Button, Input } from "@patchwork/sdk/ui";
import {
  Doc,
  GearItem,
  getCategoryWeights,
  getTotalWeight,
  getConsumableWeight,
  getWornWeight,
  getBaseWeight,
  formatWeightLb,
} from "./datatype";
import { importCSVData } from "./csvImporter";
import React, { useState, useMemo, useRef } from "react";

console.log("This is tool.tsx in the counter package");

export const Tool: React.FC<EditorProps<Doc, string>> = ({ docUrl }) => {
  const handle = useDocHandle<Doc>(docUrl, { suspense: true });
  const [editingItem, setEditingItem] = useState<{
    id: string;
    field: "name" | "description";
  } | null>(null);
  const [newItems, setNewItems] = useState<Record<string, Partial<GearItem>>>(
    {}
  );
  const [newCategoryName, setNewCategoryName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const doc = handle.doc();
  const items = doc?.items || [];
  const categoryWeights = useMemo(() => getCategoryWeights(items), [items]);
  const totalWeight = getTotalWeight(items);
  const consumableWeight = getConsumableWeight(items);
  const wornWeight = getWornWeight(items);
  const baseWeight = getBaseWeight(items);

  const groupedItems = useMemo(() => {
    const groups: { [key: string]: GearItem[] } = {};

    // Initialize all categories (even empty ones)
    doc.categories.forEach((category) => {
      groups[category] = [];
    });

    // Add items to their respective categories
    items.forEach((item) => {
      if (groups[item.category]) {
        groups[item.category].push(item);
      }
    });

    return groups;
  }, [items, doc.categories]);

  if (!doc) {
    return null;
  }

  const updateTitle = (title: string) => {
    handle.change((d) => {
      d.title = title;
    });
  };

  const updateDescription = (description: string) => {
    handle.change((d) => {
      d.description = description;
    });
  };

  const updateNewItem = (category: string, updates: Partial<GearItem>) => {
    setNewItems((prev) => ({
      ...prev,
      [category]: { ...prev[category], ...updates },
    }));
  };

  const addItem = (category: string) => {
    const newItem = newItems[category];
    if (!newItem?.name) return;

    handle.change((d) => {
      d.items.push({
        id: Date.now().toString(),
        name: newItem.name!,
        category: category,
        description: newItem.description || "",
        quantity: newItem.quantity || 1,
        weight: newItem.weight || 0,
        unit: newItem.unit || "gram",
        url: newItem.url || "",
        price: newItem.price || 0,
        worn: newItem.worn || false,
        consumable: newItem.consumable || false,
      });
    });

    setNewItems((prev) => ({ ...prev, [category]: {} }));
  };

  const addCategory = () => {
    if (!newCategoryName.trim()) return;

    handle.change((d) => {
      if (!d.categories.includes(newCategoryName.trim())) {
        d.categories.push(newCategoryName.trim());
      }
    });

    setNewCategoryName("");
  };

  const deleteCategory = (categoryToDelete: string) => {
    if (
      !confirm(
        `Are you sure you want to delete the "${categoryToDelete}" category and all its items?`
      )
    ) {
      return;
    }

    handle.change((d) => {
      // Remove all items in this category (iterate backwards to avoid index issues)
      for (let i = d.items.length - 1; i >= 0; i--) {
        if (d.items[i].category === categoryToDelete) {
          d.items.splice(i, 1);
        }
      }

      // Remove the category itself
      const categoryIndex = d.categories.indexOf(categoryToDelete);
      if (categoryIndex !== -1) {
        d.categories.splice(categoryIndex, 1);
      }
    });
  };

  const updateItem = (id: string, updates: Partial<GearItem>) => {
    handle.change((d) => {
      const index = d.items.findIndex((item) => item.id === id);
      if (index !== -1) {
        Object.assign(d.items[index], updates);
      }
    });
  };

  const deleteItem = (id: string) => {
    handle.change((d) => {
      const index = d.items.findIndex((item) => item.id === id);
      if (index !== -1) {
        d.items.splice(index, 1);
      }
    });
  };

  const handleCSVImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const csvText = e.target?.result as string;
      if (csvText) {
        handle.change((d) => {
          importCSVData(d, csvText);
        });
      }
    };
    reader.readAsText(file);

    // Reset the file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const triggerCSVImport = () => {
    fileInputRef.current?.click();
  };

  const convertWeight = (
    weight: number,
    fromUnit: string,
    toUnit: string
  ): number => {
    if (fromUnit === toUnit) return weight;

    // Convert everything to grams first
    let weightInGrams = weight;
    if (fromUnit === "oz") {
      weightInGrams = weight * 28.3495;
    } else if (fromUnit === "lb") {
      weightInGrams = weight * 453.592;
    }

    // Convert from grams to target unit
    if (toUnit === "gram") {
      return Math.round(weightInGrams * 10) / 10;
    } else if (toUnit === "oz") {
      return Math.round((weightInGrams / 28.3495) * 100) / 100;
    } else if (toUnit === "lb") {
      return Math.round((weightInGrams / 453.592) * 1000) / 1000;
    }

    return weight;
  };

  const CyclingToggle = ({
    value,
    onToggle,
    trueIcon,
    falseIcon,
    trueLabel,
    falseLabel,
  }: {
    value: boolean;
    onToggle: () => void;
    trueIcon: string;
    falseIcon: string;
    trueLabel: string;
    falseLabel: string;
  }) => (
    <button
      onClick={onToggle}
      className={`p-0.5 rounded text-sm transition-colors ${
        value
          ? "bg-green-100 text-green-600 hover:bg-green-200"
          : "bg-gray-100 text-gray-400 hover:bg-gray-200"
      }`}
      title={value ? trueLabel : falseLabel}
    >
      {value ? trueIcon : falseIcon}
    </button>
  );

  const PieChart = ({
    data,
  }: {
    data: Array<{ name: string; totalWeight: number; color: string }>;
  }) => {
    const total = data.reduce((sum, item) => sum + item.totalWeight, 0);
    if (total === 0)
      return (
        <div className="w-64 h-64 rounded-full border-2 border-gray-200"></div>
      );

    let cumulativePercentage = 0;
    const slices = data.map((item) => {
      const percentage = (item.totalWeight / total) * 100;
      const startAngle = (cumulativePercentage / 100) * 360;
      const endAngle = ((cumulativePercentage + percentage) / 100) * 360;
      cumulativePercentage += percentage;

      const largeArcFlag = percentage > 50 ? 1 : 0;
      const x1 = 128 + 120 * Math.cos(((startAngle - 90) * Math.PI) / 180);
      const y1 = 128 + 120 * Math.sin(((startAngle - 90) * Math.PI) / 180);
      const x2 = 128 + 120 * Math.cos(((endAngle - 90) * Math.PI) / 180);
      const y2 = 128 + 120 * Math.sin(((endAngle - 90) * Math.PI) / 180);

      return (
        <path
          key={item.name}
          d={`M 128 128 L ${x1} ${y1} A 120 120 0 ${largeArcFlag} 1 ${x2} ${y2} Z`}
          fill={item.color}
          stroke="white"
          strokeWidth="2"
        />
      );
    });

    return (
      <svg width="256" height="256" className="mx-auto">
        <circle
          cx="128"
          cy="128"
          r="60"
          fill="white"
          stroke="#e5e7eb"
          strokeWidth="2"
        />
        {slices}
      </svg>
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto p-6 bg-white">
        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-4">
          {/* Pie Chart */}
          <div className="flex justify-center">
            <PieChart data={categoryWeights} />
          </div>

          {/* Weight Summary */}
          <div className="space-y-2">
            <div className="space-y-1">
              {categoryWeights.map((category) => (
                <div
                  key={category.name}
                  className="flex justify-between items-center"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-4 h-4 rounded-sm"
                      style={{ backgroundColor: category.color }}
                    />
                    <span className="text-sm">{category.name}</span>
                  </div>
                  <div className="text-sm font-medium">
                    {formatWeightLb(category.totalWeight)}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t pt-2 space-y-1">
              <div className="flex justify-between font-bold">
                <span>Total</span>
                <span>{formatWeightLb(totalWeight)}</span>
              </div>
              <div className="flex justify-between">
                <span>Consumable</span>
                <span>{formatWeightLb(consumableWeight)}</span>
              </div>
              <div className="flex justify-between">
                <span>Worn</span>
                <span>{formatWeightLb(wornWeight)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Base Weight</span>
                <span>{formatWeightLb(baseWeight)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Category Management & Import */}
        <div className="mb-3 flex gap-4 items-center flex-wrap">
          <div className="flex gap-2 items-center">
            <Input
              placeholder="New category name..."
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  addCategory();
                }
              }}
              className="w-48 text-sm h-8"
            />
            <Button
              onClick={addCategory}
              disabled={!newCategoryName.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-sm h-8 px-3"
            >
              + Add Category
            </Button>
          </div>

          <Button
            onClick={triggerCSVImport}
            variant="outline"
            className="border-green-600 text-green-600 hover:bg-green-50 text-sm h-8"
          >
            📁 Import CSV
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleCSVImport}
            style={{ display: "none" }}
          />
        </div>

        {/* Items by Category */}
        <div className="space-y-3">
          {Object.entries(groupedItems).map(([category, items]) => {
            const categoryWeight = items.reduce(
              (sum, item) => sum + item.weight * item.quantity,
              0
            );
            return (
              <div key={category}>
                <h3 className="text-base font-semibold mb-1 text-gray-900 sticky top-0 bg-white py-1 border-b flex justify-between items-center">
                  <span>{category}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-600">
                      {formatWeightLb(categoryWeight)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteCategory(category)}
                      className="text-red-600 hover:text-red-800 hover:bg-red-50 p-1 h-6 w-6 text-xs"
                      title={`Delete ${category} category`}
                    >
                      🗑️
                    </Button>
                  </div>
                </h3>
                <div className="space-y-0">
                  {/* Header Row */}
                  <div className="grid grid-cols-[2fr_2fr_60px_80px_60px_60px_60px_40px] gap-2 items-center py-1 text-xs font-medium text-gray-600 border-b bg-gray-50 sticky top-12">
                    <div>Item</div>
                    <div>Description</div>
                    <div className="text-center">Qty</div>
                    <div className="text-center">Weight</div>
                    <div className="text-center">-</div>
                    <div className="text-center">👔</div>
                    <div className="text-center">🍎</div>
                    <div className="text-center"></div>
                  </div>
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="grid grid-cols-[2fr_2fr_60px_80px_60px_60px_60px_40px] gap-2 items-center py-0.5 border-b border-gray-100"
                    >
                      <div>
                        {editingItem?.id === item.id &&
                        editingItem?.field === "name" ? (
                          <Input
                            value={item.name}
                            onChange={(e) =>
                              updateItem(item.id, { name: e.target.value })
                            }
                            onBlur={() => setEditingItem(null)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                setEditingItem(null);
                              }
                            }}
                            autoFocus
                            className="w-full text-xs h-6 px-1"
                          />
                        ) : (
                          <span
                            className="cursor-pointer hover:bg-gray-50 p-1 rounded"
                            onClick={() =>
                              setEditingItem({ id: item.id, field: "name" })
                            }
                            title="Click to edit name"
                          >
                            {item.name}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-600 truncate">
                        {editingItem?.id === item.id &&
                        editingItem?.field === "description" ? (
                          <Input
                            value={item.description}
                            onChange={(e) =>
                              updateItem(item.id, {
                                description: e.target.value,
                              })
                            }
                            onBlur={() => setEditingItem(null)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                setEditingItem(null);
                              }
                            }}
                            autoFocus
                            className="w-full text-xs h-6 px-1"
                          />
                        ) : (
                          <span
                            className="cursor-pointer hover:bg-gray-50 p-1 rounded block"
                            onClick={() =>
                              setEditingItem({
                                id: item.id,
                                field: "description",
                              })
                            }
                            title="Click to edit description"
                          >
                            {item.description || "Click to add description..."}
                          </span>
                        )}
                      </div>
                      <div className="text-center">
                        <Input
                          type="number"
                          value={item.quantity}
                          onChange={(e) =>
                            updateItem(item.id, {
                              quantity: parseInt(e.target.value) || 1,
                            })
                          }
                          className="w-full text-center text-xs h-6 px-1"
                        />
                      </div>
                      <div className="text-center">
                        <div className="flex items-center justify-center">
                          <Input
                            type="number"
                            step="0.1"
                            value={convertWeight(
                              item.weight,
                              "gram",
                              item.unit
                            )}
                            onChange={(e) => {
                              const newWeight = parseFloat(e.target.value) || 0;
                              updateItem(item.id, {
                                weight: convertWeight(
                                  newWeight,
                                  item.unit,
                                  "gram"
                                ),
                              });
                            }}
                            className="w-12 text-center text-xs h-6 px-1 rounded-r-none border-r-0"
                          />
                          <button
                            onClick={() => {
                              const units = ["gram", "oz", "lb"];
                              const currentIndex = units.indexOf(item.unit);
                              const nextUnit =
                                units[(currentIndex + 1) % units.length];
                              updateItem(item.id, { unit: nextUnit });
                            }}
                            className="h-6 px-1 text-xs bg-gray-100 hover:bg-gray-200 border border-l-0 rounded-l-none text-gray-700 min-w-[24px]"
                            title="Click to change unit"
                          >
                            {item.unit === "gram" ? "g" : item.unit}
                          </button>
                        </div>
                      </div>
                      <div className="text-center text-xs text-transparent">
                        -
                      </div>
                      <div className="text-center">
                        <CyclingToggle
                          value={item.worn}
                          onToggle={() =>
                            updateItem(item.id, { worn: !item.worn })
                          }
                          trueIcon="👔"
                          falseIcon="○"
                          trueLabel="Worn"
                          falseLabel="Not worn"
                        />
                      </div>
                      <div className="text-center">
                        <CyclingToggle
                          value={item.consumable}
                          onToggle={() =>
                            updateItem(item.id, {
                              consumable: !item.consumable,
                            })
                          }
                          trueIcon="🍎"
                          falseIcon="○"
                          trueLabel="Consumable"
                          falseLabel="Not consumable"
                        />
                      </div>
                      <div className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteItem(item.id)}
                          className="text-red-600 hover:text-red-800 p-0 w-6 h-6 text-sm"
                        >
                          ×
                        </Button>
                      </div>
                    </div>
                  ))}

                  {/* Add New Item Row */}
                  <div className="grid grid-cols-[2fr_2fr_60px_80px_60px_60px_60px_40px] gap-2 items-center py-0.5 border-t border-gray-200 bg-green-50">
                    <div>
                      <Input
                        placeholder="New item name..."
                        value={newItems[category]?.name || ""}
                        onChange={(e) =>
                          updateNewItem(category, { name: e.target.value })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            addItem(category);
                          }
                        }}
                        className="w-full text-xs h-6 px-1 bg-white"
                      />
                    </div>
                    <div>
                      <Input
                        placeholder="Description..."
                        value={newItems[category]?.description || ""}
                        onChange={(e) =>
                          updateNewItem(category, {
                            description: e.target.value,
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            addItem(category);
                          }
                        }}
                        className="w-full text-xs h-6 px-1 bg-white"
                      />
                    </div>
                    <div className="text-center">
                      <Input
                        type="number"
                        placeholder="1"
                        value={newItems[category]?.quantity || ""}
                        onChange={(e) =>
                          updateNewItem(category, {
                            quantity: parseInt(e.target.value) || 1,
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            addItem(category);
                          }
                        }}
                        className="w-full text-center text-xs h-6 px-1 bg-white"
                      />
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center">
                        <Input
                          type="number"
                          step="0.1"
                          placeholder="0"
                          value={newItems[category]?.weight || ""}
                          onChange={(e) =>
                            updateNewItem(category, {
                              weight: parseFloat(e.target.value) || 0,
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              addItem(category);
                            }
                          }}
                          className="w-12 text-center text-xs h-6 px-1 bg-white rounded-r-none border-r-0"
                        />
                        <button
                          onClick={() => {
                            const units = ["gram", "oz", "lb"];
                            const currentUnit =
                              newItems[category]?.unit || "gram";
                            const currentIndex = units.indexOf(currentUnit);
                            const nextUnit =
                              units[(currentIndex + 1) % units.length];
                            updateNewItem(category, { unit: nextUnit });
                          }}
                          className="h-6 px-1 text-xs bg-gray-100 hover:bg-gray-200 border border-l-0 rounded-l-none text-gray-700 min-w-[24px]"
                          title="Click to change unit"
                        >
                          {(newItems[category]?.unit || "gram") === "gram"
                            ? "g"
                            : newItems[category]?.unit || "gram"}
                        </button>
                      </div>
                    </div>
                    <div className="text-center text-xs text-transparent">
                      -
                    </div>
                    <div className="text-center">
                      <CyclingToggle
                        value={newItems[category]?.worn || false}
                        onToggle={() =>
                          updateNewItem(category, {
                            worn: !(newItems[category]?.worn || false),
                          })
                        }
                        trueIcon="👔"
                        falseIcon="○"
                        trueLabel="Worn"
                        falseLabel="Not worn"
                      />
                    </div>
                    <div className="text-center">
                      <CyclingToggle
                        value={newItems[category]?.consumable || false}
                        onToggle={() =>
                          updateNewItem(category, {
                            consumable: !(
                              newItems[category]?.consumable || false
                            ),
                          })
                        }
                        trueIcon="🍎"
                        falseIcon="○"
                        trueLabel="Consumable"
                        falseLabel="Not consumable"
                      />
                    </div>
                    <div className="text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => addItem(category)}
                        className="text-green-600 hover:text-green-800 p-0 w-6 h-6 text-sm"
                        disabled={!newItems[category]?.name}
                      >
                        +
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-[2fr_2fr_60px_80px_60px_60px_60px_40px] gap-2 items-center py-1 text-xs font-medium border-t">
                    <div></div>
                    <div></div>
                    <div className="text-center">
                      {items.reduce((sum, item) => sum + item.quantity, 0)}
                    </div>
                    <div className="text-center">
                      {formatWeightLb(
                        items.reduce(
                          (sum, item) => sum + item.weight * item.quantity,
                          0
                        )
                      )}
                    </div>
                    <div></div>
                    <div></div>
                    <div></div>
                    <div></div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
