// scene.focus: Enter (COMPOSITION.md §5, TOOLS.md §3). The focus scopes the
// selection: with the focus on a boat, selecting a card of the game linked
// on her table selects the link, as CAD selects a component before its
// parts. Entering the link moves the focus into the game: the selection,
// the halo and the inspector (its tree too) then act on the game's objects,
// in the game's frame, and the boat stays live around it (its verbs and
// carries still work; TOOLS.md Decisions 4).
//
// - "Enter" is a verb on a link (menu, inspector), everyone's in every body:
//   the selection is everyone's, so is where it is scoped. A double-click on
//   a link enters it (scene.frame's double-click frames everything else).
// - A link enters where its doc acts: a live link there, a mirror (the same
//   live doc drawn again) where it's live. A pin is a value and a closed link
//   has no stage, so neither is entered; Enter says why.
// - Leaving is the view's (stage/view.js): Escape's last rung, the trail's
//   crumbs and its Leave.

/** What Enter says about a link as the view has it ({ role, open, reason? }, api.link), or null for something that isn't one. Pure. */
export function enterState(link) {
  if (!link) return null;
  if (link.role === "acting") return link.open ? { title: "Go inside: select and edit what's in it" } : { disabled: true, title: "Not open here yet" };
  if (link.role === "mirror") return link.open ? { title: "Go inside where it's live (this is the same scene, shown again)" } : { disabled: true, title: "Not open here yet" };
  if (link.role === "pinned") return { disabled: true, title: "Fixed at a version: Follow latest to go inside" };
  return { disabled: true, title: `Not open here (${link.reason ?? "closed"})` };
}

export default {
  create(api) {
    const enter = (target) => api.view.enter(target);
    return {
      commands: [
        {
          id: "enter",
          name: "Enter",
          show: ["menu", "inspector"],
          state: (target) => (target == null ? null : enterState(api.link(target))),
          run: (target) => enter(target),
        },
      ],
      input: {
        dblclick(ev) {
          const target = ev.hit?.id ?? null;
          const can = target != null ? enterState(api.link(target)) : null;
          return can && !can.disabled ? enter(target) : false;
        },
      },
    };
  },
};
