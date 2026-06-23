#!/usr/bin/env python3
"""Explorable / interactive / bidirectional widget pairs.

The point of this batch (per chee): push the model toward DOING ITS OWN THING —
raw DOM, real interactivity, esm.sh imports for real libs (NOT invented globals),
Tangle-style reactivity, and BIDIRECTIONAL coordination via the shared `state`
context (state.doc / state.change / state.on). dm is deliberately a minority.

Each entry is (req, code) where code builds into `root`. Kept correct + idiomatic
so the fine-tune learns good patterns, not hallucinated APIs.
"""

PAIRS = [
    # ----- Tangle-style reactive prose (drag/slide a number, everything updates) -----
    (
        "a tangle-style sentence: if i sleep N hours i get M hours awake",
        """const wrap = document.createElement("div");
wrap.style.cssText = "font:18px/1.6 system-ui;padding:20px;max-width:480px";
const n = document.createElement("input");
n.type = "range"; n.min = "0"; n.max = "12"; n.value = "8"; n.step = "1";
n.style.cssText = "vertical-align:middle;width:120px";
const out = document.createElement("span");
function render() {
  const s = +n.value;
  out.innerHTML = `If you sleep <b>${s}</b> hours, you're awake <b>${24 - s}</b> hours.`;
}
n.addEventListener("input", render);
const line = document.createElement("div");
line.append("Sleep: ", n, " ");
wrap.append(line, out);
root.appendChild(wrap);
render();""",
    ),
    (
        "explorable: compound interest — drag rate and years, see the total",
        """root.style.cssText = "font:15px system-ui;padding:18px;max-width:520px";
const ctrls = {};
function slider(label, min, max, val, step, unit) {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:10px;margin:6px 0";
  const l = document.createElement("label"); l.textContent = label; l.style.width = "90px";
  const i = document.createElement("input");
  i.type = "range"; i.min = min; i.max = max; i.value = val; i.step = step; i.style.flex = "1";
  const v = document.createElement("span"); v.style.cssText = "width:70px;font-weight:700";
  i.addEventListener("input", update);
  row.append(l, i, v);
  root.appendChild(row);
  ctrls[label] = { i, v, unit };
  return i;
}
const principal = 1000;
slider("Rate %", 1, 15, 5, 0.5, "%");
slider("Years", 1, 40, 10, 1, "yr");
const out = document.createElement("div");
out.style.cssText = "margin-top:14px;font-size:24px;font-weight:800;color:#0a7";
root.appendChild(out);
function update() {
  const r = +ctrls["Rate %"].i.value, y = +ctrls["Years"].i.value;
  ctrls["Rate %"].v.textContent = r + "%";
  ctrls["Years"].v.textContent = y + " yr";
  const total = principal * Math.pow(1 + r / 100, y);
  out.textContent = "$" + total.toFixed(0) + " from $1000";
}
update();""",
    ),
    (
        "interactive: a temperature converter you can drive from either side",
        """root.style.cssText = "font:16px system-ui;padding:20px;display:flex;gap:12px;align-items:center";
const c = document.createElement("input"); c.type = "number"; c.value = "20"; c.style.width = "70px";
const f = document.createElement("input"); f.type = "number"; f.value = "68"; f.style.width = "70px";
c.addEventListener("input", () => { f.value = (+c.value * 9 / 5 + 32).toFixed(1); });
f.addEventListener("input", () => { c.value = ((+f.value - 32) * 5 / 9).toFixed(1); });
root.append(c, document.createTextNode(" °C  ⇄  "), f, document.createTextNode(" °F"));""",
    ),
    # ----- Bidirectional coordination via the shared `state` context -----
    (
        "a color picker whose choice other widgets can read from the shared state",
        """root.style.cssText = "display:flex;gap:8px;padding:16px;flex-wrap:wrap";
["#e11d48", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed"].forEach((hex) => {
  const b = document.createElement("button");
  b.style.cssText = `width:38px;height:38px;border-radius:8px;border:2px solid #0002;background:${hex};cursor:pointer`;
  b.title = hex;
  b.addEventListener("click", () => state.change((c) => { c.color = hex; }));
  root.appendChild(b);
});""",
    ),
    (
        "a swatch that always shows the shared color picked elsewhere",
        """root.style.cssText = "padding:16px";
const sw = document.createElement("div");
sw.style.cssText = "width:100%;height:90px;border-radius:12px;border:1px solid #0002;transition:background .2s;display:flex;align-items:center;justify-content:center;font:14px monospace;color:#fff";
root.appendChild(sw);
function paint(c) {
  const hex = (c && c.color) || "#cccccc";
  sw.style.background = hex;
  sw.textContent = hex;
}
paint(state.doc());
state.on("change", paint);""",
    ),
    (
        "a counter that increments a shared count, plus a live readout of it",
        """root.style.cssText = "padding:16px;font:16px system-ui;display:flex;gap:12px;align-items:center";
const minus = document.createElement("button"); minus.textContent = "−";
const plus = document.createElement("button"); plus.textContent = "+";
const out = document.createElement("b"); out.style.fontSize = "22px";
[minus, plus].forEach((b) => (b.style.cssText = "width:34px;height:34px;font-size:18px;cursor:pointer"));
plus.addEventListener("click", () => state.change((c) => { c.count = (c.count || 0) + 1; }));
minus.addEventListener("click", () => state.change((c) => { c.count = (c.count || 0) - 1; }));
function show(c) { out.textContent = c.count || 0; }
show(state.doc());
state.on("change", show);
root.append(minus, out, plus);""",
    ),
    (
        "a shared text note any widget can edit, synced live",
        """root.style.cssText = "padding:14px";
const ta = document.createElement("textarea");
ta.style.cssText = "width:100%;box-sizing:border-box;min-height:90px;font:14px system-ui;padding:8px";
ta.placeholder = "shared note…";
ta.value = state.doc().note || "";
let self = false;
ta.addEventListener("input", () => { self = true; state.change((c) => { c.note = ta.value; }); self = false; });
state.on("change", (c) => { if (!self && c.note !== ta.value) ta.value = c.note || ""; });
root.appendChild(ta);""",
    ),
    # ----- esm.sh imports of REAL libs (instead of inventing globals) -----
    (
        "a line chart of monthly sales using a real chart library",
        """const { default: Chart } = await import("https://esm.sh/chart.js/auto");
const canvas = document.createElement("canvas");
root.appendChild(canvas);
new Chart(canvas, {
  type: "line",
  data: {
    labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
    datasets: [{ label: "Sales", data: [12, 19, 15, 25, 22, 30], borderColor: "#2563eb", tension: 0.3 }],
  },
  options: { responsive: true },
});""",
    ),
    (
        "render some markdown to html",
        """const { marked } = await import("https://esm.sh/marked");
const md = "# Hello\\n\\nThis is **markdown** with a [link](https://example.com) and a list:\\n\\n- one\\n- two\\n- three";
const div = document.createElement("div");
div.style.cssText = "font:15px/1.5 system-ui;padding:16px";
div.innerHTML = marked.parse(md);
root.appendChild(div);""",
    ),
    (
        "a small force-directed graph of a few connected nodes",
        """const d3 = await import("https://esm.sh/d3@7");
const w = 360, h = 260;
const svg = d3.create("svg").attr("width", w).attr("height", h);
const nodes = [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }];
const links = [{ source: "A", target: "B" }, { source: "A", target: "C" }, { source: "B", target: "D" }, { source: "C", target: "D" }];
const sim = d3.forceSimulation(nodes)
  .force("link", d3.forceLink(links).id((d) => d.id).distance(70))
  .force("charge", d3.forceManyBody().strength(-200))
  .force("center", d3.forceCenter(w / 2, h / 2));
const link = svg.append("g").attr("stroke", "#999").selectAll("line").data(links).join("line");
const node = svg.append("g").selectAll("circle").data(nodes).join("circle").attr("r", 14).attr("fill", "#2563eb");
const label = svg.append("g").selectAll("text").data(nodes).join("text").text((d) => d.id).attr("fill", "#fff").attr("text-anchor", "middle").attr("dy", 4);
sim.on("tick", () => {
  link.attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y).attr("x2", (d) => d.target.x).attr("y2", (d) => d.target.y);
  node.attr("cx", (d) => d.x).attr("cy", (d) => d.y);
  label.attr("x", (d) => d.x).attr("y", (d) => d.y);
});
root.appendChild(svg.node());""",
    ),
    # ----- Raw DOM infographics (no library) -----
    (
        "a horizontal bar chart of programming language popularity, pure DOM",
        """const data = [["JavaScript", 62], ["Python", 58], ["Java", 33], ["C++", 22], ["Rust", 13]];
const max = Math.max(...data.map((d) => d[1]));
root.style.cssText = "font:14px system-ui;padding:18px;max-width:480px";
data.forEach(([name, v]) => {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:10px;margin:6px 0";
  const label = document.createElement("div"); label.textContent = name;
  label.style.cssText = "width:90px;text-align:right";
  const track = document.createElement("div");
  track.style.cssText = "flex:1;background:#eee;border-radius:6px;height:20px;overflow:hidden";
  const fill = document.createElement("div");
  fill.style.cssText = `height:100%;width:0;background:#2563eb;border-radius:6px;transition:width .8s`;
  track.appendChild(fill);
  const val = document.createElement("b"); val.textContent = v + "%"; val.style.width = "44px";
  row.append(label, track, val);
  root.appendChild(row);
  requestAnimationFrame(() => (fill.style.width = (v / max * 100) + "%"));
});""",
    ),
    (
        "a donut chart of a budget breakdown using svg",
        """const data = [["Rent", 40, "#2563eb"], ["Food", 25, "#16a34a"], ["Fun", 15, "#f59e0b"], ["Save", 20, "#7c3aed"]];
const NS = "http://www.w3.org/2000/svg";
const svg = document.createElementNS(NS, "svg");
svg.setAttribute("viewBox", "0 0 42 42"); svg.setAttribute("width", "220"); svg.setAttribute("height", "220");
let offset = 25;
data.forEach(([name, pct, color]) => {
  const c = document.createElementNS(NS, "circle");
  c.setAttribute("cx", "21"); c.setAttribute("cy", "21"); c.setAttribute("r", "15.9");
  c.setAttribute("fill", "transparent"); c.setAttribute("stroke", color); c.setAttribute("stroke-width", "6");
  c.setAttribute("stroke-dasharray", `${pct} ${100 - pct}`);
  c.setAttribute("stroke-dashoffset", offset);
  svg.appendChild(c);
  offset = (offset - pct + 100) % 100;
});
root.style.cssText = "padding:16px;text-align:center";
root.appendChild(svg);
const legend = document.createElement("div");
legend.style.cssText = "font:13px system-ui;display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:8px";
data.forEach(([name, pct, color]) => {
  const s = document.createElement("span");
  s.innerHTML = `<span style="display:inline-block;width:10px;height:10px;background:${color};border-radius:2px"></span> ${name} ${pct}%`;
  legend.appendChild(s);
});
root.appendChild(legend);""",
    ),
    (
        "a sparkline of a stock-like series with min/max markers, raw svg",
        """const vals = [12, 14, 13, 18, 22, 19, 25, 28, 24, 30, 27, 33];
const w = 320, h = 70, pad = 6;
const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
const x = (i) => pad + (i / (vals.length - 1)) * (w - 2 * pad);
const y = (v) => h - pad - ((v - min) / range) * (h - 2 * pad);
const NS = "http://www.w3.org/2000/svg";
const svg = document.createElementNS(NS, "svg"); svg.setAttribute("width", w); svg.setAttribute("height", h);
const path = document.createElementNS(NS, "polyline");
path.setAttribute("points", vals.map((v, i) => `${x(i)},${y(v)}`).join(" "));
path.setAttribute("fill", "none"); path.setAttribute("stroke", "#16a34a"); path.setAttribute("stroke-width", "2");
svg.appendChild(path);
[["max", max], ["min", min]].forEach(([_, val]) => {
  const i = vals.indexOf(val);
  const dot = document.createElementNS(NS, "circle");
  dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(val)); dot.setAttribute("r", "3");
  dot.setAttribute("fill", val === max ? "#16a34a" : "#e11d48");
  svg.appendChild(dot);
});
root.style.cssText = "padding:16px"; root.appendChild(svg);""",
    ),
    # ----- Interactive toys / explorables -----
    (
        "a quiz: what is the capital of france, with instant feedback",
        """root.style.cssText = "font:16px system-ui;padding:20px;max-width:420px";
const q = document.createElement("p"); q.textContent = "What is the capital of France?";
root.appendChild(q);
const fb = document.createElement("div"); fb.style.marginTop = "10px";
[["Paris", true], ["Lyon", false], ["Marseille", false]].forEach(([opt, correct]) => {
  const b = document.createElement("button");
  b.textContent = opt;
  b.style.cssText = "display:block;margin:6px 0;padding:8px 14px;cursor:pointer;border-radius:8px;border:1px solid #ccc;width:100%;text-align:left";
  b.addEventListener("click", () => {
    fb.textContent = correct ? "✓ Correct!" : "✗ Not quite — it's Paris.";
    fb.style.color = correct ? "#16a34a" : "#e11d48";
  });
  root.appendChild(b);
});
root.appendChild(fb);""",
    ),
    (
        "a stopwatch with start, stop, and reset",
        """root.style.cssText = "font:system-ui;padding:24px;text-align:center";
const disp = document.createElement("div");
disp.style.cssText = "font-size:48px;font-weight:800;font-variant-numeric:tabular-nums;margin-bottom:16px";
disp.textContent = "0.0";
root.appendChild(disp);
let t = 0, timer = null;
const fmt = () => disp.textContent = (t / 10).toFixed(1);
const mk = (label, fn) => { const b = document.createElement("button"); b.textContent = label; b.style.cssText = "margin:0 6px;padding:8px 18px;cursor:pointer;font-size:15px"; b.addEventListener("click", fn); root.appendChild(b); return b; };
mk("start", () => { if (!timer) timer = setInterval(() => { t++; fmt(); }, 100); });
mk("stop", () => { clearInterval(timer); timer = null; });
mk("reset", () => { clearInterval(timer); timer = null; t = 0; fmt(); });
onCleanup(() => clearInterval(timer));""",
    ),
    (
        "a to-do list you can add to and check off",
        """root.style.cssText = "font:15px system-ui;padding:18px;max-width:380px";
const form = document.createElement("div"); form.style.cssText = "display:flex;gap:8px;margin-bottom:12px";
const inp = document.createElement("input"); inp.placeholder = "new task…"; inp.style.cssText = "flex:1;padding:6px";
const add = document.createElement("button"); add.textContent = "add"; add.style.cursor = "pointer";
const list = document.createElement("ul"); list.style.cssText = "list-style:none;padding:0;margin:0";
function addTask() {
  const text = inp.value.trim(); if (!text) return;
  const li = document.createElement("li"); li.style.cssText = "display:flex;align-items:center;gap:8px;padding:4px 0";
  const cb = document.createElement("input"); cb.type = "checkbox";
  const span = document.createElement("span"); span.textContent = text;
  cb.addEventListener("change", () => span.style.textDecoration = cb.checked ? "line-through" : "");
  li.append(cb, span); list.appendChild(li); inp.value = "";
}
add.addEventListener("click", addTask);
inp.addEventListener("keydown", (e) => { if (e.key === "Enter") addTask(); });
form.append(inp, add); root.append(form, list);""",
    ),
    (
        "an explorable: dice roller showing the distribution as you roll",
        """root.style.cssText = "font:15px system-ui;padding:18px;text-align:center";
const counts = [0, 0, 0, 0, 0, 0];
const out = document.createElement("div"); out.style.cssText = "font-size:40px;margin:8px 0";
const bars = document.createElement("div"); bars.style.cssText = "display:flex;gap:6px;align-items:flex-end;height:120px;justify-content:center;margin-top:10px";
const fills = counts.map(() => { const b = document.createElement("div"); b.style.cssText = "width:34px;background:#7c3aed;border-radius:4px 4px 0 0"; bars.appendChild(b); return b; });
const btn = document.createElement("button"); btn.textContent = "roll 🎲"; btn.style.cssText = "padding:8px 20px;font-size:16px;cursor:pointer";
function roll() {
  const r = Math.floor(Math.random() * 6); counts[r]++;
  out.textContent = "⚀⚁⚂⚃⚄⚅"[r];
  const max = Math.max(...counts);
  fills.forEach((f, i) => f.style.height = (counts[i] / max * 110) + "px");
}
btn.addEventListener("click", roll);
root.append(out, btn, bars);""",
    ),
    (
        "linked views: a list of cities; clicking one highlights it on a tiny map",
        """root.style.cssText = "font:14px system-ui;padding:16px;display:flex;gap:20px";
const cities = [["London", 30, 40], ["Paris", 45, 55], ["Berlin", 70, 35], ["Rome", 55, 80]];
const ul = document.createElement("ul"); ul.style.cssText = "list-style:none;padding:0;margin:0;min-width:110px";
const NS = "http://www.w3.org/2000/svg";
const svg = document.createElementNS(NS, "svg"); svg.setAttribute("width", "160"); svg.setAttribute("height", "120");
svg.style.cssText = "background:#eef;border-radius:8px";
const dots = cities.map(([name, x, y]) => {
  const c = document.createElementNS(NS, "circle"); c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", "6"); c.setAttribute("fill", "#94a3b8");
  svg.appendChild(c); return c;
});
cities.forEach(([name], i) => {
  const li = document.createElement("li"); li.textContent = name; li.style.cssText = "padding:5px 8px;cursor:pointer;border-radius:6px";
  li.addEventListener("mouseenter", () => { dots.forEach((d) => d.setAttribute("fill", "#94a3b8")); dots[i].setAttribute("fill", "#e11d48"); dots[i].setAttribute("r", "9"); });
  li.addEventListener("mouseleave", () => dots[i].setAttribute("r", "6"));
  ul.appendChild(li);
});
root.append(ul, svg);""",
    ),
    (
        "a slider that morphs a sentence's tone from formal to casual",
        """root.style.cssText = "font:17px/1.6 system-ui;padding:20px;max-width:480px";
const variants = [
  "I would be most grateful for your assistance.",
  "I'd really appreciate your help.",
  "Could you give me a hand?",
  "yo can u help me out",
];
const out = document.createElement("p"); out.style.minHeight = "3em";
const s = document.createElement("input"); s.type = "range"; s.min = "0"; s.max = "3"; s.value = "0"; s.style.width = "100%";
const labels = document.createElement("div"); labels.style.cssText = "display:flex;justify-content:space-between;font-size:12px;color:#888";
labels.innerHTML = "<span>formal</span><span>casual</span>";
s.addEventListener("input", () => out.textContent = variants[+s.value]);
out.textContent = variants[0];
root.append(out, s, labels);""",
    ),
]


if __name__ == "__main__":
    import json
    from pathlib import Path

    out = Path(__file__).parent / "seeds-explorable.jsonl"
    with open(out, "w") as f:
        for req, code in PAIRS:
            f.write(json.dumps({"req": req, "code": code.strip()}) + "\n")
    print(f"wrote {len(PAIRS)} explorable/interactive/bidirectional pairs -> {out}")
