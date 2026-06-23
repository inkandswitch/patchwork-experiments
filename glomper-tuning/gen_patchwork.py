#!/usr/bin/env python3
"""
Patchwork/automerge {req, code} pairs. Widgets run INSIDE Patchwork, so they can
use the live automerge Repo (window.repo / bare `repo`), the current user's
account doc (window.accountDocHandle), and @automerge — to read/create/persist
documents. Teaches the model to reach for real collaborative state, not just
in-memory signals.

    python gen_patchwork.py   ->  seeds-patchwork.jsonl
"""
import json
from pathlib import Path

PAIRS = []


def add(req, ack, body):
    PAIRS.append({"req": req, "code": 'dm.print(' + json.dumps(ack) + ');\n' + body.strip()})


add("greet me by name", "ACKNOWLEDGED. READING THE CURRENT USER FROM THE ACCOUNT DOC.", """
const name = (await repo.find(accountDocHandle.doc().contactUrl)).doc().name;
const box = dm.box({ title: "HELLO" });
box.body.style.fontSize = "18px";
box.body.textContent = "hi, " + (name || "friend");
""")

add("a counter that saves to a document", "ACKNOWLEDGED. CREATING A PERSISTENT COUNTER DOCUMENT.", """
const h = await repo.create2({ count: 0 });
const [n, setN] = createSignal(h.doc().count);
h.on("change", () => setN(h.doc().count));
dm.mount(() => html`<div class="dm-box"><div class="dm-box-title">SAVED COUNTER</div>
  <div class="dm-box-body" style="text-align:center">
    <div style="font-size:28px;font-family:monospace">${() => n()}</div>
    <button onClick=${() => h.change((d) => { d.count++; })}>+1</button>
    <div style="font-size:10px;color:#888;margin-top:4px">${h.url}</div>
  </div></div>`);
""")

add("create a new note document and show its url", "ACKNOWLEDGED. CREATING A NOTE DOCUMENT.", """
const h = await repo.create2({ title: "New Note", text: "" });
const box = dm.box({ title: "DOCUMENT CREATED" });
box.body.innerHTML = "title: " + h.doc().title + "<br>url: <code>" + h.url + "</code>";
""")

add("inspect a document by its url", "ACKNOWLEDGED. INSPECTING A DOCUMENT BY URL.", """
const url = accountDocHandle.doc().contactUrl;
const d = (await repo.find(url)).doc();
const box = dm.box({ title: "DOC " + url });
box.body.innerHTML = Object.keys(d).map((k) => "<b>" + k + "</b>: " + JSON.stringify(d[k])).join("<br>");
""")

add("a sticky note that saves what i type", "ACKNOWLEDGED. OPENING A SAVED STICKY NOTE.", """
const h = await repo.create2({ text: "type — it saves to the document" });
dm.mount(() => html`<div class="dm-box"><div class="dm-box-title">STICKY NOTE</div>
  <div class="dm-box-body">
    <textarea style="width:100%;min-height:70px" onInput=${(e) => h.change((d) => { d.text = e.target.value; })}>${h.doc().text}</textarea>
  </div></div>`);
""")

add("save my favorite color to a document", "ACKNOWLEDGED. SAVING A COLOR TO A DOCUMENT.", """
const h = await repo.create2({ color: "#ff2284" });
const [c, setC] = createSignal(h.doc().color);
h.on("change", () => setC(h.doc().color));
dm.mount(() => html`<div class="dm-box"><div class="dm-box-title">SAVED COLOR</div>
  <div class="dm-box-body" style="text-align:center">
    <input type="color" value=${c()} onInput=${(e) => h.change((d) => { d.color = e.target.value; })} style="width:60px;height:60px;border:none;background:none" />
    <div style="font-family:monospace">${() => c()}</div>
  </div></div>`);
""")

add("a to-do list that persists to a document", "ACKNOWLEDGED. CREATING A SAVED TO-DO LIST DOCUMENT.", """
const h = await repo.create2({ todos: [] });
const [todos, setTodos] = createSignal(h.doc().todos);
h.on("change", () => setTodos([...h.doc().todos]));
dm.mount(() => { let inp; return html`<div class="dm-box"><div class="dm-box-title">SAVED TODOS</div>
  <div class="dm-box-body">
    <div style="display:flex;gap:6px;margin-bottom:6px">
      <input ref=${(e) => (inp = e)} style="flex:1" placeholder="add a todo" />
      <button onClick=${() => { if (inp.value.trim()) { h.change((d) => { d.todos.push({ text: inp.value.trim(), done: false }); }); inp.value = ""; } }}>add</button>
    </div>
    <${For} each=${todos}>${(t, i) => html`<div style="margin:2px 0">
      <input type="checkbox" checked=${t.done} onChange=${() => h.change((d) => { d.todos[i()].done = !d.todos[i()].done; })} /> ${t.text}
    </div>`}<//>
  </div></div>`; });
""")


out = Path(__file__).parent / "seeds-patchwork.jsonl"
with open(out, "w") as f:
    for p in PAIRS:
        f.write(json.dumps(p) + "\n")
print(f"wrote {len(PAIRS)} patchwork/automerge pairs -> {out}")
