const PNG = require('./png.js');
const FrameComposite = require('../src/frame-composite.js');

function read(source) {
  return typeof source==='string' || Buffer.isBuffer(source) ? PNG.raster(source) : source;
}

function previewRaster(source, maxWidth, maxHeight) {
  const width=source.w ?? source.width, height=source.h ?? source.height;
  const data=source.data ?? source.rgba ?? source.rgb, stride=data.length/(width*height);
  const separateAlpha=data===source.rgb ? source.alpha : undefined;
  const max=source.max ?? (data instanceof Uint16Array ? 65535 : 255);
  const ratio=Math.min(maxWidth/width,maxHeight/height);
  const w=Math.max(1,Math.round(width*ratio)), h=Math.max(1,Math.round(height*ratio));
  const rgba=new Uint8Array(w*h*4);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const p=Math.floor((y+.5)*height/h)*width+Math.floor((x+.5)*width/w), to=(y*w+x)*4;
    for (let c=0;c<3;c++) rgba[to+c]=Math.round(data[p*stride+c]*255/max);
    const a=stride===4 ? data[p*stride+3] : separateAlpha?.[p] ?? max;
    rgba[to+3]=Math.round(a*255/max);
  }
  return {w,h,rgba};
}

const margin=24, gap=24, w=1040, h=789, panel=(w-2*margin-gap)/2;
const photo={y:93,height:225};
const ink='#e3e9f1', chill='#a8b8c9', divider='#344151', paper='#1a2432';
const percent=n=>(n*100).toFixed(1)+' pct';

function sheet(reference, studio, report, kit) {
  const text=[], panels=[], images=[];
  const rect=(draw,x,y,width,height,color)=>draw.push({type:'rect',rect:[x,y,width,height],color});
  const label=(value,x,y,size,color=ink)=>text.push({type:'text',text:value,at:[x,y],size,color});
  const keys=['brightness','hue','saturation'];
  const chartLabels=['Brightness / OKLab L','Hue families','Saturation / HSV'];
  const peaks=keys.map(key=>Math.max(.01,...report.reference[key].map(row=>row.share),...report.studio[key].map(row=>row.share)));
  label('Palette distributions',w/2,43,23);
  for (const [i,[title,image,stats]] of [
    ['Reference',reference,report.reference],['Studio render',studio,report.studio]
  ].entries()) {
    const x=margin+i*(panel+gap), inside=x+14, width=panel-28, center=x+panel/2;
    rect(panels,x,54,panel,720,paper);
    rect(panels,inside,photo.y,width,photo.height,'#111925');
    label(title+' / '+stats.width+' x '+stats.height,center,79,14);
    const raster=previewRaster(image,width,photo.height);
    images.push({source:raster,rect:[inside+Math.floor((width-raster.w)/2),
      photo.y+Math.floor((photo.height-raster.h)/2),raster.w,raster.h]});
    for (const [index,key] of keys.entries()) {
      const base=405+index*88, rows=stats[key], peak=peaks[index], stride=width/rows.length;
      label(chartLabels[index]+' / '+percent(peak)+' top',center,base-53,12);
      rect(text,inside,base,width,1,divider);
      for (const [j,row] of rows.entries()) {
        const color=key==='hue' ? row.swatch : key==='saturation' ? '#62b9a7' : '#8ca8df';
        const bar=Math.round(row.share/peak*38);
        if (bar) rect(text,inside+j*stride+1,base-bar,stride-2,bar,color);
        if (key==='hue') label(row.family.slice(0,3),inside+(j+.5)*stride,base+15,9,chill);
      }
      if (key!=='hue') {
        label(key==='brightness' ? 'Dark' : 'Muted',inside+19,base+15,9,chill);
        label(key==='brightness' ? 'Light' : 'Vivid',inside+width-19,base+15,9,chill);
      }
    }
    for (const [j,[role,row]] of Object.entries(stats.tones).entries()) {
      const y=623+j*42, dominant=row.families[0]?.family ?? 'empty';
      label(role[0].toUpperCase()+role.slice(1)+' / '+percent(row.share)+' of image / '+dominant,center,y,11);
      rect(text,inside,y+7,width,10,divider);
      let at=inside;
      for (const family of row.families) {
        const size=family.share*width;
        rect(text,at,y+7,size,10,family.swatch);
        at+=size;
      }
    }
  }
  const plan=kit.frameComposite.prepare({layers:[{draw:panels},...images,{draw:text}]},w,h,1);
  return FrameComposite.compose({w:1,h:1,rgb:Uint8Array.of(17,25,36)},
    kit.frameComposite.layers(plan,{},0),w,h,'nearest');
}

function comparePaletteDistributions(reference, studio, options) {
  const source=read(reference), result=read(studio);
  if (![source,result].every(image=>image?.data || image?.rgba || image?.rgb))
    throw new TypeError('A distribution comparison preview needs decoded RGB or RGBA pixels');
  const { KIT }=require('../index.js').load();
  const report=KIT.palette.compareDistributions(source,result,options);
  const image=sheet(source,result,report,KIT);
  return { report, image };
}

module.exports = { comparePaletteDistributions };
