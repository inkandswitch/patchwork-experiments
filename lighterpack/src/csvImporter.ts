import { Doc, GearItem } from "./datatype";

export const parseCSV = (csvText: string): GearItem[] => {
  const lines = csvText.trim().split("\n");
  const headers = lines[0].split(",");

  const items: GearItem[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",");
    if (values.length < headers.length) continue;

    const name = values[0]?.trim();
    const category = values[1]?.trim();
    const description = values[2]?.trim();
    const quantity = parseInt(values[3]) || 1;
    const weight = parseInt(values[4]) || 0;
    const unit = values[5]?.trim() || "gram";
    const url = values[6]?.trim() || "";
    const price = parseInt(values[7]) || 0;
    const worn = values[8]?.trim()?.toLowerCase() === "worn";
    const consumable = values[9]?.trim()?.toLowerCase() === "consumable";

    if (name && category) {
      items.push({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        name,
        category,
        description: description || "",
        quantity,
        weight,
        unit,
        url,
        price,
        worn,
        consumable,
      });
    }
  }

  return items;
};

export const importCSVData = (doc: Doc, csvText: string) => {
  const items = parseCSV(csvText);
  doc.items.push(...items);

  // Update categories to include any new ones from the CSV
  const newCategories = [...new Set(items.map((item) => item.category))];
  newCategories.forEach((category) => {
    if (!doc.categories.includes(category)) {
      doc.categories.push(category);
    }
  });
};
