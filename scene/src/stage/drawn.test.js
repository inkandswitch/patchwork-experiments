// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { INERT, apiOf, inertOf } from "./drawn.js";

/** Every member path of an api, nested plain objects walked: its shape. */
const shape = (o, at = "") =>
  Object.keys(o)
    .flatMap((k) => {
      const v = Object.getOwnPropertyDescriptor(o, k).value;
      return v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype ? shape(v, `${at}${k}.`) : [`${at}${k}`];
    })
    .sort();

// the acting piece a stage gives, as members (what they do doesn't matter here)
const f = () => "acted";
const ACTING = { view: { select: f }, overlay: f, popover: f, listen: f, camera: { set: f, frame: f, hold: f, ride: f }, body: { enter: f, leave: f }, hold: f, run: f };

describe("a stage's api by what it allows (drawn.js)", () => {
  it("INERT has exactly the acting members' shape: none missing, none extra", () => {
    expect(shape(INERT)).toEqual(shape(ACTING));
  });

  it("drawn or acting, the api has one shape; drawn, every acting member is its inert form and acts on nothing", () => {
    let session = "s1";
    const drawn = { id: "x", channel: { get session() {
      return session;
    } }, view: { get: () => "v" }, camera: { get: () => "c" }, body: { eye: () => null } };
    const a = apiOf(drawn, ACTING, true);
    const d = apiOf(drawn, ACTING, false);
    expect(shape(d)).toEqual(shape(a));
    expect([a.view.get(), a.view.select(), d.view.get(), d.camera.get()]).toEqual(["v", "acted", "v", "c"]);
    expect([d.view.select(), d.run({}), d.body.enter("b"), d.body.leave(), d.camera.set({}), d.camera.frame(null)]).toEqual([undefined, false, false, false, undefined, undefined]);
    for (const give of [d.popover(() => {}), d.listen(document, "keydown", () => {}), d.camera.hold(), d.camera.ride("o"), d.hold({ name: "t" }, {})]) expect(give()).toBeUndefined();
    expect([d.overlay().isConnected, d.overlay("right").className]).toEqual([false, "stage-edge-part"]);
    // getters stay getters, and nested objects are frozen
    session = "s2";
    expect([a.channel.session, d.channel.session]).toEqual(["s2", "s2"]);
    expect([Object.isFrozen(a.camera), Object.isFrozen(d), Object.isFrozen(d.body)]).toEqual([true, true, true]);
  });

  it("an acting member with no inert form can't be built into a drawn stage", () => {
    expect(() => inertOf({ ...ACTING, steer: f })).toThrow(/api\.steer acts, and has no inert form/);
    expect(() => inertOf({ ...ACTING, camera: { ...ACTING.camera, zoom: f } })).toThrow(/api\.camera\.zoom/);
    expect(() => apiOf({}, { ...ACTING, steer: f }, true)).not.toThrow();
  });
});
