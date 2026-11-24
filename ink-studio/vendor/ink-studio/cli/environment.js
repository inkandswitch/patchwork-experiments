const EnvironmentFrame = require('../src/environment-frame.js');
const SceneExposure = require('../src/scene-exposure.js');
const VolumeCutouts = require('../src/volume-cutouts.js');
const CelestialTracks = require('../src/celestial-tracks.js');
const CloudField = require('../src/cloud-field.js');
const Lightning = require('../src/lightning.js');
const LiveSun = require('./live-sun.js');
const SceneOptics = require('../src/scene-optics.js');
const weatherBinding = require('./weather.js');

function resolveEnvironment(world,o,sceneTime,direction,trace = false) {
  const tracks = world.weatherTracks !== undefined && world.weatherTracks !== false ?
    require('../index.js').load().KIT.weather.tracks : undefined;
  const sampled = EnvironmentFrame.timeline(world,o,sceneTime,direction,tracks,trace);
  const { source, skyTime, time, clock, environment } = sampled;
  const binding = weatherBinding(world,o,source,clock);
  const weather = binding?.frame(skyTime,environment?.parameters);
  o.shotWeather?.capture?.(binding);
  const exposure = SceneExposure.settings(world.sceneExposure,o.sceneExposure);
  const cutouts = VolumeCutouts.settings(world.volumeCutouts,o.volumeCutouts)?.frame(time);
  return { ...sampled,binding,weather,exposure,cutouts };
}

const resolveWind = EnvironmentFrame.wind;

function resolveLighting(world,o,climate,air,direction,inspect = false) {
  const {skyTime,time,environment,cutouts} = climate, {windConfig,flow} = air;
  const celestial = CelestialTracks.settings(world.celestialTracks,o.celestialTracks)?.frame(skyTime,inspect);
  const sun = LiveSun.prepare(world.liveSun,o.liveSun,time,celestial?.sun);
  const cloudSource = o.cloudField ?? world.cloudField;
  const cloudSettings = cloudSource === false ? null :
    CloudField.shadowSettings(world.cloudShadows,o.cloudShadows,environment?.parameters);
  if (cloudSettings && !cloudSource) throw new TypeError('Cloud shadows need a cloud field');
  const cloudDisplacement = cloudSource && windConfig && windConfig.clouds !== false
    ? flow.cloudTravel(0,skyTime).map(n => n*windConfig.clouds) : undefined;
  const flash = Lightning.settings(world.lightning,o.lightning)?.frame(time);
  const clouds = cloudSource ? CloudField.compile(cloudSource).frame(skyTime,cloudSettings,
    sun?.direction ?? celestial?.sun?.direction ?? environment?.sky?.sun ?? (o.volumeLighting ?? world.volumeLighting)?.sun?.direction,
    cloudDisplacement,o.cloudRepresentation ?? world.cloudRepresentation,flash?.light,cutouts?.cloud,direction?.cloudEdge) : null;
  return { celestial,sun,flash,clouds,cloudSettings };
}

function atmosphereSources(world,o) {
  return o.atmosphere === false ? [] : [
    ...(world.atmosphere || []), ...SceneOptics.shapedVolumes(world.shapedAtmosphere,o.shapedAtmosphere)
  ];
}

module.exports = { resolveEnvironment, resolveWind, resolveLighting, atmosphereSources };
