const WeatherBinding = require('../src/weather-binding.js');

const sessions = new WeakMap();
function weatherBinding(world, options, source, environment) {
  const authored = world.weatherBinding, override = options.weatherBinding;
  if (override === false || source === false || (override === undefined && (authored === undefined || authored === false))) return null;
  const pins = JSON.stringify(Object.entries(options.skyProfiles ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  const track = typeof source?.sample === 'function' ? source : JSON.stringify(source);
  const transitions = JSON.stringify(environment?.transitions);
  const retained = options.retainedWeather !== false;
  const frontsEnabled = options.weatherFronts !== false;
  let cached = sessions.get(world);
  if (!cached || cached.authored !== authored || cached.override !== override || cached.track !== track || cached.transitions !== transitions || cached.pins !== pins || cached.retained !== retained || cached.frontsEnabled !== frontsEnabled) {
    const config = WeatherBinding.settings(authored, override);
    if (config && !retained) config.surface = undefined;
    const binding = WeatherBinding.bind(environment, config, {
      profiles: options.skyProfiles, frontsEnabled,
      createSurface: settings => require('../index.js').load().KIT.procedural.motion.surfaceWeather(settings)
    });
    options.shotWeather?.restore?.(binding);
    cached = { authored, override, track, transitions, pins, retained, frontsEnabled, binding };
    sessions.set(world, cached);
  }
  return cached.binding;
}
module.exports = weatherBinding;
