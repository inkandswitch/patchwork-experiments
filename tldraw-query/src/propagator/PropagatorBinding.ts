import {
  BindingUtil,
  type BindingOnCreateOptions,
  type BindingOnDeleteOptions,
  type BindingOnShapeChangeOptions,
  type RecordProps,
  type TLBinding,
} from "@tldraw/tldraw";
import { PROPAGATOR_MEMBER_BINDING_TYPE } from "./PropagatorShape.tsx";

// ---------------------------------------------------------------------------
// Register the binding in tldraw's type system (carries no props of its own —
// membership itself is the signal).
// ---------------------------------------------------------------------------

declare module "@tldraw/tldraw" {
  export interface TLGlobalBindingPropsMap {
    [PROPAGATOR_MEMBER_BINDING_TYPE]: Record<string, never>;
  }
}

/** Binding linking a propagator (`fromId`) to one of its member shapes (`toId`). */
export type PropagatorMemberBinding = TLBinding<
  typeof PROPAGATOR_MEMBER_BINDING_TYPE
>;

export class PropagatorMemberBindingUtil extends BindingUtil<PropagatorMemberBinding> {
  static override type = PROPAGATOR_MEMBER_BINDING_TYPE;

  static override props: RecordProps<PropagatorMemberBinding> = {};

  getDefaultProps(): PropagatorMemberBinding["props"] {
    return {};
  }

  override onAfterCreate({
    binding,
  }: BindingOnCreateOptions<PropagatorMemberBinding>) {
    console.log("[propagator] member added", {
      propagator: binding.fromId,
      member: binding.toId,
    });
  }

  override onAfterChangeToShape({
    binding,
  }: BindingOnShapeChangeOptions<PropagatorMemberBinding>) {
    console.log("[propagator] member moved", {
      propagator: binding.fromId,
      member: binding.toId,
    });
  }

  override onBeforeDeleteToShape({
    binding,
  }: BindingOnDeleteOptions<PropagatorMemberBinding>) {
    console.log("[propagator] member removed (shape deleted)", {
      propagator: binding.fromId,
      member: binding.toId,
    });
  }
}
