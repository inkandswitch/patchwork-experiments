(function (K) {
  K.skyEnvironment = SkyEnvironment;
  K.environmentFrame = EnvironmentFrame;
  K.horizonBands = HorizonBands;
  K.artDirection = ArtDirection;
  K.stableDetail = StableDetail;
  K.celestialTracks = CelestialTracks;
  K.clouds = CloudField;
  K.reflection = {
    plane: SceneOptics.plane,
    probe: ReflectionProbes.probe,
    reflectedView: SceneOptics.reflectedView,
    captureView: SceneOptics.captureView,
    localMaterial(base, probe, options) {
      return SurfaceLook.material(base, { layers: { local: { ...options, type: 'localReflection', probe } } });
    },
    material(base, plane, options) {
      return SurfaceLook.material(base, { layers: { mirror: { ...options, type: 'planarReflection', plane } } });
    }
  };
  K.ripple = { field: RippleField.field, sampleFrame: RippleField.sampleFrame, glsl: RippleField.glsl };
  K.optical = Object.freeze({ material: OpticalMaterials.material, frame: OpticalMaterials.frame });
  K.atmosphere = {
    fog: SceneOptics.fog,
    sphere: SceneOptics.sphere,
    box: SceneOptics.box,
    shaft: SceneOptics.shaft,
    field: SceneOptics.field,
    shaped: SceneOptics.shaped,
    depthBands: Object.freeze({
      settings:AtmosphereDepthBands.settings,
      frame(bands,camera,{time=0,seed=0}={}) {
        return AtmosphereDepthBands.frame(bands,camera,time,seed,(scale,localSeed)=>
          K.procedural.fields.compile({type:'fbm',octaves:2,source:{type:'simplex',scale}},{seed:localSeed}));
      }
    }),
    cutouts: VolumeCutouts.compile,
    lighting: SceneOptics.lighting,
    occluder: SceneOptics.occluder,
    history: SceneOptics.volumeHistory,
    prepare: SceneOptics.prepareVolumes,
    trace: SceneOptics.trace
  };
})(KIT);
