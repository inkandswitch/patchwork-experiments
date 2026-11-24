const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const { render } = require('./render.js');

module.exports = function palettePlotCLI(files, options, { KIT: K, makeBuilder }, outputFile) {
  const { format = 'png', space, orbit, ortho = 'on', labels = 'on' } = options;
  const number = (key, fallback) => options[key] === undefined ? fallback :
    typeof options[key] === 'string' && options[key].trim() ? Number(options[key]) : NaN;
  if (files.length !== 1 || !['png','data'].includes(format) ||
      ![ortho,labels].every(value => value === 'on' || value === 'off' || value === true) ||
      options.out !== undefined && typeof options.out !== 'string' ||
      format === 'data' && orbit !== undefined)
    throw new TypeError('Use palette plot <plot.json> [--space rgb|oklab] [--format png|data] [--orbit degrees] [--out file]');
  const input = JSON.parse(fs.readFileSync(path.resolve(files[0]),'utf8'));
  const plot = K.palette.plot(space === undefined ? input : { ...input, space });
  if (format === 'data') {
    const json = JSON.stringify({space:plot.space,size:plot.size,axes:plot.axes,points:plot.points},null,2)+'\n';
    if (!options.out) return process.stdout.write(json);
    const file = outputFile('palette-plot.json');
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,json);
    return;
  }

  const w = number('w',320), h = number('h',280), yaw = number('yaw',Math.PI/4),
    pitch = number('pitch',Math.atan(1/Math.SQRT2)), fps = number('fps',18),
    duration = number('duration',4), sweep = number('orbit',0);
  const int = (value,lo,hi) => Number.isSafeInteger(value) && value >= lo && value <= hi;
  const count = sweep ? Math.max(2,Math.round(duration*fps)) : 1;
  if (!int(w,1,2048) || !int(h,1,2048) || !int(fps,1,120) || !(duration > 0) || !Number.isFinite(duration) ||
      !Number.isFinite(sweep) || Math.abs(sweep) > 3600 || !Number.isFinite(yaw) || !Number.isFinite(pitch) || Math.abs(pitch) > Math.PI/2 ||
      count > 240 || w*h*count > 32e6)
    throw new RangeError('Palette plot needs valid dimensions, angles in radians, orbit in degrees, and a bounded frame count');
  const source = makeBuilder(1,[0x172433]);
  const displaySize = 4;
  const axes = plot.emit(source,{scale:displaySize/plot.size});
  const look = {};
  if (labels !== 'off' && axes.length) look.composite = { layers:[{annotations:{
    style:{size:10,padding:2,background:'#172433dd',border:false},
    labels:axes.map(({label,at,color})=>({id:label,text:label,at,offset:[6,-6],style:{color}}))
  }}] };
  const world = source.finish({look,cam:{target:[0,0,0],dist:displaySize*3.4,yaw,pitch,sway:0},
    radius:displaySize*2,dither:0});
  // Preserve the isometric cube's proportions on tall or narrow canvases.
  const dist = world.cam.dist * Math.max(1,h/w);
  const file = outputFile('palette-'+plot.space+(sweep ? '-orbit' : '')+'.png');
  const intervals = sweep % 360 === 0 ? count : count - 1;
  const images = Array.from({length:count},(_,i) => render(world,{
    w,h,px:1,raw:true,ortho:ortho !== 'off',dist,yaw:yaw + sweep*Math.PI/180*i/intervals
  }));
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if (sweep) PNG.animate(file,images,fps);
  else PNG.write(file,w,h,images[0].rgb);
  console.log('wrote',file,sweep ? count+' frames' : w+'x'+h);
};
