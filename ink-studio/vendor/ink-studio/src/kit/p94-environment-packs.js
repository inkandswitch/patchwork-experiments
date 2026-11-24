/* Versioned environment presets bind portable optical settings to a scene. */
(function (K) {
  const A = K.authoring, { clone, freeze, merge } = A.data;
  const key = /^[a-z][a-z0-9-]{0,47}\/[a-z][a-z0-9-]{0,47}$/;
  const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const fields = [
    'skyEnvironment','skyReflections','aerialPerspective','celestialTracks','cloudField','cloudShadows','cloudRepresentation',
    'weatherBinding','weatherTracks','windField','lightning','sceneExposure','precipitation','rainImpacts','liveSun',
    'atmosphere','shapedAtmosphere','atmosphereDepthBands','volumeCutouts','volumeLighting','volumeQuality','splatFields','atmosphereEmitters'
  ];
  const lookFields = ['horizonBands','effectPalettes','artDirection','stable','silhouetteProtection',
    'surfaceLightRamps','colorCurves','shadowArt','ink','contactShadows','edgeFilter'];
  const parts = (value, allowed) => Object.fromEntries(allowed.filter(name => value?.[name] !== undefined).map(name => [name,value[name]]));
  const claims = (value, allowed) => object(value) && Object.keys(value).every(name => allowed.includes(name));
  const namespaced = (value, pack) => typeof value === 'string' && key.test(value) && (pack === undefined || value.startsWith(pack+'/'));
  const revision = value => value === undefined || Number.isSafeInteger(value) && value > 0;
  const fallbackPalette = new Array(256).fill(0);

  function settings(source) {
    if (!claims(source,[...fields,'look']) || source.look !== undefined && !claims(source.look,lookFields))
      throw new TypeError('Environment settings must use the portable environment or look fields');
    return source;
  }
  function definition(value, pack) {
    if (!claims(value,['id','label','settings']) || !namespaced(value.id,pack) ||
        typeof value.label !== 'string' || !value.label.trim() || value.label.length > 100)
      throw new TypeError('An environment needs a namespaced ID, label and settings');
    const authored = settings(value.settings);
    if (!Object.keys(authored).length) throw new TypeError('Environment settings cannot be empty');
    references(authored);
    return freeze({ id:value.id, label:value.label.trim(), settings:authored });
  }
  function image(value, pack) {
    if (!claims(value,['id','width','height','pixels']) || !namespaced(value.id,pack))
      throw new TypeError('An environment image needs a namespaced ID and RGBA data');
    const { id, width, height, pixels } = value;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        width * height > 1048576 || !Array.isArray(pixels) || pixels.length !== width*height*4 ||
        pixels.some(n => !Number.isInteger(n) || n < 0 || n > 255))
      throw new RangeError('Invalid environment image dimensions or RGBA bytes: '+id);
    return freeze({ id, width, height, pixels });
  }
  function imageReference(value) {
    if (!value || !Object.hasOwn(value,'asset')) return null;
    if (!claims(value,['asset','revision']) || !namespaced(value.asset) || !revision(value.revision))
      throw new TypeError('An environment image reference needs an asset ID and optional positive pack revision');
    return value;
  }
  function references(source) {
    const bands = source.look?.horizonBands?.bands;
    return Array.isArray(bands) ? bands.map(band => imageReference(band?.image)).filter(Boolean) : [];
  }
  function requireImage(catalog, ref) {
    const entry = catalog?.getEnvironmentImage(ref.asset);
    if (!entry) throw new Error('Unknown environment image: '+ref.asset);
    if (ref.revision !== undefined && entry.revision !== ref.revision)
      throw new Error('Environment image '+ref.asset+' requires pack revision '+ref.revision+', installed '+entry.revision);
    return entry;
  }
  function resolveImages(source, catalog) {
    if (!references(source).length) return { source, images:[] };
    const look = source.look, horizon = look.horizonBands, used = new Map();
    const bands = horizon.bands.map(band => {
      const ref = imageReference(band?.image);
      if (!ref) return band;
      const { image, pack, revision } = requireImage(catalog,ref);
      used.set(image.id,{ id:image.id, pack, revision });
      return { ...band, image:{ width:image.width, height:image.height, pixels:image.pixels } };
    });
    return { source:{ ...source, look:{ ...look, horizonBands:{ ...horizon, bands } } }, images:[...used.values()] };
  }
  function validate(source, palette = fallbackPalette) {
    const { skyEnvironment, weatherBinding, skyReflections, aerialPerspective, celestialTracks, lightning,
      windField, cloudField, cloudRepresentation, cloudShadows, sceneExposure, atmosphere, shapedAtmosphere, volumeCutouts,
      splatFields, atmosphereEmitters, look } = source;
    const sky = skyEnvironment === undefined || skyEnvironment === false ? null : SkyEnvironment.compile(skyEnvironment);
    K.weather.tracks.compile(skyEnvironment === false ? false : sky,source.weatherTracks);
    const weather = WeatherBinding.settings(weatherBinding);
    if (weather && skyEnvironment !== false) {
      WeatherBinding.bind(sky,weather);
      if (weather.surface) K.procedural.motion.surfaceWeather(weather.surface.options);
    }
    if (skyReflections !== undefined && !['scene','material'].includes(skyReflections))
      throw new TypeError('Sky reflections must be scene or material');
    SkyEnvironment.aerial(aerialPerspective);
    CelestialTracks.settings(celestialTracks);
    Lightning.settings(lightning);
    WindField.settings(windField);
    SceneExposure.settings(sceneExposure);
    if (cloudField !== undefined && cloudField !== false) CloudField.compile(cloudField);
    if (cloudField !== false && CloudField.shadowSettings(cloudShadows) && cloudField === undefined)
      throw new TypeError('Cloud shadows need a cloud field');
    if (cloudRepresentation !== undefined && !CloudField.representations.includes(cloudRepresentation))
      throw new TypeError('Invalid cloud representation');
    if (atmosphere !== undefined && atmosphere !== false) SceneOptics.prepareVolumes(atmosphere,palette);
    SceneOptics.shapedVolumes(shapedAtmosphere);
    AtmosphereDepthBands.settings(source.atmosphereDepthBands,undefined,palette);
    VolumeCutouts.settings(volumeCutouts);
    K.splatFields.settings(splatFields);
    K.atmosphere.emitters.settings(atmosphereEmitters);
    HorizonBands.compile(look?.horizonBands);
    ArtDirection.prepare(look?.artDirection);
    ArtStability.prepare(look?.stable);
    EffectPalettes.prepare(look?.effectPalettes,palette,undefined,{deferRoles:true});
    SilhouetteProtection.prepare(look?.silhouetteProtection);
    SurfaceLook.lightRamps(look?.surfaceLightRamps);
    ColorCurves.prepare(look?.colorCurves);
    ShadowArt.prepare(look?.shadowArt);
    ArtInk.prepare(look?.ink,palette);
    ContactShadows.prepare(look?.contactShadows);
    EdgeFilter.prepare(look?.edgeFilter);
  }

  function resolveBinding(binding, catalog) {
    if (binding === undefined || binding === false) return null;
    const value = typeof binding === 'string' ? { asset:binding } : binding;
    if (!claims(value,['asset','revision','overrides']) || !namespaced(value.asset) || !revision(value.revision))
      throw new TypeError('An environment binding needs an asset ID and optional positive pack revision');
    const entry = catalog?.getEnvironment(value.asset);
    if (!entry) throw new Error('Unknown environment preset: '+value.asset);
    const { environment, pack, revision:installed } = entry;
    if (value.revision !== undefined && value.revision !== installed)
      throw new Error('Environment preset '+value.asset+' requires pack revision '+value.revision+', installed '+installed);
    const authored = value.overrides === undefined ? environment.settings : merge(environment.settings,settings(value.overrides));
    return { id:environment.id, pack, revision:installed, settings:authored };
  }

  function bind(binding, catalog) {
    const bound = resolveBinding(binding,catalog);
    if (!bound) return null;
    const { source, images } = resolveImages(bound.settings,catalog);
    validate(source);
    return freeze({ ...bound, settings:source, images });
  }

  function apply(target, binding, catalog, palette) {
    const bound = resolveBinding(binding,catalog);
    if (!bound) return target;
    const { settings:base, ...identity } = bound;
    const look = target.look === false ? false : { ...base.look, ...target.look };
    const { source, images } = resolveImages({ ...base, ...parts(target,fields), look },catalog);
    validate(source,palette);
    return { ...target, ...source, environmentSource:freeze({ ...identity, images }) };
  }
  A.environments = Object.freeze({ definition, image, references, requireImage, bind, apply,
    rendererSettings: source => parts(source,fields) });
})(KIT);
