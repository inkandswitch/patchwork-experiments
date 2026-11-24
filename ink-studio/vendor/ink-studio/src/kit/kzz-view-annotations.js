(function (K) {
  function anchor(spec, { world, time, sceneTime }) {
    let point;
    if (spec.entity !== undefined) {
      point = world?.lookSnapshot?.query?.frame({ entity: spec.entity, socket: spec.socket })?.point;
    } else if (spec.mark !== undefined) {
      const mark = world?.dataMarks?.get(spec.mark);
      if (mark?.status === 'visible') point = mark.channels.position;
    } else if (typeof spec.part === 'string') {
      const rig = world?.lab?.rig ?? world?.anim?.rig;
      if (rig?.at && rig.has(spec.part)) point = rig.at(spec.part,spec.point ?? [0,0,0]);
    } else if (world) point = K.inspection.anchor(spec,{ world,time,sceneTime })?.at;
    return point && (spec.offset ? K.V.add(point,spec.offset) : point);
  }
  K.annotations = Object.freeze({
    prepare: ViewAnnotations.prepare, anchor,
    layout: (settings,context) => ViewAnnotations.layout(settings,{ glyphs:K.poly2.text,resolve:anchor,...context })
  });
})(KIT);
