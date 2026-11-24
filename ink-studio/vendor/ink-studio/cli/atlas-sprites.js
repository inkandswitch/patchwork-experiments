const Atlas = require('../src/atlas-sprites.js');
const { dot,basis,vector }=Atlas;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const combine=(axes,v)=>axes.right.map((n,i)=>n*v[0]+axes.up[i]*v[1]+axes.normal[i]*v[2]);
const local=(axes,v)=>[dot(v,axes.right),dot(v,axes.up),dot(v,axes.normal)];
function unit(v) {
  const length=Math.hypot(...v);
  return length>1e-6 ? v.map(n=>n/length) : undefined;
}
function heading(v) {
  return [Math.atan2(v[0],v[2]),Math.atan2(v[1],Math.hypot(v[0],v[2]))];
}

function rasterize(placements, settings) {
  if (!placements.length) return [];
  const {eye,V,W,H,focal,ortho,near,rayAt,time,override,sun,visibility,clip,objectDither,subject}=settings;
  if (override!==undefined&&!['card','impostor','scenery'].includes(override))
    throw new RangeError('Sprite atlas mode must be card, impostor or scenery');
  const results=[];
  const viewForward=[V[2],V[6],V[10]];
  const project=point=>{
    const [x,y,z]=point;
    const depth=-(V[2]*x+V[6]*y+V[10]*z+V[14]);
    const scale=ortho?focal:focal/depth;
    return [W*.5+scale*(V[0]*x+V[4]*y+V[8]*z+V[12]),
      H*.5+scale*(V[1]*x+V[5]*y+V[9]*z+V[13]),depth];
  };
  const effectColor=[0,0,0];
  function fragmentAt(ray, hit) {
    const z=hit*ray.axial;
    if (z<near) return null;
    const position=ray.origin.map((n,i)=>n+hit*ray.direction[i]);
    return clip&&!clip(position)?null:{z,position};
  }
  const sample={ color:[0,0,0],normal:[0,0,0],emission:[0,0,0] };
  for (const placement of placements) {
    const {atlas,opacity}=placement, mode=override??placement.mode;
    const protection=subject?.({object:placement.objectId,entity:placement.objectId,material:placement.materialId});
    if (!opacity) continue;
    const at=typeof placement.at==='function'?vector(placement.at(time),'Sprite atlas anchor'):placement.at;
    const fixed=mode==='scenery';
    if (fixed&&!atlas.sceneryPlanes) throw new TypeError('Scenery mode needs a painted scenery atlas');
    const direction=ortho?viewForward:unit(eye.map((n,i)=>n-at[i]));
    if (!direction||(!fixed&&project(at)[2]<near)) continue;
    const rotation=basis(placement.yaw,0);
    const frame=typeof placement.frame==='function'?placement.frame(time):placement.frame??placement.frameAt?.(time);
    const tile=atlas.select(frame,mode,local(rotation,direction));
    const effect=atlas.effect?.(tile);
    const normalAxes=basis(tile.yaw+placement.yaw,tile.pitch);
    const axes=fixed?normalAxes:basis(...heading(direction));
    const units=tile.unitsPerPixel*placement.scale;
    const {x:tileX,y:tileY,width,height}=tile.rect, px=tile.pivot.x,py=tile.pivot.y;
    const planes=fixed&&placement.depth?atlas.sceneryPlanes:[{depth:0}];
    for (const {id,depth,bounds} of planes) {
      const anchor=depth?at.map((n,i)=>n-depth*placement.scale*axes.normal[i]):at;
      const u0=bounds?Math.max(0,bounds[0]-tileX):0, u1=bounds?Math.min(width,bounds[2]-tileX):width;
      const v0=bounds?Math.max(0,bounds[1]-tileY):0, v1=bounds?Math.min(height,bounds[3]-tileY):height;
      if (u1<=u0||v1<=v0) continue;
      const corners=[];
      for (const y of [py-v1,py-v0]) for (const x of [u0-px,u1-px])
        corners.push(project(anchor.map((n,i)=>n+units*(x*axes.right[i]+y*axes.up[i]))));
      if (fixed&&corners.every(c=>c[2]<near)) continue;
      const clipped=corners.some(c=>c[2]<near);
      const left=clipped?0:clamp(Math.floor(Math.min(...corners.map(c=>c[0]))),0,W);
      const right=clipped?W:clamp(Math.ceil(Math.max(...corners.map(c=>c[0]))),0,W);
      const bottom=clipped?0:clamp(Math.floor(Math.min(...corners.map(c=>c[1]))),0,H);
      const top=clipped?H:clamp(Math.ceil(Math.max(...corners.map(c=>c[1]))),0,H);
      for (let y=bottom;y<top;y++) for (let x=left;x<right;x++) {
        const ray=rayAt(x+.5,y+.5), facing=-dot(ray.direction,axes.normal);
        if (facing<=1e-7) continue;
        const origin=ray.origin.map((n,i)=>n-anchor[i]), plane=dot(origin,axes.normal)/facing;
        const uAt=px+(dot(origin,axes.right)+plane*dot(ray.direction,axes.right))/units;
        const vAt=py-(dot(origin,axes.up)+plane*dot(ray.direction,axes.up))/units;
        const u=Math.floor(uAt), v=Math.floor(vAt);
        if (u<u0||u>=u1||v<v0||v>=v1) continue;
        const p=y*W+x;
        if (atlas.sample(tile,u,v,placement,sample,id)) {
          const hit=fragmentAt(ray,fixed?plane:plane+placement.scale*sample.depth/facing);
          if (hit) {
            const {position}=hit;
            let normal;
            if (sample.hasNormal) {
              if (mode==='card') {
                const inView=atlas.normalSpace==='view'?sample.normal:local(tile.basis,sample.normal);
                normal=unit(combine(axes,inView));
              } else normal=unit(combine(atlas.normalSpace==='view'?normalAxes:rotation,sample.normal));
            }
            const gain=sun&&normal&&placement.lighting ?
              sun.ambient+sun.intensity*Math.max(0,dot(normal,sun.direction))*(visibility?.(position,normal)??1) : 1;
            const emission=sample.hasEmission?sample.emission.slice():null;
            const color=sample.color.map((value,c)=>{
              const glow=emission?.[c]??0;
              if (atlas.emissionMode==='add') return clamp(value*gain+glow,0,1);
              return gain===1 ? value : clamp(Math.max(0,value-glow)*gain+glow,0,1);
            });
            results.push({p,...hit,alpha:sample.alpha*opacity,color,normal,emission,protection,
              objectPosition:local(rotation,position.map((n,i)=>(n-at[i])/placement.scale)), objectScale:placement.scale,
              ...(objectDither && mode==='card' && { patternPosition:[(uAt-px)*tile.unitsPerPixel,(py-vAt)*tile.unitsPerPixel,0] })});
          }
        }
        const alpha=effect?.sample(u,v,effectColor);
        if (alpha) {
          const hit=fragmentAt(ray,plane+(placement.depth?placement.scale*effect.depth/facing:0));
          if (hit) results.push({p,...hit,alpha:alpha*opacity,color:effectColor.slice(),protection,effect:true});
        }
      }
    }
  }
  return results.sort((a,b)=>b.z-a.z);
}
module.exports = { rasterize };
