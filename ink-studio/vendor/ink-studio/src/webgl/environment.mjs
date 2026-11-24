import { fogLimit } from './environment-shaders.mjs';
import { cameraPose } from './view.mjs';

const dataUnit = 17, cardUnit = 18, cloudLightUnit = 19, backdropUnit = 20;
const kinds = new Map([['fog',0],['box',1],['sphere',2],['shaft',3]]);
const blank = [0,0,0];
const byte = x => Math.round(255 * Math.max(0,Math.min(1,x)));
const paletteColor = hex => [hex >> 16 & 255,hex >> 8 & 255,hex & 255].map(n=>n/255);

function packVolume(volume, out, offset) {
  const type = kinds.get(volume.type);
  const first = volume.min ?? volume.at ?? volume.from ?? [0,volume.bottom ?? -1e20,0];
  const second = volume.max ?? volume.axis ?? [0,volume.top ?? 1e20,0];
  out.set([...first,type,...second,volume.height ?? 0,...volume.rgb,volume.density,
    volume.near,volume.far ?? 1e20,volume.radius ?? 0,+(!!volume.lit)],offset);
}

function packPaletteFields(fog, card, firstRow) {
  const fields = [...fog.map(volume => volume.paletteField), card?.paletteField];
  if (!fields.some(field => field?.strength)) return { rows: [], fog: false, card: -1 };
  const descriptors = new Float32Array(fields.length * 8), colors = [];
  fields.forEach((field, i) => {
    if (!field?.strength) return;
    const first = firstRow + fields.length * 2 + colors.length / 4;
    if (field.stops) {
      for (const { at, rgb } of field.stops) colors.push(...rgb, at);
    } else {
      for (let j = 0; j <= 128; j++) colors.push(...field.sampleUnit(j / 128), 0);
    }
    const source = ['depth', 'altitude', 'density', 'light'].indexOf(field.source);
    descriptors.set([field.stops ? 1 : 2, source, field.low, field.span,
      first, field.stops?.length ?? 129, field.strength, fog[i]?.step ?? 0], i * 8);
  });
  return { rows: [...descriptors, ...colors], fog: fog.some(volume => volume.paletteField),
    card: card?.paletteField?.strength ? firstRow + 2 * fog.length : -1 };
}

export function createEnvironment(gl, resources, {table, textureUnit}, maxSize, toolkit) {
  const K = toolkit.KIT;
  const state = toolkit.EnvironmentFrame ?? K?.environmentFrame;
  const skyAPI = toolkit.SkyEnvironment ?? K?.skyEnvironment;
  const celestialAPI = toolkit.CelestialTracks ?? K?.celestialTracks;
  const artAPI = toolkit.ArtDirection ?? K?.artDirection;
  const horizonAPI = toolkit.HorizonBands ?? K?.horizonBands;
  let tableData, cardTexture, cardPixels, lightingTexture, lightingPixels, backdropTexture;
  const cloudCache = new WeakMap();
  function texture(unit) {
    gl.activeTexture(gl.TEXTURE0+unit);
    return resources.texture();
  }

  function prepare(world, frame, camera, time, width, height, reflection = false) {
    if (frame.environment === false || !state || !skyAPI) return null;
    const skySource = frame.skyEnvironment ?? world.skyEnvironment;
    const cloudSource = frame.cloudField ?? world.cloudField;
    const fogSource = frame.atmosphere === false ? [] : world.atmosphere ?? [];
    const horizonSource = frame.horizonBands ?? world.look?.horizonBands;
    const celestialSource = frame.celestialTracks ?? world.celestialTracks;
    if (!skySource && !cloudSource && !fogSource.length && !horizonSource && !celestialSource) return null;
    const direction = artAPI?.prepare(world.look?.artDirection, frame.artDirection);
    const sampled = state.timeline(world,frame,time,direction,K?.weather?.tracks);
    const background = paletteColor(world.pal[0]);
    const celestial = celestialAPI?.settings(world.celestialTracks,frame.celestialTracks)?.frame(sampled.skyTime);
    const weatherSky = skyAPI.withCelestials(sampled.environment?.sky,celestial,background);
    const sky = reflection ? skyAPI.forReflection(weatherSky) : weatherSky;
    const pose = cameraPose(camera);
    const eye = pose.eye.map((n,i)=>n-camera.setback*pose.back[i]);
    let clouds, cloudView;
    const weather = state.opticalWeather(world,frame,sampled);
    if (cloudSource && K?.clouds) {
      let cloud;
      if (typeof cloudSource === 'string') cloud = K.clouds.compile(cloudSource);
      else {
        cloud = cloudCache.get(cloudSource);
        if (!cloud) {
          cloud = K.clouds.compile(cloudSource);
          cloudCache.set(cloudSource,cloud);
        }
      }
      const {windConfig,flow} = state.wind(world,frame,{...sampled,weather});
      const drift = windConfig && windConfig.clouds !== false ?
        flow.cloudTravel(0,sampled.skyTime).map(n=>n*windConfig.clouds) : undefined;
      clouds = cloud.frame(sampled.skyTime,null,celestial?.sun?.direction ?? sky?.sun,drift,
        frame.cloudRepresentation ?? world.cloudRepresentation,undefined,undefined,direction?.cloudEdge);
      cloudView = clouds.view?.(eye,camera.ortho ? pose.back : null);
    }
    const card = cloudView?.card;
    const fog = K?.atmosphere?.prepare(fogSource.filter(volume=>kinds.has(volume?.type)),world.pal,undefined,weather?.fogGain,sampled.skyTime) ?? [];
    if (fog.length > fogLimit) throw new RangeError('WebGL supports up to '+fogLimit+' analytic atmosphere volumes per frame');
    const yaw = Math.atan2(pose.back[0],pose.back[2]);
    const pitch = Math.atan2(pose.back[1],Math.hypot(pose.back[0],pose.back[2]));
    const horizonArt = horizonAPI?.prepare(world.look?.horizonBands,frame.horizonBands)?.frame({
      eye,yaw,pitch,distance:camera.distance-camera.setback,parameters:sampled.environment?.parameters
    });
    const flatCloud = clouds?.visible && !cloudView;
    if (!sky && !card && !fog.length && !horizonArt && !flatCloud) return null;
    const skyFocal = camera.ortho ? Math.tan((sky?.orthoFov ?? Math.PI/3)*.5) : camera.tangent;
    const skyView = [skyFocal*camera.aspect,skyFocal];
    const horizon = Math.max(camera.distance+2*camera.radius,card ? cloudView.horizon(pose.eye) : 0);
    const useBackdrop = !!(sky?.celestial || sky?.paletteRamp || sky?.paletteField || horizonArt || flatCloud);
    const splats = useBackdrop ? [] : sky?.splats ?? [];
    const paletteStart = 4 * (fog.length + splats.length);
    const fields = packPaletteFields(fog, card, paletteStart);
    const rows = new Float32Array(paletteStart * 4 + fields.rows.length);
    rows.set(fields.rows, paletteStart * 4);
    for (let i=0;i<fog.length;i++) packVolume(fog[i],rows,i*16);
    for (let i=0;i<splats.length;i++) {
      const layer = splats[i];
      rows.set([...layer.direction,layer.opacity,...layer.right,layer.size[0],...layer.up,layer.size[1],
        ...layer.color,0],16*(i+fog.length));
    }
    if (!tableData) {
      gl.activeTexture(gl.TEXTURE0+dataUnit);
      tableData = table(64,dataUnit,maxSize);
    }
    tableData.upload(rows);
    if (useBackdrop) {
      backdropTexture ??= texture(backdropUnit);
      const pixels = new Uint8Array(width*height*4), ray = [0,0,0], color = [0,0,0];
      const backdrop = sky && direction?.bands ? {...sky,bands:direction.bands} : sky;
      for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
        const u = (2*(x+.5)/width-1)*skyView[0], v = (2*(y+.5)/height-1)*skyView[1];
        const scale = 1/Math.hypot(u,v,1);
        for (let c=0;c<3;c++) {
          color[c] = background[c];
          ray[c] = (pose.right[c]*u+pose.up[c]*v-pose.back[c])*scale;
        }
        if (backdrop) skyAPI.shade(backdrop,ray,color);
        horizonArt?.(ray,color);
        if (flatCloud) clouds.paint(eye,ray,color);
        const p = 4*(y*width+x);
        for (let c=0;c<3;c++) pixels[p+c] = byte(color[c]);
        pixels[p+3] = 255;
      }
      textureUnit(backdropUnit,backdropTexture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    } else tableData.bind(backdropUnit);
    if (card) {
      cardTexture ??= texture(cardUnit);
      textureUnit(cardUnit,cardTexture);
      if (cardPixels !== card.pixels) {
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB32F,card.resolution,card.resolution,0,gl.RGB,gl.FLOAT,card.pixels);
        cardPixels = card.pixels;
      }
    } else tableData.bind(cardUnit);
    const light = card?.lighting;
    if (light) {
      lightingTexture ??= texture(cloudLightUnit);
      textureUnit(cloudLightUnit,lightingTexture);
      if (lightingPixels !== light.cells) {
        gl.texImage2D(gl.TEXTURE_2D,0,gl.R32F,light.width,light.rows,0,gl.RED,gl.FLOAT,light.cells);
        lightingPixels = light.cells;
      }
    } else tableData.bind(cloudLightUnit);
    return {
      media:!!(card || fog.length),lit:fog.some(v=>v.lit),
      uniforms:{
        u_envData:dataUnit,u_envCard:cardUnit,u_envCloudLight:cloudLightUnit,u_envBackdrop:backdropUnit,
        u_envEye:pose.eye,u_envRight:pose.right,u_envUp:pose.up,u_envBack:pose.back,
        u_envCamera:[camera.tangent*camera.aspect,camera.tangent,+camera.ortho,camera.setback],
        u_envSkyView:skyView,u_envHorizon:horizon,u_envBackground:background,
        u_envHasSky:+!!sky,u_envSkySplats:splats.length,u_envSkyStart:fog.length*4,u_envBackdropSampled:+useBackdrop,
        u_envZenith:sky?.zenith ?? blank,u_envSkyHorizon:sky?.horizon ?? blank,u_envGround:sky?.ground ?? blank,
        u_envSun:sky?.sun ?? blank,u_envSunRGB:sky?.sunColor ?? blank,
        u_envSunParams:[sky?.sunEdge ?? 0,sky?.sunCore ?? 1,sky?.sunStrength ?? 0],
        u_envFogCount:fog.length,u_envBands:direction?.atmosphereBands ?? 0,
        u_envPaletteFog: +fields.fog, u_envPaletteStart: paletteStart, u_envPaletteCard: fields.card,
        u_envCardSize:card?.resolution ?? 0,u_envCloudHardness:direction?.cloudHardness ?? .5,
        ...(card && {u_envCardFrame:[...card.center,card.radius],u_envCardRight:card.right,u_envCardUp:card.up,
          u_envCardNormal:card.normal,u_envCloudRGB:card.rgb,
          u_envCloudHeight:[light?.low ?? 0,light?.thickness ?? 1,card.opacity,light?.probe ?? 0]}),
        ...(light && {u_envCloudStyle:[light.ambient,light.strength,light.rim,light.daylight],
          u_envCloudDomain:[...light.origin,...light.cell],u_envCloudSun:light.direction,u_envCloudLightRGB:light.rgb})
      }
    };
  }

  return { prepare };
}
