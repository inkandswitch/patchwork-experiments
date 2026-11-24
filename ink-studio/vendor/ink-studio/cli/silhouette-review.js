const { render, grid, label, upscale } = require('./render.js');
const { exportViews } = require('./sprite-atlas.js');
const SilhouetteProtection = require('../src/silhouette-protection.js');
const luma = (rgb, p) => (.30*rgb[p*3]+.55*rgb[p*3+1]+.15*rgb[p*3+2])/255;
const degree = angle => Math.round(angle*180/Math.PI);
const integer = (n, min, max) => Number.isInteger(n) && n>=min && n<=max;

function measure(before, after, targets) {
  const {w,h,silhouetteMask}=after;
  const rows=targets.map(({id,select})=>({id,select,pixels:0,touchesBorder:false,edgeSamples:0,before:0,protected:0}));
  for (let p=0;p<w*h;p++) {
    const row=rows[(silhouetteMask?.[p]??0)-1];
    if (!row) continue;
    row.pixels++;
    const x=p%w, y=Math.floor(p/w);
    row.touchesBorder ||= x===0 || y===0 || x===w-1 || y===h-1;
    const near=[x>0?p-1:-1,x+1<w?p+1:-1,y>0?p-w:-1,y+1<h?p+w:-1];
    for (const q of near) {
      if (q<0 || silhouetteMask[q]) continue;
      row.edgeSamples++;
      row.before+=Math.abs(luma(before.rgb,p)-luma(before.rgb,q));
      row.protected+=Math.abs(luma(after.rgb,p)-luma(after.rgb,q));
    }
  }
  for (const row of rows) {
    row.before=row.edgeSamples ? +(row.before/row.edgeSamples).toFixed(4) : null;
    row.protected=row.edgeSamples ? +(row.protected/row.edgeSamples).toFixed(4) : null;
  }
  return rows;
}

function silhouetteReview(world,{ width=96, height=96, directions=8, pitches, yaw=world.cam.yaw, pivot=world.cam.target,
  time=0, view={}, columns=4, scale=1 }={}) {
  const protection=SilhouetteProtection.prepare(world.look?.silhouetteProtection,view.silhouetteProtection);
  if (!protection) throw new TypeError('Silhouette review needs at least one enabled protection target');
  const angles=exportViews(world,{directions,yaw,pitch:view.pitch,pitches});
  if (!integer(width,1,2048)||!integer(height,1,2048)||!integer(columns,1,64)||!integer(scale,1,8)||
      !Number.isFinite(time)|| !Array.isArray(pivot)||pivot.length!==3||!Array.from(pivot).every(Number.isFinite)||
      2*(width+3)*(height+15)*angles.length*scale*scale>32e6)
    throw new RangeError('Invalid silhouette review dimensions, pivot, time or pixel budget');
  const frames=[], rows=[];
  for (const angle of angles) {
    const settings={...view,t:time,w:width,h:height,px:1,ortho:true,transparent:false,target:pivot,yaw:angle.yaw,pitch:angle.pitch};
    const before=render(world,{...settings,silhouetteProtection:false,captureSilhouetteProtection:false});
    const after=render(world,{...settings,captureSilhouetteProtection:true});
    const pair={w:width*2+3,h:height+15,rgb:new Uint8Array((width*2+3)*(height+15)*3)};
    label(pair,4,4,'y'+((degree(angle.yaw)%360+360)%360)+'  t'+degree(angle.pitch),1);
    for(let y=0;y<height;y++) {
      const offset=(y+15)*pair.w*3;
      pair.rgb.set(before.rgb.subarray(y*width*3,(y+1)*width*3),offset);
      pair.rgb.set(after.rgb.subarray(y*width*3,(y+1)*width*3),offset+(width+3)*3);
    }
    frames.push(pair);
    rows.push({...angle,targets:measure(before,after,protection.targets)});
  }
  const sheet=grid(frames,Math.min(columns,frames.length));
  return { image:scale===1 ? sheet : upscale(sheet,scale), report:{width,height,directions,time,
    layout:'baseline left, protected right',views:rows} };
}

module.exports = { silhouetteReview };
