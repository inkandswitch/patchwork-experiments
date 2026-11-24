/* One sky clock and profile selection for the software and WebGL renderers. */
const EnvironmentFrame = (() => {
  const sky = typeof SkyEnvironment === 'undefined' ? require('./sky-environment.js') : SkyEnvironment;
  const art = typeof ArtDirection === 'undefined' ? require('./art-direction.js') : ArtDirection;
  const windField = typeof WindField === 'undefined' ? require('./wind-field.js') : WindField;
  const airflow = typeof Airflow === 'undefined' ? require('./airflow.js') : Airflow;

  function timeline(world, options, sceneTime, direction, tracks, trace = false) {
    const source = options.skyEnvironment ?? world.skyEnvironment;
    const skyTime = art.time(direction, options.skyTime ?? sceneTime, 'environment');
    const time = art.time(direction, sceneTime);
    let clock = source ? sky.compile(source) : null;
    const override = options.skyTransitions !== undefined;
    if (clock && override) clock = clock.withTransitions(options.skyTransitions);
    if (!clock && override && options.skyTransitions !== false && source !== false)
      throw new TypeError('Sky transitions need a sky environment');
    const origins = trace && (clock?.transitions ?? []).map(event=>({at:event.at,kind:override ? 'override' : 'sky-environment'}));
    let conditional;
    if (source !== false && options.weatherTracks !== false && world.weatherTracks !== undefined && world.weatherTracks !== false) {
      const track = tracks.compile(clock, world.weatherTracks);
      const state = world.weatherTrackState ?? track.sceneState(world.animationTimeline?.cues?.());
      const cues = track.transitions(state);
      if (cues.length) clock = clock.withTransitions([...clock.transitions,...cues]);
      if (trace) {
        conditional = state.firings.filter(({at})=>at<=skyTime);
        for (const {id,at} of state.firings) {
          const rule = world.weatherTracks.rules.find(entry=>entry.id===id);
          origins.push({at,kind:'conditional',id,trigger:rule.trigger});
        }
        origins.sort((a,b)=>a.at-b.at);
      }
    }
    return { source, skyTime, time, clock, environment:clock?.frame(skyTime,options.skyProfiles), origins, conditional };
  }

  function wind(world,o,{weather,exposure,skyTime}) {
    const windConfig = windField.settings(world.windField,o.windField);
    const fallbackWind = o.wind ?? weather?.wind ?? windConfig?.fallback ?? world.anim?.wind ?? (windConfig && world.volumeWind) ?? undefined;
    const weatherWindAt = o.wind == null ? weather?.windAt : undefined;
    const weatherWindHere = o.wind == null ? weather?.windHere : undefined;
    const flow = (windConfig || exposure?.wind) && windField.create(windConfig ?? windField.settings(true),{
      ambient: time => weatherWindAt?.(time) ?? fallbackWind,
      local:weatherWindHere,
      gust:windConfig ? weather?.gustAt : undefined, localGust:windConfig ? weather?.gustHere : undefined, exposure
    });
    const wind = airflow.frame(flow ? flow.open(skyTime) : fallbackWind);
    const localWind = flow && (windConfig?.cover || weatherWindHere || (windConfig && weather?.gustHere) || exposure?.wind)
      ? (time,x,z,_fallback,y=0) => flow.sample(x,y,z,time) : weatherWindHere;
    const windAt = flow ? flow.open : weatherWindAt;
    let lastAirTime = skyTime, timedAir = wind;
    const airAt = (x,y,z,time=skyTime) => {
      if (time !== lastAirTime) {
        lastAirTime = time;
        timedAir = time === skyTime ? wind : airflow.frame(windAt?.(time) ?? wind.velocity);
      }
      return localWind ? airflow.frame(localWind(time,x,z,timedAir.velocity,y)) : timedAir;
    };
    return { windConfig,flow,wind,localWind,airAt,windAt };
  }

  function opticalWeather(world, options, sampled, frontsEnabled = false) {
    if (!sampled.clock) return;
    const api = typeof WeatherBinding === 'undefined' ? require('./weather-binding.js') : WeatherBinding;
    const config = api.settings(world.weatherBinding, options.weatherBinding);
    if (!config) return;
    config.surface = undefined;
    return api.bind(sampled.clock, config, { profiles:options.skyProfiles, frontsEnabled })
      .frame(sampled.skyTime,sampled.environment?.parameters);
  }

  return Object.freeze({ timeline, wind, opticalWeather });
})();
if (typeof module !== 'undefined') module.exports = EnvironmentFrame;
