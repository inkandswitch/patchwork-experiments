import { from, render, html } from "../solid.js";
import { schema } from "./schema.js";

export { schema };

export default function mount(element) {
  const data = from(element.ref);

  function increment(e) {
    e.preventDefault();
    e.stopPropagation();
    element.ref.change((doc) => {
      doc.count = (doc.count || 0) + 1;
    });
  }

  function decrement(e) {
    e.preventDefault();
    e.stopPropagation();
    element.ref.change((doc) => {
      doc.count = (doc.count || 0) - 1;
    });
  }

  function reset(e) {
    e.preventDefault();
    e.stopPropagation();
    element.ref.change((doc) => {
      doc.count = 0;
    });
  }

  const containerStyle = {
    width: "100%",
    height: "100%",
    display: "flex",
    "flex-direction": "column",
    "align-items": "center",
    "justify-content": "center",
    gap: "12px",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    "border-radius": "12px",
    "font-family": "system-ui, -apple-system, sans-serif",
    color: "white",
    "user-select": "none",
  };

  const labelStyle = {
    "font-size": "11px",
    "text-transform": "uppercase",
    "letter-spacing": "2px",
    opacity: "0.8",
  };

  const countStyle = {
    "font-size": "48px",
    "font-weight": "700",
    "line-height": "1",
    "text-shadow": "0 2px 4px rgba(0,0,0,0.2)",
  };

  const rowStyle = { display: "flex", gap: "8px" };

  const btnBase = {
    border: "none",
    "border-radius": "8px",
    "font-weight": "600",
    cursor: "pointer",
    "box-shadow": "0 2px 6px rgba(0,0,0,0.2)",
  };

  const minusStyle = { ...btnBase, padding: "8px 16px", "font-size": "18px", background: "#ef4444", color: "white" };
  const plusStyle = { ...btnBase, padding: "8px 16px", "font-size": "18px", background: "#22c55e", color: "white" };
  const resetStyle = { ...btnBase, padding: "6px 14px", "font-size": "12px", background: "rgba(255,255,255,0.2)", color: "white" };

  return render(
    () => html`
      <div style=${containerStyle}>
        <div style=${labelStyle}>Counter</div>
        <div style=${countStyle}>${() => data()?.count ?? 0}</div>
        <div style=${rowStyle}>
          <button onClick=${decrement} style=${minusStyle}>${"−"}</button>
          <button onClick=${reset} style=${resetStyle}>Reset</button>
          <button onClick=${increment} style=${plusStyle}>+</button>
        </div>
      </div>
    `,
    element,
  );
}