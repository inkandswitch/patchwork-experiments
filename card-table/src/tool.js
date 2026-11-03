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

const PHASES = { waiting: "Waiting for the players to join", playing: "In play" };

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
      for (const [k, s0] of Object.entries(shares)) {
        if (s0?.epoch !== Number(d.epochs?.[k] ?? 0)) continue;
        const s = s0.by?.[p.id];
        if (s?.open) open++;
        sealed += Object.keys(s?.to ?? {}).length;
      }
      const turn = d.op && d.op.turn === i ? ` · ${d.op.pass} now` : "";
      return el("tr", {}, el("td", {}, p.id), el("td", {}, `${open} shown to all, ${sealed} to one player${turn}`));
    });
    const shuffles = Object.values(d.epochs ?? {}).reduce((a, b) => Math.max(a, Number(b) || 0), 0);
    root.replaceChildren(
      el("h2", {}, d.title || "Secure deck"),
      el(
        "p",
        {},
        `${n} cards. ${PHASES[d.phase] ?? d.phase ?? ""}.`,
        d.op ? ` Shuffling ${d.op.offsets.length} of them (${d.op.pass}).` : "",
        d.queue?.length ? ` ${d.queue.length} shuffle${d.queue.length > 1 ? "s" : ""} waiting.` : "",
        shuffles ? ` The most-shuffled card has been shuffled ${shuffles} time${shuffles > 1 ? "s" : ""}.` : "",
        Object.keys(d.slots ?? {}).length ? "" : " Not on a table yet: drop it on a scene.",
      ),
      rows.length ? el("table", {}, el("tbody", {}, rows)) : el("p", { class: "muted" }, "Nobody has joined yet."),
      el(
        "p",
        { class: "muted" },
        "Nobody can tell which card is where. A player's key for a card is handed over only when the table shows that card in someone's hand or face up. Keys come from each player's account, so any of their devices can play.",
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
