// Optional triangle surfaces. Height and attachment queries use the triangles
// that are actually drawn, while the same height sampler can feed an SDF sculpt.
const TexturedSurface = (() => {
  const vector = (v,n) => (Array.isArray(v)||ArrayBuffer.isView(v)) && v.length===n && Array.from(v).every(Number.isFinite);
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const sub = (a,b) => a.map((v,i)=>v-b[i]);
  const unit = v => {
    const length=Math.hypot(...v);
    if(length<1e-10)throw new RangeError('Surface frame must have nonzero perpendicular axes');
    return v.map(n=>n/length);
  };
  function validate(mesh) {
    const {points,uvs,triangles}=mesh||{};
    if(!points||points.length%3||!uvs||uvs.length!==points.length/3*2||!triangles||triangles.length%3||
      !Array.from(points).every(Number.isFinite)||!Array.from(uvs).every(n=>Number.isFinite(n)&&n>=0&&n<=1)||
      !Array.from(triangles).every(n=>Number.isSafeInteger(n)&&n>=0&&n<points.length/3))
      throw new RangeError('Textured surface needs finite XYZ points, normalized UVs and valid triangle indices');
    return mesh;
  }
  function grid({segments=[1,1],maxTriangles=200000,point,flip=false}) {
    if(!vector(segments,2)||!segments.every(n=>Number.isSafeInteger(n)&&n>=1)||
      !Number.isSafeInteger(maxTriangles)||maxTriangles<2||maxTriangles>2000000||
      segments[0]*segments[1]*2>maxTriangles||typeof point!=='function')
      throw new RangeError('Surface grid needs positive segments, a point function and a bounded triangle budget');
    const [nx,ny]=segments, count=(nx+1)*(ny+1);
    const points=new Float32Array(count*3),uvs=new Float32Array(count*2),triangles=new Uint32Array(nx*ny*6);
    for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
      const index=j*(nx+1)+i,u=i/nx,v=j/ny,p=point(u,v);
      if(!vector(p,3))throw new RangeError('Surface point function must return finite XYZ coordinates');
      points.set(p,index*3);uvs.set([u,v],index*2);
    }
    let offset=0;
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      const a=j*(nx+1)+i,b=a+1,c=a+nx+1,d=c+1;
      triangles.set(flip?[a,c,b,c,d,b]:[a,b,c,c,b,d],offset);offset+=6;
    }
    function locate(u,v){
      if(!Number.isFinite(u)||!Number.isFinite(v)||u<0||u>1||v<0||v>1)
        throw new RangeError('Surface coordinates must be in [0,1]');
      const x=u*nx,y=v*ny,i=Math.min(nx-1,Math.floor(x)),j=Math.min(ny-1,Math.floor(y));
      const a=j*(nx+1)+i,b=a+1,c=a+nx+1,d=c+1,s=x-i,t=y-j;
      return s+t<=1?[[a,b,c],[1-s-t,s,t]]:[[d,c,b],[s+t-1,1-s,1-t]];
    }
    function sample(u,v){
      const [ids,w]=locate(u,v),vertices=ids.map(i=>Array.from(points.subarray(i*3,i*3+3)));
      const at=[0,1,2].map(k=>vertices.reduce((sum,p,i)=>sum+p[k]*w[i],0));
      const n=cross(sub(vertices[1],vertices[0]),sub(vertices[2],vertices[0])),length=Math.hypot(...n);
      return {point:at,normal:length>1e-10?n.map(v=>(flip?-v:v)/length):[0,0,0]};
    }
    if(!points.every(Number.isFinite))throw new RangeError('Surface points exceed finite float storage');
    return {points,uvs,triangles,segments:[nx,ny],sample};
  }
  function heightfield({bounds,segments=[32,32],height,maxTriangles}={}){
    if(!vector(bounds,4)||bounds[0]>=bounds[1]||bounds[2]>=bounds[3]||
      !(typeof height==='function'||ArrayBuffer.isView(height)||Array.isArray(height)))
      throw new RangeError('Heightfield needs increasing XZ bounds and a height function or grid');
    const [x0,x1,z0,z1]=bounds;
    const supplied=typeof height!=='function';
    if(supplied&&height.length!==(segments[0]+1)*(segments[1]+1))throw new RangeError('Height grid dimensions must match segments');
    const surface=grid({segments,maxTriangles,point:(u,v)=>{
      const x=x0+(x1-x0)*u,z=z1-(z1-z0)*v;
      const y=supplied?height[Math.round(v*segments[1])*(segments[0]+1)+Math.round(u*segments[0])]:height(x,z);
      return [x,y,z];
    }});
    function sampleHeight(x,z){
      if(!Number.isFinite(x)||!Number.isFinite(z))throw new RangeError('Height query must be finite');
      const u=Math.min(1,Math.max(0,(x-x0)/(x1-x0))),v=Math.min(1,Math.max(0,(z1-z)/(z1-z0)));
      const [nx,ny]=segments,i=Math.min(nx-1,Math.floor(u*nx)),j=Math.min(ny-1,Math.floor(v*ny));
      const at=j*(nx+1)+i,s=u*nx-i,t=v*ny-j,p=surface.points;
      const a=p[at*3+1],b=p[(at+1)*3+1],c=p[(at+nx+1)*3+1],d=p[(at+nx+2)*3+1];
      return s+t<=1?a+(b-a)*s+(c-a)*t:d+(c-d)*(1-s)+(b-d)*(1-t);
    }
    return {...surface,bounds:bounds.slice(),height:sampleHeight};
  }
  function sweep({path,profile,segments=64,up=[0,1,0],frame,closed=false,maxTriangles}={}){
    if(!path||!(path.length>0)||!Number.isFinite(path.length)||typeof path.at!=='function'||
      !Array.isArray(profile)||profile.length<2||!profile.every(p=>vector(p,2))||
      !vector(up,3)||Math.hypot(...up)<1e-10||frame!==undefined&&typeof frame!=='function')
      throw new RangeError('Profile sweep needs an arc-length path, finite profile and frame or up axis');
    function axes(t){
      const d=(closed&&t===1?0:t)*path.length, f=frame?frame(d):path.at(d);
      const p=f.p,tangent=unit(f.tan),side=f.right?unit(f.right):unit(cross(up,tangent));
      const vertical=f.up?unit(f.up):unit(cross(tangent,side));
      if(!vector(p,3))throw new RangeError('Path frame needs a finite position');
      return {p,side,vertical};
    }
    const surface=grid({segments:[profile.length-1,segments],maxTriangles,flip:true,point:(u,v)=>{
      const position=u*(profile.length-1),i=Math.min(profile.length-2,Math.floor(position)),t=position-i;
      const x=profile[i][0]+(profile[i+1][0]-profile[i][0])*t;
      const y=profile[i][1]+(profile[i+1][1]-profile[i][1])*t;
      const f=axes(v);
      return f.p.map((n,k)=>n+x*f.side[k]+y*f.vertical[k]);
    }});
    return surface;
  }
  return Object.freeze({grid,heightfield,sweep,validate});
})();
if (typeof module !== 'undefined') module.exports = TexturedSurface;
