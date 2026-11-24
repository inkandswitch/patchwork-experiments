// Trace a bounded, two-surface dielectric lens into a linear RGB caustic map.
const GeometricCaustics = (() => {
  const finite = Number.isFinite, tau = 2 * Math.PI;
  const positive = (n,hi) => finite(n) && n>0 && n<=hi;
  const integer = (n,lo,hi) => Number.isSafeInteger(n) && n>=lo && n<=hi;
  const list = (p,n,valid) => Array.isArray(p) && p.length===n && Array.from(p).every(valid);
  const clamp = (n,lo=0,hi=1) => Math.max(lo,Math.min(hi,n));
  const check = (ok,message) => { if (!ok) throw new RangeError('Geometric caustic: '+message); };
  const unit = (x,y,z) => { const d=Math.hypot(x,y,z); return [x/d,y/d,z/d]; };

  function refract(ray,normal,n0,n1) {
    const [x,y,z] = ray, [a,b,c] = normal, cosine = clamp(-(x*a+y*b+z*c));
    if (!cosine) return null;
    const ratio = n0/n1, squared = 1-ratio*ratio*(1-cosine*cosine);
    if (squared<=0) return null;
    const cosineOut = Math.sqrt(squared), k = ratio*cosine-cosineOut;
    const rs = (n0*cosine-n1*cosineOut)/(n0*cosine+n1*cosineOut);
    const rp = (n1*cosine-n0*cosineOut)/(n1*cosine+n0*cosineOut);
    return {ray:[ratio*x+k*a,ratio*y+k*b,ratio*z+k*c], transmission:1-(rs*rs+rp*rp)/2};
  }

  function blurMap(data,width,height,radius) {
    if (!radius) return data;
    const scratch = new Float64Array(data.length), out = new Float64Array(data.length);
    const sigma = radius*.5, weights = Array.from({length:2*radius+1},(_,i)=>Math.exp(-.5*((i-radius)/sigma)**2));
    const total = weights.reduce((a,b)=>a+b,0);
    for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
      const at = (y*width+x)*3;
      for (let i=-radius;i<=radius;i++) {
        if (x+i<0 || x+i>=width) continue;
        const w = weights[i+radius]/total;
        for (let c=0;c<3;c++) scratch[at+c] += w*data[at+3*i+c];
      }
    }
    for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
      const at = (y*width+x)*3;
      for (let i=-radius;i<=radius;i++) {
        if (y+i<0 || y+i>=height) continue;
        const w = weights[i+radius]/total;
        for (let c=0;c<3;c++) out[at+c] += w*scratch[at+3*i*width+c];
      }
    }
    return out;
  }

  function compile({width,height,angle,focus,samples=[128,128],exposure=1,blur=2,incident='point',lens}={}) {
    check(integer(width,1,512) && integer(height,1,512) && width*height<=131072 &&
      finite(angle) && angle>=.01 && angle<90 && positive(focus,1e5) && positive(exposure,200) &&
      list(samples,2,n=>integer(n,2,512)) && samples[0]*samples[1]<=65536 && integer(blur,0,12) &&
      ['point','parallel'].includes(incident) && lens && typeof lens==='object','invalid map dimensions or projection controls');
    const {size=[1,1],distance=1,thickness=.32,sagLimit=thickness*.45,front=0,back=0,ior=1.5,
      aperture='ellipse',tint=[1,1,1],rotation=0,center=[0,0]} = lens;
    const shape = f => typeof f==='function' || finite(f) && Math.abs(f)<=sagLimit;
    const dispersion = Array.isArray(ior), indices = dispersion ? ior.slice() : [ior];
    check(list(size,2,n=>positive(n,1e3) && n>=1e-4) && positive(distance,1e4) && distance>=1e-4 &&
      positive(thickness,1e3) && thickness>=1e-4 &&
      positive(sagLimit,Math.min(distance*.9,thickness*.49999)) && focus>distance+thickness+sagLimit &&
      shape(front) && shape(back) && list(indices,dispersion ? 3 : 1,n=>finite(n) && n>=1 && n<=4) &&
      (['ellipse','rectangle'].includes(aperture) || typeof aperture==='function') &&
      list(tint,3,n=>finite(n) && n>=0 && n<=1) &&
      (typeof center==='function' || list(center,2,n=>finite(n) && Math.abs(n)<=1e4)) &&
      (typeof rotation==='function' || finite(rotation)), 'invalid lens, aperture, refractive index or focus distance');
    const [w,h] = size, [nx,ny] = samples, halfX=w/2, halfY=h/2, tx=w*1e-4, ty=h*1e-4;
    const color=tint.slice(), rest=typeof center==='function' ? center : center.slice();
    const imageH=2*focus*Math.tan(angle*Math.PI/180), imageW=imageH*width/height;
    const weight=w*h*width*height/(nx*ny*imageW*imageH), exitMin=distance+thickness-sagLimit, exitMax=distance+thickness+sagLimit;
    const isFlat=typeof back!=='function';
    function sag(profile,x,y,time) {
      const z=typeof profile==='function' ? profile(clamp(x,-halfX,halfX),clamp(y,-halfY,halfY),time) : profile;
      check(finite(z) && Math.abs(z)<=sagLimit,'surface sag is outside the declared limit');
      return z;
    }
    function normal(profile,x,y,time) {
      if (typeof profile!=='function') return [0,0,-1];
      const a=clamp(x-tx,-halfX,halfX), b=clamp(x+tx,-halfX,halfX);
      const c=clamp(y-ty,-halfY,halfY), d=clamp(y+ty,-halfY,halfY);
      return unit((sag(profile,b,y,time)-sag(profile,a,y,time))/(b-a),
        (sag(profile,x,d,time)-sag(profile,x,c,time))/(d-c),-1);
    }
    function coverage(x,y,time) {
      if (Math.abs(x)>halfX || Math.abs(y)>halfY) return 0;
      if (aperture==='rectangle') return 1;
      if (aperture==='ellipse') return Number((x/halfX)**2+(y/halfY)**2<=1);
      const n=aperture(x,y,time);
      check(finite(n) && n>=0 && n<=1,'aperture must return coverage from zero to one');
      return n;
    }

    return function bake(time) {
      const angle=typeof rotation==='function' ? rotation(time) : rotation;
      const origin=typeof rest==='function' ? rest(time) : rest;
      check(finite(time) && finite(angle) && list(origin,2,n=>finite(n) && Math.abs(n)<=1e4),'invalid lens pose');
      const cos=Math.cos(angle%tau), sin=Math.sin(angle%tau), [ox,oy]=origin;
      const px=-ox*cos-oy*sin, py=ox*sin-oy*cos;
      const data=new Float64Array(width*height*3);
      function trace(x,y,z,ray,n0,glass) {
        const entrance=refract(ray,n0,1,glass);
        if (!entrance || entrance.ray[2]<=1e-8) return null;
        const [a,b,c]=entrance.ray, ix=a/c, iy=b/c;
        let exitZ;
        if (isFlat) exitZ=distance+thickness+back;
        else {
          let lo=exitMin,hi=exitMax;
          for (let i=0;i<13;i++) {
            const mid=(lo+hi)/2, dz=mid-z;
            if (mid < distance+thickness+sag(back,x+ix*dz,y+iy*dz,time)) lo=mid;
            else hi=mid;
          }
          exitZ=(lo+hi)/2;
        }
        const u=x+ix*(exitZ-z), v=y+iy*(exitZ-z);
        if (!coverage(u,v,time)) return null;
        const exit=refract(entrance.ray,normal(back,u,v,time),glass,1);
        if (!exit || exit.ray[2]<=1e-8) return null;
        const far=(focus-exitZ)/exit.ray[2];
        return [u+far*exit.ray[0],v+far*exit.ray[1],entrance.transmission*exit.transmission];
      }
      function deposit(hit,amount,channel) {
        if (!hit) return;
        const [x,y,transmission]=hit;
        const u=(.5+(ox+x*cos-y*sin)/imageW)*width-.5;
        const v=(.5-(oy+x*sin+y*cos)/imageH)*height-.5;
        const ix=Math.floor(u), iy=Math.floor(v), du=u-ix, dv=v-iy;
        for (let j=0;j<2;j++) for (let i=0;i<2;i++) {
          const col=ix+i,row=iy+j;
          if (col<0 || col>=width || row<0 || row>=height) continue;
          const n=(row*width+col)*3, q=amount*transmission*(i ? du : 1-du)*(j ? dv : 1-dv);
          if (dispersion) data[n+channel]+=q*color[channel];
          else for (let c=0;c<3;c++) data[n+c]+=q*color[c];
        }
      }

      for (let row=0;row<ny;row++) for (let col=0;col<nx;col++) {
        const x=((col+.5)/nx-.5)*w, y=((row+.5)/ny-.5)*h, open=coverage(x,y,time);
        if (!open) continue;
        const z=distance+sag(front,x,y,time), ray=incident==='point' ? unit(x-px,y-py,z) : [0,0,1];
        const n0=normal(front,x,y,time), amount=weight*open*(incident==='point' ? ray[2]**3 : 1);
        for (let c=0;c<indices.length;c++) deposit(trace(x,y,z,ray,n0,indices[c]),amount,c);
      }
      const filtered=blurMap(data,width,height,blur);
      return Uint8Array.from(filtered,q=>Math.round(255*(-Math.expm1(-q*exposure))));
    };
  }
  return Object.freeze({compile});
})();
if (typeof module !== 'undefined') module.exports = GeometricCaustics;
