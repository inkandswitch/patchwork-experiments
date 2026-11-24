const ArtDirection = require('../src/art-direction.js');
const SkyEnvironment = require('../src/sky-environment.js');
const AtmosphereDepthBands = require('../src/atmosphere-depth-bands.js');
const { resolveEnvironment,resolveWind,resolveLighting,atmosphereSources } = require('./environment.js');

function inspectEnvironment(world, options = {}) {
  const { at, t = world.lookSnapshot?.time ?? 0 } = options;
  if (!Array.isArray(at) || at.length !== 3 || !Array.from(at).every(Number.isFinite))
    throw new TypeError('Environment inspection needs a finite XYZ position');
  if (!Number.isFinite(t)) throw new TypeError('Environment inspection needs a finite scene time');
  const direction = ArtDirection.prepare(world.look?.artDirection,options.artDirection);
  const climate = resolveEnvironment(world,options,t,direction,true);
  const { clock,source,skyTime,time,environment,weather,binding,exposure,cutouts,origins,conditional } = climate;
  const air = resolveWind(world,options,climate);
  const { celestial,sun,clouds,flash,cloudSettings } = resolveLighting(world,options,climate,air,direction,true);
  const [x,y,z] = at;
  const trace = clock?.inspect(skyTime,options.skyProfiles);
  if (trace) trace.transitions = trace.transitions.map(row=>({ ...row,origin:origins[row.index] }));
  const value = world.pal?.[0] ?? 0;
  const background = [value>>16&255,value>>8&255,value&255].map(n=>n/255);
  const sky = SkyEnvironment.withCelestials(environment?.sky,celestial,background);
  const weatherReport = binding?.inspect(skyTime,x,z,environment?.parameters) ?? null;
  const fogVolumes = atmosphereSources(world,options).map(({id,type}) => {
    const gain = weather?.fogGain({id}) ?? 1;
    return {id:id ?? null,type,weatherDensityScale:typeof gain === 'number' ? gain : gain.sample(x,z)};
  });
  const depthBands = options.atmosphere === false ? [] : AtmosphereDepthBands.settings(
    world.atmosphereDepthBands,options.atmosphereDepthBands,world.pal);
  const airReport = air.flow?.inspect(x,y,z,skyTime);
  return {
    format:'ink-studio/environment-inspection',version:1,
    ...(world.id && {scene:world.id}),
    ...(world.environmentSource && {preset:world.environmentSource}),
    ...(world.lookSnapshot?.tick !== undefined && {tick:world.lookSnapshot.tick}),
    time:{ scene:t,motion:time,sky:skyTime },position:at.slice(),
    skySource:source === false ? 'off' : !clock ? null : options.skyEnvironment != null ? 'override' : 'scene',
    sky:trace ?? null,
    conditional:conditional ?? [],
    weather:weatherReport && {...weatherReport,surface:weather?.surface?.(x,z) ?? null},
    wind:{open:air.wind.velocity,...airReport,velocity:air.airAt(x,y,z).velocity},
    exposure:exposure?.inspect(x,y,z) ?? null,
    cutouts:cutouts?.inspect(x,y,z) ?? null,
    lighting:{
      sky:sky ? { horizon:sky.horizon,zenith:sky.zenith,ground:sky.ground,sun:sky.sun,sunColor:sky.sunColor,
        sunStrength:sky.sunStrength, splats:sky.splats.map(({id,opacity,color,gain,tint})=>({id,opacity,color,gain,tint})) } : null,
      celestial:celestial ? {primarySun:celestial.primarySun ?? null,sun:celestial.sun ?? null,tracks:celestial.tracks} : null,liveSun:sun,
      cloud:clouds ? {coverage:clouds.coverage(x,z),shadowVisibility:clouds.shadow?.(x,y,z) ?? 1,shadowSettings:cloudSettings} : null,
      lightning:flash?.light(x,y,z) ?? null
    },
    atmosphere:{
      aerial:options.atmosphere === false ? null : SkyEnvironment.aerial(world.aerialPerspective,options.aerialPerspective,environment?.parameters),
      volumes:fogVolumes,
      ...(depthBands.length && {depthBands})
    }
  };
}

module.exports = { inspectEnvironment };
