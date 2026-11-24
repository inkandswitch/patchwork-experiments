(function (K) {
  K.renderGraph = Object.freeze({
    create: RenderGraph.create,
    effects: RenderGraph.effects,
    resources: RenderGraph.resources,
    ownerGroups: RenderGraph.ownerGroups,
    prepare: RenderGraph.prepare,
    cube: RenderGraph.cube,
    selection: RenderGraph.selection,
    history: RenderGraph.history,
    replay: RenderGraph.replay,
    feedbackMotion: RenderGraph.feedbackMotion,
    rowTable: RenderGraph.rowTable,
    layer: (node, w, h, world, time, camera, gl, sceneTime) =>
      RenderGraph.layer(
        node,
        w,
        h,
        world,
        time,
        K.poly2.text,
        camera,
        (spec, ctx) => K.annotations.anchor(spec, { ...ctx, sceneTime }),
        gl
      )
  });
})(KIT);
