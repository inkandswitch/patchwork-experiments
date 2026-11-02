// patchwork:tool "secure-deck" — the deck on its own: where the shuffle is,
// who is in it, and how many cards each player has been shown. It shows no
// faces: what anyone may see is decided by the table the deck belongs to.

import css from "./styles.css?inline";

const el = (tag, props = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else n.setAttribute(k, v);
  }
  n.append(...children.flat().filter((c) => c != null));
  return n;
};

const PHASES = { waiting: "Waiting for the players to join the shuffle", shuffling: "Shuffling", ready: "Shuffled" };

export default function SecureDeckTool(handle, element) {
  const style = document.createElement("style");
  style.textContent = css;
  const root = el("div", { class: "secure-deck" });
  element.append(style, root);

  function render() {
    const d = handle.doc() ?? {};
    const n = d.faces?.length ?? 0;
    const shares = d.shares ?? {};
    const rows = (d.participants ?? []).map((p, i) => {
      let open = 0;
      let sealed = 0;
      for (const byPlayer of Object.values(shares)) {
        const s = byPlayer?.[p.id];
        if (s?.open) open++;
        sealed += Object.keys(s?.to ?? {}).length;
      }
      const turn = d.phase === "shuffling" && d.turn === i ? ` · ${d.pass === "forward" ? "shuffling" : "re-keying"} now` : "";
      return el("tr", {}, el("td", {}, p.id), el("td", {}, `${open} shown to all, ${sealed} to one player${turn}`));
    });
    root.replaceChildren(
      el("h2", {}, d.title || "Secure deck"),
      el("p", {}, `${n} cards. ${PHASES[d.phase] ?? d.phase ?? ""}${d.phase === "shuffling" ? ` (pass ${d.pass === "forward" ? 1 : 2} of 2)` : ""}.`),
      rows.length ? el("table", {}, el("tbody", {}, rows)) : el("p", { class: "muted" }, "Nobody has joined yet."),
      el(
        "p",
        { class: "muted" },
        "Nobody can read the order of this deck. A player's key for a card is handed over only when the table shows that card in someone's hand or face up; keys stay on each player's device.",
      ),
    );
  }
  render();
  handle.on("change", render);
  return () => {
    handle.off("change", render);
    root.remove();
    style.remove();
  };
}
