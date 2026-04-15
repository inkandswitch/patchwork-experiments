import type { Repo } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

export type GearItem = {
  id: string;
  name: string;
  category: string;
  description?: string;
  quantity: number;
  weight: number; // in grams
  unit: string;
  url?: string;
  price?: number;
  worn: boolean;
  consumable: boolean;
};

export type WeightCategory = {
  name: string;
  totalWeight: number;
  color: string;
};

export type Doc = {
  title: string;
  description?: string;
  items: GearItem[];
  categories: string[];
  packedItems: string[]; // Array of item IDs that are packed
};

export const LighterpackDatatype: DatatypeImplementation<Doc> = {
  init(doc: Doc, _repo: Repo) {
    doc.title = "New Gear List";
    doc.description = "";
    doc.items = [];
    doc.categories = [
      "Tent (Shared)",
      "Camp Kitchen (Shared)",
      "Sanitation (Shared)",
      "Health: Treatment & Prevention (Shared)",
      "Tech (Shared)",
      "Luxuries (shared)",
      "Sleep System (Peter)",
      "Clothes (Peter)",
      "Personal Gear (Peter)",
      "Luxuries (Peter)",
      "Alyson Clothes",
      "Sleep System (Alyson)",
      "Personal Gear (Alyson)",
      "Water & Fuel",
      "Food",
    ];
    doc.packedItems = [];
  },
  getTitle(doc: Doc) {
    return doc.title || "Gear List";
  },
  setTitle(doc: Doc, title: string) {
    doc.title = title;
  },
};

export const getTotalWeight = (items: GearItem[]): number => {
  return items.reduce((total, item) => total + item.weight * item.quantity, 0);
};

export const getConsumableWeight = (items: GearItem[]): number => {
  return items
    .filter((item) => item.consumable)
    .reduce((total, item) => total + item.weight * item.quantity, 0);
};

export const getWornWeight = (items: GearItem[]): number => {
  return items
    .filter((item) => item.worn)
    .reduce((total, item) => total + item.weight * item.quantity, 0);
};

export const getBaseWeight = (items: GearItem[]): number => {
  return items
    .filter((item) => !item.consumable && !item.worn)
    .reduce((total, item) => total + item.weight * item.quantity, 0);
};

export const getCategoryWeights = (items: GearItem[]): WeightCategory[] => {
  const categoryMap = new Map<string, number>();

  items.forEach((item) => {
    const current = categoryMap.get(item.category) || 0;
    categoryMap.set(item.category, current + item.weight * item.quantity);
  });

  const colors = [
    "#dc2626",
    "#ea580c",
    "#d97706",
    "#ca8a04",
    "#65a30d",
    "#16a34a",
    "#059669",
    "#0891b2",
    "#0284c7",
    "#2563eb",
    "#4f46e5",
    "#7c3aed",
    "#9333ea",
    "#c026d3",
    "#db2777",
  ];

  return Array.from(categoryMap.entries())
    .map(([name, totalWeight], index) => ({
      name,
      totalWeight,
      color: colors[index % colors.length],
    }))
    .sort((a, b) => b.totalWeight - a.totalWeight);
};

export const formatWeight = (grams: number): string => {
  if (grams >= 1000) {
    return `${(grams / 1000).toFixed(2)} kg`;
  }
  return `${grams} g`;
};

export const formatWeightLb = (grams: number): string => {
  const pounds = grams / 453.592;
  return `${pounds.toFixed(2)} lb`;
};
