(function (K) {
  K.cameraAtlas = CameraAtlas;
  K.frameComposite = Object.freeze({
    prepare: FrameComposite.prepare,
    layers: (plan, world, time, camera, gl, sceneTime) => FrameComposite.layers(plan, world, time, K.poly2.text, camera,
      (spec,ctx) => K.annotations.anchor(spec,{ ...ctx,sceneTime }), gl)
  });
})(KIT);
