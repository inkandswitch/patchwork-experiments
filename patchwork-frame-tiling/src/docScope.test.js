// Does a document view in a tiling-frame tab always resolve its document
// through *its own* draft overlay? If its `repo:handle-descriptor` request
// reaches the root `repo-provider` instead, that answer is a pass-through the
// view keeps for good, and a draft or history scrub never reaches it.
//
// A fake <patchwork-view> stands in for the real one, as far as this goes:
//  - a component view mounts its provider (now, in a microtask, a macrotask,
//    or late) once that component is registered, then sends
//    `patchwork:mounted {componentId}`; a change of `component` restarts it;
//  - a tool view (doc-url) asks for its document's descriptor (now, in a
//    microtask, a macrotask, or late) by a bubbling `patchwork:subscribe`;
//  - the overlay provider accepts descriptors (stops propagation), and
//    anything unaccepted reaches the root, which answers pass-through.
// Every combination of those timings, with drafts registered from the start
// or only later (so the tab's provider list grows under it), must end with the
// one connected tool view answered by the overlay, nested inside the draft
// state and overlay, and the draft-state element reported as the scope.

import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocScope } from "./docScope";

vi.mock("@automerge/automerge-repo-react-hooks", () => ({ useRepo: () => null }));
vi.mock("@inkandswitch/patchwork-providers", () => ({ subscribe: () => () => {} }));

const h = createElement;

const STATE = "patchwork-draft-state-provider";
const OVERLAY = "patchwork-draft-overlay-provider";
const COMMENTS = "patchwork-comments-provider";
const FOCUS = "patchwork-focus-provider";
const DOC = "automerge:doc";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LATE_MS = 60; // after everything the others do
const later = (when, fn) => {
  if (when === "now") fn();
  else if (when === "micro") queueMicrotask(fn);
  else setTimeout(fn, when === "macro" ? 0 : LATE_MS);
};

// The world one scenario runs in.
let world;
function newWorld({ mountWhen, askWhen }) {
  const registered = new Set([COMMENTS, FOCUS]);
  const waiting = new Set();
  return {
    mountWhen,
    askWhen,
    registered,
    register(ids) {
      for (const id of ids) registered.add(id);
      for (const w of [...waiting]) w();
    },
    waiting,
  };
}

class FakeView extends HTMLElement {
  static get observedAttributes() {
    return ["component"];
  }
  gen = 0;
  connectedCallback() {
    this.start();
  }
  disconnectedCallback() {
    this.stop();
  }
  attributeChangedCallback(name, old, val) {
    if (old === val || !this.isConnected) return;
    this.stop();
    this.start();
  }
  stop() {
    this.gen++;
    this.cleanup?.();
    this.cleanup = null;
  }
  start() {
    const gen = this.gen;
    const component = this.getAttribute("component");
    if (component) {
      const mount = () => {
        if (gen !== this.gen || !this.isConnected) return;
        if (!world.registered.has(component)) {
          const retry = () => {
            world.waiting.delete(retry);
            mount();
          };
          world.waiting.add(retry);
          return;
        }
        if (component === OVERLAY) {
          const accept = (e) => {
            if (e.detail?.selector?.type !== "repo:handle-descriptor") return;
            e.stopPropagation();
            e.detail.answer("overlay", this);
          };
          this.addEventListener("patchwork:subscribe", accept);
          this.cleanup = () => this.removeEventListener("patchwork:subscribe", accept);
        }
        this.dispatchEvent(new CustomEvent("patchwork:mounted", { detail: { componentId: component }, bubbles: true, composed: true }));
      };
      later(world.mountWhen, mount);
    } else if (this.hasAttribute("doc-url")) {
      later(world.askWhen, () => {
        if (gen !== this.gen || !this.isConnected) return;
        this.answeredBy = null;
        this.dispatchEvent(
          new CustomEvent("patchwork:subscribe", {
            detail: { selector: { type: "repo:handle-descriptor", url: DOC }, answer: (who, el) => ((this.answeredBy = who), (this.answeredEl = el)) },
            bubbles: true,
            composed: true,
          }),
        );
      });
    }
  }
}
if (!customElements.get("patchwork-view")) customElements.define("patchwork-view", FakeView);

// the root repo-provider: answers what nobody beneath accepted
document.addEventListener("patchwork:subscribe", (e) => {
  if (e.detail?.selector?.type === "repo:handle-descriptor") e.detail.answer("root", null);
});

const providersFor = (drafts) => [
  ...(drafts ? [{ id: STATE, docUrl: DOC }, { id: OVERLAY }] : []),
  { id: COMMENTS },
  { id: FOCUS },
];

let mounted = [];
afterEach(() => {
  for (const m of mounted) m();
  mounted = [];
});

async function scenario({ mountWhen, askWhen, drafts }) {
  world = newWorld({ mountWhen, askWhen });
  if (drafts === "from the start") world.register([STATE, OVERLAY]);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted.push(() => {
    root.unmount();
    host.remove();
  });
  const scopes = [];
  const onScope = (_leaf, el) => scopes.push(el);
  const render = (withDrafts) =>
    root.render(
      h(DocScope, { leafId: "leaf", providers: providersFor(withDrafts), onScope }, h("patchwork-view", { "doc-url": DOC })),
    );
  // the frame knows drafts are available only once they're registered
  render(drafts === "from the start");
  await sleep(5);
  if (drafts !== "from the start") {
    await sleep(drafts === "late" ? LATE_MS : 0);
    world.register([STATE, OVERLAY]);
    render(true);
  }
  // settle: well past every delay
  for (let i = 0; i < 12; i++) await sleep(LATE_MS / 2);
  const views = [...host.querySelectorAll("patchwork-view[doc-url]:not([component])")];
  return { host, views, scopes };
}

describe("DocScope", () => {
  const WHEN = ["now", "micro", "macro", "late"];
  for (const drafts of ["from the start", "soon after", "late"])
    for (const mountWhen of WHEN)
      for (const askWhen of WHEN)
        it(`drafts ${drafts}, providers mount ${mountWhen}, view asks ${askWhen}`, async () => {
          const { host, views, scopes } = await scenario({ mountWhen, askWhen, drafts });
          expect(views.length).toBe(1);
          const [view] = views;
          // nested in its own scope, innermost overlay
          const state = host.querySelector(`patchwork-view[component="${STATE}"]`);
          const overlay = view.closest(`patchwork-view[component="${OVERLAY}"]`);
          expect(state?.contains(view)).toBe(true);
          expect(overlay).not.toBeNull();
          // asked once it was in place, and the overlay answered
          expect(view.answeredBy).toBe("overlay");
          expect(view.answeredEl).toBe(overlay);
          // and the scope reported is that draft state
          expect(scopes.at(-1)).toBe(state);
        });
});
