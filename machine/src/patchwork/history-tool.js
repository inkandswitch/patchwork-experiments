// The Machine's history view, for any engine. Two histories, one picture:
//
// The record (history/record.js): the session's documents, which Automerge
// keeps whole: every input anyone wrote, who held which port when, every
// checkpoint. Any tick from the first can be travelled to and watched from
// there (history/travel.js); and the session document's own changes read
// back as what happened to the record: ports taken, left, reaped, raced
// for; checkpoints; pauses (history/events.js), each with the seats as they
// stood then.
//
// This peer's tree (history/history.js): every state its engine was in
// lately, including the ones it believed for a while and rolled back. Each
// conflict is a branch peeling off where a prediction proved wrong; pick one
// to see both sides of it, step through them, and where they differ.
//
// The overview is the whole session; drag it, or zoom the strip (wheel, or
// 1s … All), to get anywhere in a long run. It knows engines only by their
// contract: rows of bytes, a state to rebuild, a frame(view) to draw. The
// peer is this tab's player if one is playing this machine
// (patchwork/traced.js), else a watcher of its own. Never a watcher beside a
// player in one tab: they share the tab's repo, and a repo's own ephemeral
// messages don't come back to it, so the watcher would hear that player only
// from its durable inputs, a second late.
import { compile } from "../engine.js";
import { Host } from "../host/host.js";
import { seating, gunzip } from "../host/session.js";
import { hashSnapshot } from "../wasm-state.js";
import { History, ancestorAt } from "../history/history.js";
import { Rebuilder } from "../history/rebuild.js";
import { Record } from "../history/record.js";
import { Travel } from "../history/travel.js";
import { sessionEvents } from "../history/events.js";
import { diffStates, diffPictures } from "../history/diff.js";
import { load } from "./load.js";
import { traced } from "./traced.js";
import css from "./history.css?inline";

const PORT = ["#e4572e", "#2e86ab", "#3bb273", "#a23b72", "#f0a202", "#7768ae", "#1b998b", "#c3423f"];
const AXIS = 18, LANE = 16, BRANCHES = 64;
const ZOOMS = [["1s", 1], ["10s", 10], ["1m", 60], ["10m", 600], ["All", Infinity]];
const SPEEDS = [0.25, 0.5, 1, 2, 4];

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  e.append(...kids.flat().filter((k) => k != null && k !== false));
  return e;
};
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");
const hueOf = (b) => {
  let h = 2166136261;
  for (const x of b) h = Math.imul(h ^ x, 16777619);
  return (h >>> 0) % 360;
};
const zero = (b) => b.every((x) => x === 0);
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

export default function MachineHistory(handle, element) {
  const repo = window.repo;
  const style = el("style");
  style.textContent = css;
  const root = el("div", { class: "machine-history", tabindex: "0" });
  element.append(style, root);
  let stop = () => {};
  let disposed = false;

  const show = async () => {
    stop();
    stop = () => {};
    const doc = handle.doc();
    root.replaceChildren(el("p", { class: "note" }, doc?.session ? "Loading…" : "This machine hasn't been started yet: open it in the Machine view first."));
    if (!doc?.session) return;
    try {
      const s = await view(doc);
      if (disposed) s();
      else stop = s;
    } catch (e) {
      root.replaceChildren(el("p", { class: "note", "data-error": true }, String(e.message ?? e)));
    }
  };

  async function view(doc) {
    const note = root.querySelector(".note");
    const { session, content, wasm } = await load(repo, doc, (t) => (note.textContent = t));
    const engine = session.doc().engine;
    const [num, den] = engine.hz;
    const hz = num / den;
    const W = engine.inputBytes;
    const ports = engine.players;
    const machine = await compile(wasm);
    const rebuilder = new Rebuilder(machine, content);
    const offs = [];

    // ---- the record: the session's documents, from the start
    const record = new Record(session.doc());
    const seatDocs = new Set();
    const watchSeats = () => {
      for (const s of record.seats()) {
        if (seatDocs.has(s.id) || !s.inputs) continue;
        seatDocs.add(s.id);
        repo.find(s.inputs).then(
          (h) => {
            const on = () => {
              record.ingest(s.id, h.doc());
              uiDirty = true;
            };
            h.on("change", on);
            offs.push(() => h.off("change", on));
            on();
          },
          () => seatDocs.delete(s.id),
        );
      }
    };
    const loadCheckpoint = async (url) => {
      const cp = (await repo.find(url)).doc();
      const snap = await gunzip(cp.state);
      if (hashSnapshot(snap) !== cp.hash) throw new Error("a checkpoint that does not match its hash");
      return snap;
    };
    const travel = new Travel(machine, content, record, { load: loadCheckpoint, budget: 96e6 });
    const memo = { changes: new Map(), spelled: new Map() };
    let events = [], eventsDirty = true, eventsAt = 0;
    watchSeats();

    // ---- the peer whose tree this is
    let watcher = null; // { host, history }, while there is no player here
    let src = null; // { kind, host, history, by? }
    let choosing = false;
    const choose = async () => {
      if (choosing) return;
      choosing = true;
      try {
        const p = traced.get(doc.session);
        if (p) {
          watcher?.host.close();
          watcher = null;
          src = { kind: "player", ...p };
        } else {
          if (!watcher) {
            const history = new History({ inputBytes: W, keep: Math.round(600 * hz) });
            const host = await Host.open(repo, doc.session, { wasm, content, trace: history.record });
            watcher = { host, history };
          }
          src = { kind: "watcher", ...watcher };
        }
        reset();
        source.textContent = src.kind === "player" ? `this tab's player (${src.by ?? "you"})` : "a watcher (no one plays in this tab)";
      } finally {
        choosing = false;
      }
    };

    // ---- what is looked at
    let cursor = null; // a tick, or null to follow the head
    let sel = null; // a conflict
    let pinned = null; // an event, shown above the tick it is about
    let span = Math.round(10 * hz); // ticks across the strip
    let end = null; // the strip's last tick; null follows the head
    let pictureView = 0;
    let playing = false, speed = 1, owed = 0, lastFrame = 0;
    let tab = "conflicts";
    let path = { root: null, at: [] }; // the head's path by tick - root.tick, kept in step
    let shownKey = "", listed = "", stripVersion = -1, uiDirty = true;

    function reset() {
      cursor = null;
      sel = null;
      pinned = null;
      end = null;
      playing = false;
      path = { root: null, at: [] };
      shownKey = "";
      listed = "";
      uiDirty = true;
    }
    const head = () => src.history.head?.tick ?? 0;
    // The last tick anything knows of: the record's end, or this peer's head.
    const total = () => Math.max(record.end, head());
    const clampTick = (t) => Math.max(0, Math.min(total(), t));
    const lookAt = (t) => {
      cursor = clampTick(t);
      shownKey = "";
      uiDirty = true;
      if (end === null || cursor > end || cursor < end - span) end = Math.min(total(), cursor + Math.round(span / 2));
    };

    // The head's path, by tick, updated from the head up to where it meets
    // what it was (a rollback rewrites only the ticks it re-stepped).
    function syncPath() {
      const h = src.history;
      const r = h.root;
      if (!r || !h.head) return;
      if (path.root !== r) path = { root: r, at: [] };
      const fresh = [];
      for (let n = h.head; n && path.at[n.tick - r.tick] !== n; n = n.parent) fresh.push(n);
      for (const n of fresh) path.at[n.tick - r.tick] = n;
      path.at.length = h.head.tick - r.tick + 1;
    }
    const onPath = (t) => (path.root ? path.at[t - path.root.tick] ?? null : null);

    // One port's input at tick t (stepped from t to t + 1): this peer's,
    // where its tree reaches, else the record's. { bytes, sure } or null.
    const inputAt = (p, t) => {
      const n = onPath(t + 1);
      if (n?.row) return { bytes: n.row.subarray(p * W, (p + 1) * W), sure: t < src.history.frontier };
      const b = record.inputAt(p, t);
      return b ? { bytes: b, sure: true } : null;
    };

    // The state at tick t: from this peer's tree if it has it, else
    // travelled to through the record, a few ms a frame.
    function stateAt(t) {
      const node = onPath(t);
      if (node) return { engine: rebuilder.at(node), node };
      travel.seek(t);
      const s = travel.work(10);
      if (s === "there") return { engine: travel.engine };
      if (s === "beyond") return { pending: `The record doesn't reach tick ${t} yet: it is written up to tick ${record.end}.` };
      return { pending: s === "waiting" ? "Fetching a checkpoint…" : `Travelling… tick ${travel.at} of ${t}` };
    }

    // The two sides of a conflict at tick t.
    const keptAt = (c, t) => {
      if (src.history.kept(c.kept)) return onPath(t) ?? src.history.head;
      let n = c.kept;
      while (n.tick < t && n.kids.length) n = n.kids.at(-1);
      return n;
    };
    const abandonedAt = (c, t) => ancestorAt(c.leaf, Math.min(t, c.leaf.tick)) ?? c.leaf;
    const shownOn = (c) => {
      let frames = 0;
      for (let n = c.leaf; n && n !== c.parent; n = n.parent) frames += n.shown;
      return frames;
    };

    // ---- the page
    const source = el("span", { class: "source" });
    const stats = el("span", { class: "stats" });
    const followBtn = el("button", { onclick: () => { reset(); root.focus(); } }, "Follow");
    const viewSel = el("select", { title: "Which view the engine draws (a player, a camera)", onchange: () => { pictureView = +viewSel.value; shownKey = ""; } },
      ...Array.from({ length: Math.max(1, ports) }, (_, i) => el("option", { value: i }, `view ${i}`)));
    const playBtn = el("button", { class: "play", title: "Play from here (space)", onclick: () => togglePlay() }, "▶");
    const speedSel = el("select", { title: "Playback speed", onchange: () => (speed = +speedSel.value) },
      ...SPEEDS.map((s) => el("option", { value: s, selected: s === 1 }, `${s}×`)));
    const zooms = el("span", { class: "zooms" }, ...ZOOMS.map(([label, secs]) => el("button", { onclick: () => zoom(secs) }, label)));
    const screen = (side, label) => {
      const canvas = el("canvas");
      const cap = el("figcaption", {}, label);
      return { fig: el("figure", { "data-side": side }, canvas, cap), canvas, cap, image: null };
    };
    const kept = screen("kept", "Now");
    const lost = screen("abandoned", "Predicted");
    const delta = screen("diff", "Where they differ");
    const overview = el("canvas", { class: "overview", title: "The whole session: click or drag to go there" });
    const strip = el("canvas", { class: "strip" });
    const list = el("ol", { class: "items" });
    const tabs = el("div", { class: "tabs" });
    const detail = el("section", { class: "detail" });
    root.replaceChildren(
      el("header", {}, el("strong", {}, doc.title ?? "Machine"), el("span", { class: "muted" }, "history of"), source, viewSel, el("span", { class: "grow" }), stats, followBtn),
      el("div", { class: "screens" }, kept.fig, lost.fig, delta.fig),
      el("div", { class: "controls" }, playBtn, speedSel, el("span", { class: "grow" }), zooms),
      overview,
      strip,
      el("div", { class: "lower" }, el("section", { class: "list" }, tabs, list), detail),
    );

    function paint(s, pic, mask = null) {
      if (!pic?.width) return;
      if (s.canvas.width !== pic.width || s.canvas.height !== pic.height) {
        s.canvas.width = pic.width;
        s.canvas.height = pic.height;
        s.image = null;
      }
      s.image ??= new ImageData(pic.width, pic.height);
      const d = s.image.data;
      if (!mask) d.set(pic.rgba);
      else
        for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
          const on = mask[p];
          d[i] = on ? 255 : pic.rgba[i] * 0.3;
          d[i + 1] = on ? 40 : pic.rgba[i + 1] * 0.3;
          d[i + 2] = on ? 60 : pic.rgba[i + 2] * 0.3;
          d[i + 3] = 255;
        }
      s.canvas.getContext("2d").putImageData(s.image, 0, 0);
    }

    function zoom(secs) {
      const all = total() + 1;
      span = Math.max(20, Math.min(all, Math.round(secs * hz)));
      if (secs === Infinity) end = all;
      else if (cursor !== null) end = Math.min(all, cursor + Math.round(span / 2));
      uiDirty = true;
    }

    function togglePlay() {
      if (playing) playing = false;
      else {
        if (cursor === null || cursor >= head()) lookAt(Math.max(0, lastTick() - span));
        sel = null;
        playing = true;
        owed = 0;
      }
      uiDirty = true;
    }

    // ---- the screens and the detail, for what is selected
    function drawSelection(now) {
      const h = src.history;
      if (!h.head) return;
      playBtn.textContent = playing ? "⏸" : "▶";
      if (playing) {
        // Time runs for the cursor only once its state is on screen, so a
        // slow engine plays slower rather than skipping.
        owed += ((now - lastFrame) / 1000) * hz * speed;
        if (shownKey.startsWith("tick:")) {
          const k = Math.floor(owed);
          if (k > 0) {
            owed -= k;
            if (cursor + k >= head()) reset();
            else {
              lookAt(cursor + k);
              pinned = null;
            }
          }
        } else owed = Math.min(owed, hz);
      }
      if (!sel && cursor === null) {
        // Following: the peer's own picture, as it draws it, once per state.
        lost.fig.hidden = delta.fig.hidden = true;
        const key = `follow:${h.head.id}:${pictureView}`;
        if (kept.drawn !== key) {
          const pic = src.host.picture(pictureView);
          if (pic) paint(kept, pic);
          kept.drawn = key;
        }
        kept.cap.textContent = `Now · tick ${h.head.tick}`;
        if (shownKey !== "follow") {
          shownKey = "follow";
          detail.replaceChildren(el("p", { class: "note" }, "Following the head. Click the strip or the overview to go to any tick since the start, and ▶ to watch from there. Pick a conflict to see both sides of it, or an event in the record. ← → step a tick · [ ] previous and next conflict · space plays · Esc follows."));
        }
        return;
      }
      if (!sel) {
        const t = cursor;
        const key = `tick:${t}:${pictureView}:${onPath(t)?.id ?? "r"}:${pinned?.hash ?? ""}`;
        if (key === shownKey) return;
        lost.fig.hidden = delta.fig.hidden = true;
        const s = stateAt(t);
        if (s.pending) {
          kept.cap.textContent = s.pending;
          shownKey = "";
          return;
        }
        shownKey = key;
        kept.drawn = null;
        paint(kept, s.engine.frame(pictureView));
        const sure = s.node ? t <= h.frontier : true;
        kept.cap.textContent = `Tick ${t} · ${s.node ? (sure ? "confirmed" : "predicted, so far") : "from the record"}`;
        if (!playing || now - (drawSelection.detailAt ?? 0) > 250) {
          drawSelection.detailAt = now;
          detail.replaceChildren(...[pinned && eventDetail(pinned), ...tickDetail(t, s.node, sure)].filter(Boolean));
        }
        return;
      }
      const t = cursor ?? sel.leaf.tick;
      const key = `conflict:${sel.kept.id}:${t}:${pictureView}:${h.head.id}`;
      if (key === shownKey) return;
      shownKey = key;
      kept.drawn = null;
      const a = abandonedAt(sel, t), k = keptAt(sel, t);
      const sa = rebuilder.snapshot(a);
      const picA = rebuilder.at(a).frame(pictureView);
      const sk = rebuilder.snapshot(k);
      const picK = rebuilder.at(k).frame(pictureView);
      const d = diffStates(sa, sk);
      const pd = diffPictures(picA, picK);
      lost.fig.hidden = delta.fig.hidden = false;
      paint(lost, picA);
      paint(kept, picK);
      if (pd) paint(delta, picK, pd.mask);
      lost.cap.textContent = `Predicted · tick ${a.tick}${a.tick < t ? " (as far as it got)" : ""}`;
      kept.cap.textContent = `${h.kept(sel.kept) ? "Kept" : "Stepped instead (since rolled back again)"} · tick ${k.tick}`;
      delta.cap.textContent = pd ? `${((100 * pd.pixels) / pd.of).toFixed(1)}% of pixels differ` : "Where they differ";
      detail.replaceChildren(...conflictDetail(sel, t, d, pd).filter(Boolean));
    }

    const bits = (a, b) =>
      el("span", { class: "bits" }, ...Array.from(a, (x, i) =>
        el("span", { class: "byte" }, ...Array.from({ length: 8 }, (_, j) => {
          const bit = 7 - j;
          const on = (x >> bit) & 1, other = b ? (b[i] >> bit) & 1 : on;
          return el("i", { "data-on": !!on, "data-diff": on !== other });
        }))));
    const swatch = (p) => el("span", { class: "swatch", style: `background:${PORT[p % PORT.length]}` });

    function tickDetail(t, node, sure) {
      const h = src.history;
      const forks = node?.parent?.kids.length > 1 ? h.conflicts.filter((c) => c.parent === node.parent) : [];
      const seated = record.seated;
      return [
        el("h3", {}, `Tick ${t}`, el("span", { class: "muted" }, `${(t / hz).toFixed(2)} s in`)),
        el("p", { class: "note" }, node
          ? `${sure ? "Confirmed: every peer with these inputs has this state." : "Past the frontier: some input here is still this peer's prediction."} Shown on ${plural(node.shown, "frame")}.`
          : "Rebuilt from the session's documents: the state every peer confirmed."),
        el("table", {}, el("tr", {}, el("th", {}, "Port"), el("th", {}, "Held by"), el("th", {}, `Input, ${t} → ${t + 1}`), el("th", {}, "Bits")),
          ...Array.from({ length: ports }, (_, p) => {
            const i = inputAt(p, t);
            const s = seated[p].find((x) => x.from <= t && t < x.until);
            const by = s ? record.seats().find((x) => x.id === s.id)?.by ?? "someone" : "nobody";
            return el("tr", {}, el("td", {}, swatch(p), `P${p + 1}`), el("td", {}, by), el("td", { class: "mono" }, i ? hex(i.bytes) : "not written yet"), el("td", {}, i && bits(i.bytes)));
          })),
        forks.length ? el("p", {}, `This step was taken ${forks.length + 1} ways: it is a conflict.`) : null,
      ];
    }

    function conflictDetail(c, t, d, pd) {
      const late = c.leaf.tick - c.parent.tick;
      const ago = ((src.history.at - c.at) / 1000).toFixed(1);
      return [
        el("h3", {}, `Conflict at tick ${c.parent.tick}: ${c.ports.map((p) => `P${p + 1}`).join(", ")}`),
        el("p", {}, `This peer predicted ${c.ports.length === 1 ? "this port's input" : "these ports' inputs"} (each repeats its last known input), stepped on ${plural(late, "tick")} (${Math.round((late * 1000) / hz)} ms) to tick ${c.leaf.tick}, then learned the real input, ${ago} s ago. It rolled back and stepped ${plural(c.restepped, "tick")} again; the predicted branch reached the screen on ${plural(shownOn(c), "frame")}.`),
        el("table", {}, el("tr", {}, el("th", {}, "Port"), el("th", {}, "Predicted"), el("th", {}, "Real"), el("th", {}, "Bits (real; red where the prediction differs)")),
          ...c.ports.map((p) => {
            const a = c.abandoned.row.subarray(p * W, (p + 1) * W), k = c.kept.row.subarray(p * W, (p + 1) * W);
            return el("tr", {}, el("td", {}, swatch(p), `P${p + 1}`), el("td", { class: "mono" }, hex(a)), el("td", { class: "mono" }, hex(k)), el("td", {}, bits(k, a)));
          })),
        el("h3", {}, `At tick ${t}`, el("input", { type: "range", min: c.parent.tick + 1, max: Math.max(c.leaf.tick, c.parent.tick + 1), value: t, oninput: (e) => { cursor = +e.target.value; shownKey = ""; } })),
        el("p", {}, d.bytes === 0 && d.globals === 0
          ? "The two states are the same here: the branches have converged."
          : `The states differ in ${plural(d.bytes, "byte")} of memory, in ${plural(d.regions.length, "place")}${d.globals ? `, and ${plural(d.globals, "global")}` : ""}${pd ? `; ${pd.pixels.toLocaleString()} pixels of the picture` : ""}.`),
        d.regions.length ? el("ul", { class: "regions mono" }, ...d.regions.slice(0, 12).map(([a, b]) => el("li", {}, `0x${a.toString(16).padStart(8, "0")}–0x${b.toString(16).padStart(8, "0")} · ${b - a} B span`)), d.regions.length > 12 ? el("li", {}, `… ${d.regions.length - 12} more`) : null) : null,
      ];
    }

    // ---- the record's events: what each change to the session did
    const who = (e) => e.by ?? "someone";
    function say(e) {
      const P = `P${(e.port ?? 0) + 1}`;
      switch (e.kind) {
        case "made": return "The session was made";
        case "claim": return `${who(e)} took ${P} from tick ${e.tick}${e.concurrent ? ", at the same moment as another claim on it" : ""}`;
        case "end": return `${who(e)} left ${P} at tick ${e.tick}`;
        case "lost": return `${who(e)}'s claim on ${P} lost: the other claim came first, and won everywhere`;
        case "reap": return `${e.who ?? "a peer"} ended ${who(e)}'s seat on ${P} at tick ${e.tick}: they had gone quiet`;
        case "roll": return `${who(e)}'s ${P} inputs go on in a new document from tick ${e.tick}`;
        case "checkpoint": return `Checkpoint at tick ${e.tick}`;
        case "stale": return `Checkpoint at tick ${e.tick} dropped: a seat change before it made it stale`;
        case "pause": return `${e.who ?? "Someone"} paused at tick ${e.tick}`;
        case "resume": return `${e.who ?? "Someone"} started the clock from tick ${e.tick}`;
      }
      return e.kind;
    }
    const minor = (e) => e.kind === "roll" || e.kind === "checkpoint";

    // The seats as this change left them: the record as it was known then.
    function eventDetail(e) {
      const at = memo.spelled.get(e.hash);
      let then = null;
      try {
        then = at ? session.view([at]).doc() : null;
      } catch {}
      const seated = then ? seating(then.seats, ports) : null;
      return el("div", { class: "event" },
        el("h3", {}, say(e)),
        el("p", { class: "note" }, `${clock(e.time)} · change ${e.hash.slice(0, 8)} by ${e.who ?? "a peer"} (${e.actor.slice(0, 8)})`),
        seated && el("p", { class: "note" }, "Who the record said held each port, as of this change:"),
        seated && el("ul", { class: "then" }, ...seated.map((list, p) =>
          el("li", {}, swatch(p), `P${p + 1}: `, list.length ? list.map((s) => `${then.seats[s.id]?.by ?? "someone"} ${s.from}–${s.until === Infinity ? "on" : s.until}`).join(", ") : "nobody"))));
    }

    // ---- the list: conflicts, or the record's events, newest first
    function drawList() {
      const cs = src.history.conflicts;
      const key = `${tab}:${cs.length}:${events.length}:${sel?.kept.id}:${pinned?.hash}`;
      if (key === listed) return;
      listed = key;
      tabs.replaceChildren(
        el("button", { "data-on": tab === "conflicts", onclick: () => ((tab = "conflicts"), (uiDirty = true)) }, `Conflicts (${cs.length})`),
        el("button", { "data-on": tab === "record", onclick: () => ((tab = "record"), (uiDirty = true)) }, `Record (${events.length})`),
      );
      if (tab === "conflicts") {
        const shown = cs.slice(-300).reverse();
        list.replaceChildren(...shown.map((c) => el("li", { "data-selected": c === sel, onclick: () => select(c) },
          swatch(c.ports[0]), `tick ${c.parent.tick} · ${c.ports.map((p) => `P${p + 1}`).join(",")} · ${c.leaf.tick - c.parent.tick} late${shownOn(c) ? ` · shown ${shownOn(c)}` : ""}`)),
          cs.length > 300 ? el("li", { class: "muted" }, `and ${cs.length - 300} older`) : null);
        if (!cs.length) list.replaceChildren(el("li", { class: "muted" }, "None yet. They happen when an input arrives after the tick it was for has been stepped on a prediction, and the prediction was wrong."));
      } else {
        const shown = events.slice(-500).reverse();
        list.replaceChildren(...shown.map((e) => el("li", { "data-selected": e === pinned, "data-minor": minor(e), "data-kind": e.kind, onclick: () => pin(e) },
          e.port !== undefined ? swatch(e.port) : el("span", { class: "swatch" }), el("span", { class: "muted time" }, clock(e.time)), say(e))));
      }
    }

    function select(c) {
      sel = c;
      pinned = null;
      playing = false;
      cursor = c ? c.leaf.tick : cursor;
      if (c) end = Math.max(c.leaf.tick + Math.round(span * 0.2), Math.min(head(), c.parent.tick + span));
      shownKey = "";
      uiDirty = true;
    }

    function pin(e) {
      sel = null;
      playing = false;
      pinned = e;
      lookAt(e.tick ?? 0);
    }

    // ---- the overview (the whole session) and the strip (a window on it)
    let hits = [];
    const lastTick = () => end ?? Math.max(head(), src.history.target);
    function canvasFor(c, cssH) {
      const dpr = window.devicePixelRatio || 1;
      const cssW = c.clientWidth || 600;
      if (c.width !== Math.round(cssW * dpr) || c.height !== Math.round(cssH * dpr)) {
        c.width = Math.round(cssW * dpr);
        c.height = Math.round(cssH * dpr);
        c.style.height = `${cssH}px`;
      }
      const g = c.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, cssW, cssH);
      return { g, cssW };
    }
    const colours = () => {
      const cs = getComputedStyle(root);
      return { ink: cs.color, faint: cs.getPropertyValue("--hist-faint").trim() || "#8884" };
    };

    function drawOverview() {
      const cssH = 8 + ports * 4 + 8;
      const { g, cssW } = canvasFor(overview, cssH);
      const { ink, faint } = colours();
      const all = Math.max(1, total() + 1);
      const x = (t) => (t / all) * cssW;
      g.fillStyle = faint;
      g.fillRect(0, 0, cssW, cssH);
      record.seated.forEach((list, p) => {
        g.fillStyle = PORT[p % PORT.length];
        for (const s of list) g.fillRect(x(s.from), 6 + p * 4, Math.max(1, x(Math.min(s.until, all)) - x(s.from)), 3);
      });
      g.fillStyle = "#c80";
      for (const c of record.checkpoints()) g.fillRect(x(c.tick), cssH - 5, 1, 4);
      g.fillStyle = "#e33";
      for (const c of src.history.conflicts) g.fillRect(x(c.parent.tick), 0, 1, 5);
      // The window the strip shows, and where the cursor is.
      const t1 = lastTick(), t0 = t1 - span;
      g.strokeStyle = ink;
      g.lineWidth = 1;
      g.strokeRect(Math.max(0, x(t0)) + 0.5, 0.5, Math.max(3, x(t1) - Math.max(0, x(t0))), cssH - 1);
      if (cursor !== null) {
        g.fillStyle = "#e33";
        g.fillRect(x(cursor), 0, 2, cssH);
      }
      overview.all = all;
    }

    function drawStrip() {
      const h = src.history;
      const cssH = AXIS + ports * LANE + BRANCHES;
      const { g, cssW } = canvasFor(strip, cssH);
      const { ink, faint } = colours();
      const t1 = lastTick(), t0 = t1 - span;
      const x = (t) => ((t - t0) / span) * cssW;
      const tickAtX = (px) => Math.round(t0 + (px / cssW) * span);

      // Axis: seconds, checkpoints, pauses.
      g.fillStyle = ink;
      g.font = "10px system-ui, sans-serif";
      const fmt = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`);
      const step = [1, 2, 5, 10, 30, 60, 120, 300, 600, 1800].find((s) => (s * hz * cssW) / span > 60) ?? 3600;
      for (let s = Math.max(0, Math.ceil(t0 / hz / step)) * step; s * hz <= t1; s += step) {
        g.fillRect(x(s * hz), AXIS - 4, 1, 4);
        g.fillText(fmt(s), x(s * hz) + 2, 10);
      }
      g.fillStyle = "#c80";
      for (const c of record.checkpoints()) {
        const cx = x(c.tick);
        if (cx < 0 || cx > cssW) continue;
        g.beginPath();
        g.moveTo(cx, AXIS - 9); g.lineTo(cx + 4, AXIS - 5); g.lineTo(cx, AXIS - 1); g.lineTo(cx - 4, AXIS - 5);
        g.fill();
      }

      // Port lanes: who held it, its input (this peer's where it has it,
      // else the record's), and the record's seat events on it.
      const perPx = span / cssW;
      for (let p = 0; p < ports; p++) {
        const y = AXIS + p * LANE;
        g.fillStyle = faint;
        g.fillRect(0, y + LANE - 1, cssW, 1);
        for (const s of record.seated[p]) {
          const a = Math.max(0, x(s.from)), b = Math.min(cssW, x(Math.min(s.until, t1 + 1)));
          if (b <= a) continue;
          g.fillStyle = PORT[p % PORT.length] + "22";
          g.fillRect(a, y, b - a, LANE - 1);
        }
        const cols = perPx > 1 ? cssW : span;
        for (let i = 0; i < cols; i++) {
          const t = perPx > 1 ? Math.floor(t0 + i * perPx) : t0 + i;
          if (t < 0) continue;
          const at = inputAt(p, t);
          if (!at || zero(at.bytes)) continue;
          g.fillStyle = `hsla(${hueOf(at.bytes)}, 65%, 50%, ${at.sure ? 1 : 0.4})`;
          g.fillRect(perPx > 1 ? i : x(t), y + 3, Math.max(1, perPx > 1 ? 1 : cssW / span), LANE - 7);
        }
        g.fillStyle = ink;
        g.fillText(`P${p + 1}`, 3, y + 11);
      }
      for (const e of events) {
        if (e.port === undefined || e.tick === undefined || e.kind === "roll") continue;
        const ex = x(e.tick);
        if (ex < 0 || ex > cssW) continue;
        const y = AXIS + e.port * LANE;
        g.fillStyle = e.kind === "lost" || e.concurrent ? "#e33" : ink;
        g.fillRect(ex - 0.5, y, 2, LANE - 1);
        g.beginPath();
        g.moveTo(ex - 3, y); g.lineTo(ex + 4, y); g.lineTo(ex + 0.5, y + 4);
        g.fill();
      }

      // Branches: each conflict peels off where it forked and runs to where
      // the peer had got on it.
      const top = AXIS + ports * LANE;
      g.fillStyle = faint;
      g.fillRect(0, top + 6, cssW, 1);
      hits = [];
      const slots = [];
      for (const c of h.conflicts) {
        if (c.leaf.tick < t0 || c.parent.tick > t1) continue;
        let slot = slots.findIndex((e) => e < c.parent.tick);
        if (slot < 0) slot = slots.length;
        if (slot > 6) continue;
        slots[slot] = c.leaf.tick + 1;
        const y = top + 14 + slot * 7;
        const a = x(c.parent.tick), b = Math.max(x(c.leaf.tick), a + 3);
        g.strokeStyle = PORT[c.ports[0] % PORT.length];
        g.lineWidth = c === sel ? 3 : 1.5;
        g.beginPath();
        g.moveTo(a, top + 6);
        g.lineTo(Math.min(b, a + 4), y);
        g.lineTo(b, y);
        g.stroke();
        hits.push([a - 3, top + 6, b + 3, y + 4, c]);
      }
      g.fillStyle = ink;
      const tree = h.root ? `this peer's tree from tick ${h.root.tick}` : "";
      g.fillText(`${plural(h.conflicts.length, "conflict")} · ${h.idle} idle rollbacks · ${tree}`, 3, top + BRANCHES - 4);
      // Where this peer's tree begins: before it, only the record.
      if (h.root && x(h.root.tick) > 0) {
        g.fillStyle = faint;
        g.fillRect(0, top + 8, Math.min(cssW, x(h.root.tick)), BRANCHES - 22);
      }

      // The frontier, the head, the cursor.
      const line = (t, color, dash = []) => {
        const lx = x(t);
        if (lx < 0 || lx > cssW) return;
        g.strokeStyle = color;
        g.lineWidth = 1;
        g.setLineDash(dash);
        g.beginPath();
        g.moveTo(lx + 0.5, 0);
        g.lineTo(lx + 0.5, cssH);
        g.stroke();
        g.setLineDash([]);
      };
      line(h.frontier, "#3a3");
      line(head(), ink, [3, 3]);
      if (cursor !== null) line(cursor, "#e33");
      strip.tickAtX = tickAtX;
    }

    // ---- input: the overview jumps, the strip pans, zooms and picks
    const fromOverview = (e) => {
      const r = overview.getBoundingClientRect();
      const t = Math.round(((e.clientX - r.left) / r.width) * (overview.all ?? 1));
      end = Math.min(overview.all ?? t, Math.max(span, t + Math.round(span / 2)));
      uiDirty = true;
      return t;
    };
    let scrub = false;
    overview.addEventListener("pointerdown", (e) => {
      scrub = true;
      overview.setPointerCapture(e.pointerId);
      fromOverview(e);
    });
    overview.addEventListener("pointermove", (e) => scrub && fromOverview(e));
    overview.addEventListener("pointerup", (e) => {
      if (!scrub) return;
      scrub = false;
      sel = null;
      pinned = null;
      lookAt(fromOverview(e));
      root.focus();
    });
    overview.addEventListener("dblclick", () => zoom(Infinity));

    let drag = null;
    strip.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, end: lastTick(), moved: false };
      strip.setPointerCapture(e.pointerId);
    });
    strip.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 3) drag.moved = true;
      if (drag.moved) {
        end = Math.round(drag.end - (dx / strip.clientWidth) * span);
        uiDirty = true;
      }
    });
    strip.addEventListener("pointerup", (e) => {
      const d = drag;
      drag = null;
      if (!d || d.moved || !strip.tickAtX) return;
      const r = strip.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const hit = hits.find(([a, b, c, d2]) => px >= a && px <= c && py >= b && py <= d2);
      if (hit) return select(hit[4]);
      const t = clampTick(strip.tickAtX(px));
      if (sel && (t <= sel.parent.tick || t > sel.leaf.tick)) select(null);
      end ??= lastTick();
      pinned = null;
      if (sel) {
        cursor = t;
        shownKey = "";
      } else lookAt(t);
      root.focus();
    });
    strip.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = strip.getBoundingClientRect();
      const t = strip.tickAtX?.(e.clientX - r.left) ?? lastTick();
      const t1 = lastTick();
      const next = Math.max(20, Math.min(Math.max(total() + 1, Math.round(600 * hz)), Math.round(span * Math.pow(1.0015, e.deltaY))));
      // Keep the tick under the pointer where it is.
      end = Math.round(t + ((t1 - t) * next) / span);
      span = next;
      uiDirty = true;
    }, { passive: false });
    root.addEventListener("keydown", (e) => {
      const h = src.history;
      const cs = h.conflicts;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const d = (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? Math.round(hz) : 1);
        const t = (cursor ?? head()) + d;
        if (sel) {
          cursor = Math.max(sel.parent.tick + 1, Math.min(sel.leaf.tick, t));
          shownKey = "";
        } else lookAt(t);
      } else if ((e.key === "[" || e.key === "]") && cs.length) {
        const i = sel ? cs.indexOf(sel) : cs.length;
        select(cs[Math.max(0, Math.min(cs.length - 1, i + (e.key === "[" ? -1 : 1)))]);
      } else if (e.key === "Home") {
        sel = null;
        lookAt(0);
      } else if (e.key === "End" || e.key === "Escape") reset();
      else if (e.key === " ") togglePlay();
      else return;
      e.preventDefault();
    });

    // ---- the loop
    const onSession = () => {
      travel.invalidate(record.update(session.doc()));
      watchSeats();
      eventsDirty = true;
      uiDirty = true;
    };
    session.on("change", onSession);
    offs.push(() => session.off("change", onSession));
    await choose();
    let raf = 0, lastStrip = 0, lastStats = 0;
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      if (src.kind === "watcher") src.host.frame();
      // A player here may have come, or gone (its view closed).
      if ((traced.get(doc.session)?.history ?? null) !== (src.kind === "player" ? src.history : null)) choose();
      if (eventsDirty && now - eventsAt > 1000) {
        eventsDirty = false;
        eventsAt = now;
        try {
          events = sessionEvents(session, hz, memo);
        } catch (e) {
          console.warn("machine history: reading the session's changes", e);
        }
        uiDirty = true;
      }
      if (now - lastStats > 500) {
        lastStats = now;
        const h = src.history, st = src.host.stats ?? {};
        stats.textContent = `tick ${head()} · recorded to ${record.end} · ${plural(h.conflicts.length, "conflict")} · ${st.rewinds ?? 0} rollbacks${travel.stats.mismatches.length ? " · OUT OF STEP with a checkpoint!" : ""}`;
        followBtn.disabled = cursor === null && !sel && end === null;
      }
      if (!src.history.head) return;
      syncPath();
      if (src.history.version !== stripVersion || uiDirty || drag || scrub || playing) {
        if (now - lastStrip > 33 || uiDirty) {
          stripVersion = src.history.version;
          lastStrip = now;
          if (playing && cursor !== null && end !== null && cursor > end - span * 0.1) end = Math.min(total(), cursor + Math.round(span * 0.6));
          drawOverview();
          drawStrip();
          drawList();
          uiDirty = false;
        }
      }
      try {
        drawSelection(now);
      } catch (e) {
        detail.replaceChildren(el("p", { class: "note", "data-error": true }, String(e.message ?? e)));
      }
      lastFrame = now;
    };
    raf = requestAnimationFrame((now) => {
      lastFrame = now;
      loop(now);
    });
    root.focus();

    return () => {
      cancelAnimationFrame(raf);
      for (const off of offs.splice(0)) off();
      watcher?.host.close();
    };
  }

  let last = JSON.stringify([handle.doc()?.session, handle.doc()?.content]);
  const onChange = () => {
    const now = JSON.stringify([handle.doc()?.session, handle.doc()?.content]);
    if (now !== last) {
      last = now;
      show();
    }
  };
  handle.on("change", onChange);
  show();

  return () => {
    disposed = true;
    handle.off("change", onChange);
    stop();
    root.remove();
    style.remove();
  };
}
