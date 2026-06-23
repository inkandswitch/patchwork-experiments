#!/usr/bin/env python3
"""
"Tool-as-widget" {req, code} pairs: vanilla-JS / solid-js versions of the
simpler Patchwork tools (derived from ./prompts specs + tool source), reduced to
self-contained widgets — local state via solid signals instead of an automerge
doc, rendered into `root`, no plugins/datatype. These teach richer INTERACTIVE,
stateful widgets (games, editors, live clocks) beyond static data displays.

    python gen_tools.py   ->  seeds-tools.jsonl
"""
import json
from pathlib import Path

PAIRS = []


def add(req, ack, body):
    PAIRS.append({"req": req, "code": 'dm.print(' + json.dumps(ack) + ');\n' + body.strip()})


# tic-tac-toe (from prompts/tic-tac-toe.md) — local state instead of the doc
add("a two-player tic-tac-toe game", "ACKNOWLEDGED. STARTING TWO-PLAYER TIC-TAC-TOE.", """
const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const [board, setBoard] = createSignal(Array(9).fill(null));
const [turn, setTurn] = createSignal("X");
const winner = () => { for (const [a,b,c] of LINES) { const v = board()[a]; if (v && v === board()[b] && v === board()[c]) return v; } return board().every(Boolean) ? "draw" : null; };
const play = (i) => { if (board()[i] || winner()) return; const b = board().slice(); b[i] = turn(); setBoard(b); setTurn(turn() === "X" ? "O" : "X"); };
dm.mount(() => html`<div style="text-align:center">
  <div style="font-weight:700;margin-bottom:6px">${() => { const w = winner(); return w === "draw" ? "it's a draw" : w ? w + " wins!" : turn() + " to move"; }}</div>
  <div style="display:grid;grid-template-columns:repeat(3,60px);gap:4px;justify-content:center;background:#000;padding:4px;border-radius:8px;width:max-content;margin:0 auto">
    ${() => board().map((cell, i) => html`<button onClick=${() => play(i)} style=${"width:60px;height:60px;font-size:28px;font-weight:700;border:none;border-radius:4px;background:#fff;cursor:pointer;color:" + (cell === "X" ? "#3874ff" : "#ff2284")}>${cell || ""}</button>`)}
  </div>
  <button style="margin-top:8px" onClick=${() => { setBoard(Array(9).fill(null)); setTurn("X"); }}>new game</button>
</div>`);
""")

# todo list (from prompts/todo.md) — local state
add("a to-do list i can add to and check off", "ACKNOWLEDGED. CREATING A TO-DO LIST.", """
let nextId = 2;
const [todos, setTodos] = createSignal([{ id: 1, text: "try the RLM tool", done: false }]);
const addTodo = (t) => { if (t.trim()) setTodos([...todos(), { id: nextId++, text: t.trim(), done: false }]); };
const toggle = (id) => setTodos(todos().map((t) => t.id === id ? { ...t, done: !t.done } : t));
const remove = (id) => setTodos(todos().filter((t) => t.id !== id));
dm.mount(() => { let input; return html`<div style="max-width:320px">
  <div style="display:flex;gap:6px;margin-bottom:8px">
    <input ref=${(e) => (input = e)} placeholder="add a todo" style="flex:1" onKeyDown=${(e) => { if (e.key === "Enter") { addTodo(input.value); input.value = ""; } }} />
    <button onClick=${() => { addTodo(input.value); input.value = ""; }}>add</button>
  </div>
  <${For} each=${todos}>${(t) => html`<div style="display:flex;align-items:center;gap:8px;margin:3px 0">
    <input type="checkbox" checked=${t.done} onChange=${() => toggle(t.id)} />
    <span style=${"flex:1;text-decoration:" + (t.done ? "line-through" : "none")}>${t.text}</span>
    <button onClick=${() => remove(t.id)}>x</button>
  </div>`}<//>
</div>`; });
""")

# cat clock -> a live analog clock (from prompts/catclock.md, simplified)
add("a live analog clock", "ACKNOWLEDGED. RENDERING A LIVE ANALOG CLOCK.", """
const cv = document.createElement("canvas"); cv.width = 200; cv.height = 200; root.appendChild(cv);
const ctx = cv.getContext("2d");
function draw() {
  const now = new Date();
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, 200, 200); ctx.translate(100, 100);
  ctx.strokeStyle = "#000"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 92, 0, Math.PI * 2); ctx.stroke();
  const h = now.getHours() % 12, m = now.getMinutes(), s = now.getSeconds();
  const hand = (frac, len, w, color) => { const a = frac * Math.PI * 2; ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.sin(a) * len, -Math.cos(a) * len); ctx.stroke(); };
  hand((h + m / 60) / 12, 45, 6, "#000");
  hand(m / 60, 72, 4, "#000");
  hand(s / 60, 82, 1.5, "var(--rlm-accent, #ff2284)");
}
draw(); setInterval(draw, 1000);
""")

# word counter (from prompts/word-counter.md) — live, on a textarea
add("a live word and character counter", "ACKNOWLEDGED. COUNTING WORDS AND CHARACTERS LIVE.", """
const [text, setText] = createSignal("type here and watch the counts update");
const words = () => (text().trim() ? text().trim().split(/\\s+/).length : 0);
dm.mount(() => html`<div style="max-width:360px">
  <textarea style="width:100%;min-height:80px" onInput=${(e) => setText(e.target.value)}>${text()}</textarea>
  <div style="font-family:monospace;margin-top:6px">${() => words()} words · ${() => text().length} chars</div>
</div>`);
""")

# sparkles (from prompts/sparkles.md) — a cursor-trail play area
add("a sparkle cursor trail", "ACKNOWLEDGED. ADDING A SPARKLE TRAIL TO A PLAY AREA.", """
const area = document.createElement("div");
area.textContent = "move your cursor in here";
area.style.cssText = "height:160px;border:1px dashed #000;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#888;position:relative;overflow:hidden";
root.appendChild(area);
const glyphs = ["✦", "✧", "⋆", "✩", "♡"];
area.addEventListener("pointermove", (e) => {
  const r = area.getBoundingClientRect();
  const s = document.createElement("span");
  s.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
  s.style.cssText = "position:absolute;pointer-events:none;color:var(--rlm-accent,#ff2284);font-size:18px;transition:all .8s;left:" + (e.clientX - r.left) + "px;top:" + (e.clientY - r.top) + "px";
  area.appendChild(s);
  requestAnimationFrame(() => { s.style.transform = "translateY(-30px) scale(0)"; s.style.opacity = "0"; });
  setTimeout(() => s.remove(), 800);
});
""")

# a calculator
add("a working calculator", "ACKNOWLEDGED. RENDERING A CALCULATOR.", """
const [expr, setExpr] = createSignal("");
const press = (k) => {
  if (k === "=") { try { setExpr(String(Function("return (" + expr() + ")")())); } catch { setExpr("error"); } }
  else if (k === "C") setExpr("");
  else setExpr((expr() === "error" ? "" : expr()) + k);
};
const keys = ["7","8","9","/","4","5","6","*","1","2","3","-","0",".","=","+","C"];
dm.mount(() => html`<div style="width:208px">
  <div style="border:1px solid #000;border-radius:6px;padding:8px;font-family:monospace;text-align:right;min-height:22px;margin-bottom:6px">${() => expr() || "0"}</div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px">
    ${keys.map((k) => html`<button onClick=${() => press(k)} style="padding:10px;font-size:16px">${k}</button>`)}
  </div>
</div>`);
""")

# a stopwatch
add("a stopwatch with start, stop and reset", "ACKNOWLEDGED. STARTING A STOPWATCH.", """
const [ms, setMs] = createSignal(0);
let id = null, last = 0;
const tick = () => { const now = performance.now(); setMs((m) => m + (now - last)); last = now; id = requestAnimationFrame(tick); };
const start = () => { if (id) return; last = performance.now(); id = requestAnimationFrame(tick); };
const stop = () => { if (id) cancelAnimationFrame(id); id = null; };
const reset = () => { stop(); setMs(0); };
dm.mount(() => html`<div style="text-align:center">
  <div style="font-size:32px;font-family:monospace">${() => (ms() / 1000).toFixed(2)}s</div>
  <button onClick=${start}>start</button> <button onClick=${stop}>stop</button> <button onClick=${reset}>reset</button>
</div>`);
""")

# a dice roller
add("a dice roller for two dice", "ACKNOWLEDGED. READY TO ROLL TWO DICE.", """
const [dice, setDice] = createSignal([1, 1]);
const roll = () => setDice(dice().map(() => 1 + Math.floor(Math.random() * 6)));
dm.mount(() => html`<div style="text-align:center">
  <div style="font-size:48px">${() => dice().map((d) => "⚀⚁⚂⚃⚄⚅"[d - 1]).join(" ")}</div>
  <div style="margin:4px 0;font-family:monospace">total ${() => dice()[0] + dice()[1]}</div>
  <button onClick=${roll}>roll</button>
</div>`);
""")

# a color picker
add("a color picker that shows the hex value", "ACKNOWLEDGED. PICK A COLOR; REPORTING ITS HEX.", """
const [c, setC] = createSignal("#ff2284");
dm.mount(() => html`<div style="text-align:center">
  <input type="color" value=${c()} onInput=${(e) => setC(e.target.value)} style="width:80px;height:80px;border:none;background:none" />
  <div style="font-family:monospace;font-size:20px">${() => c()}</div>
</div>`);
""")

# a live markdown editor + preview (esm.sh snarkdown) — scratchpad-ish, two panes
add("a live markdown editor with preview", "ACKNOWLEDGED. OPENING A LIVE MARKDOWN EDITOR.", """
const snarkdown = (await import("https://esm.sh/snarkdown@2.0.0")).default;
const [md, setMd] = createSignal("# hello\\n\\ntype **markdown** on the left");
dm.mount(() => {
  let preview;
  createEffect(() => { if (preview) preview.innerHTML = snarkdown(md()); });
  return html`<div style="display:flex;gap:10px;max-width:560px">
    <textarea style="flex:1;min-height:120px;font-family:monospace" onInput=${(e) => setMd(e.target.value)}>${md()}</textarea>
    <div ref=${(e) => (preview = e)} style="flex:1;border:1px solid #000;border-radius:8px;padding:10px"></div>
  </div>`;
});
""")

# a pack weight tally (from prompts/lighterpack.md, simplified)
add("a backpacking gear list with a total weight", "ACKNOWLEDGED. TALLYING PACK WEIGHT.", """
const items = [{ name: "tent", g: 1200 }, { name: "sleeping bag", g: 800 }, { name: "stove", g: 300 }, { name: "water", g: 1000 }];
const total = items.reduce((a, i) => a + i.g, 0);
dm.mount(() => html`<div style="max-width:300px">
  ${items.map((it) => html`<div style="display:flex;justify-content:space-between;margin:2px 0"><span>${it.name}</span><span style="font-family:monospace">${it.g} g</span></div>`)}
  <div style="border-top:1px solid #000;margin-top:6px;padding-top:6px;display:flex;justify-content:space-between;font-weight:700"><span>total</span><span style="font-family:monospace">${total} g</span></div>
</div>`);
""")


out = Path(__file__).parent / "seeds-tools.jsonl"
with open(out, "w") as f:
    for p in PAIRS:
        f.write(json.dumps(p) + "\n")
print(f"wrote {len(PAIRS)} tool-widget pairs -> {out}")
