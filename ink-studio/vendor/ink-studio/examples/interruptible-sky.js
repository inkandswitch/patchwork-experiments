const coast = require('./weather-front.js');

module.exports = kit => ({
  id:'interruptible-sky',
  name:'Dusk interrupted by a squall',
  seed:96,
  build(seed) {
    const world = coast(kit).build(seed);
    const day = {
      zenith:'#3b77a6', horizon:'#e9ceab', ground:'#547c86', sunColor:'#fff1cb',
      sunAzimuth:3.02, sunAltitude:.20, sunStrength:.79, overcast:0,
      daylight:.81, rain:0, windX:.10, windZ:.04, fogDensity:.08, humidity:.43, airTemperature:14
    };
    const dusk = {
      ...day, zenith:'#655177', horizon:'#f4a077', ground:'#536179', sunColor:'#ffd19d',
      sunAzimuth:3.10, sunAltitude:.04, sunStrength:.47, daylight:.41, fogDensity:.36, humidity:.61, airTemperature:11
    };
    const storm = {
      ...dusk, zenith:'#182645', horizon:'#586081', ground:'#293e55', sunColor:'#e9c8bf',
      sunAltitude:-.13, sunStrength:0, overcast:.27, daylight:.19,
      rain:.82, windX:1.95, windZ:.44, fogDensity:1.22, humidity:.96, airTemperature:7
    };
    const skyEnvironment = kit.KIT.skyEnvironment.compile({
      profiles:{day,dusk,storm},
      sequences:{evening:{duration:9,loop:false,keys:[{at:0,profile:'day'},{at:6,profile:'dusk'}]}},
      tracks:[{id:'evening-light',sequence:'evening'}]
    }).interrupt({at:3,profile:'storm',duration:2.4});
    return { ...world, skyEnvironment,
      cam:{...world.cam,pitch:.055,target:[.1,1.55,-1.6]},
      atmosphere:world.atmosphere.map(volume=>volume.id==='front-mist' ? {...volume,density:.053,color:'#8197ac'} : volume),
      weatherBinding:{...world.weatherBinding,fronts:[]},
      transitionReview:{fps:12,neighbors:2,events:[{id:'Squall trigger',at:3}]}
    };
  }
});
