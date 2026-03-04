import { setDragData } from "../../shared/dnd/helpers.ts";

const TEST_URL = "automerge:4WoKNewwMxGfzPmoq5dEhj9uUQaP";

export function mountDragTokenTest(_handle: unknown, element: HTMLElement) {
  const chip = document.createElement("div");
  chip.textContent = "untitled";
  chip.draggable = true;
  Object.assign(chip.style, {
    display: "inline-block",
    padding: "4px 12px",
    margin: "12px",
    border: "1px solid #ccc",
    borderRadius: "12px",
    fontSize: "12px",
    cursor: "grab",
    userSelect: "none",
    background: "#fff",
  });

  chip.addEventListener("dragstart", (e) => {
    setDragData(e.dataTransfer!, { type: "document", url: TEST_URL, name: "untitled" });
  });

  element.appendChild(chip);
  return () => element.removeChild(chip);
}
