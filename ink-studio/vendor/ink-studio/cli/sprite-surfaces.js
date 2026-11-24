// Rasterize opaque, cutout atlas triangles into the existing scene compositor.
function rasterize(atlas,{V,W,H,focal,ortho,near,clip}) {
  if(!atlas)return [];
  const fragments=new Array(W*H),eye=[0,1,2].map(k=>-(V[k*4]*V[12]+V[k*4+1]*V[13]+V[k*4+2]*V[14]));
  const transform=(v)=>({p:v.slice(0,3),uv:v.slice(3),x:V[0]*v[0]+V[4]*v[1]+V[8]*v[2]+V[12],
    y:V[1]*v[0]+V[5]*v[1]+V[9]*v[2]+V[13],z:-(V[2]*v[0]+V[6]*v[1]+V[10]*v[2]+V[14])});
  const interpolate=(a,b,t)=>({p:a.p.map((n,k)=>n+(b.p[k]-n)*t),uv:a.uv.map((n,k)=>n+(b.uv[k]-n)*t),
    x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:near});
  const project=v=>({ ...v,sx:W*.5+v.x*focal/(ortho?1:v.z),sy:H*.5+v.y*focal/(ortho?1:v.z) });
  const edge=(a,b,x,y)=>(b.sx-a.sx)*(y-a.sy)-(b.sy-a.sy)*(x-a.sx);
  for (const layer of Array.isArray(atlas) ? atlas : [atlas]) {
    if (!layer) continue;
    const {vertices,pixels,width,height}=layer;
    if(!(vertices instanceof Float32Array)||vertices.length%15||!Number.isSafeInteger(width)||width<1||
      !Number.isSafeInteger(height)||height<1||!(pixels instanceof Uint8Array)||pixels.length!==width*height*4||
      !vertices.every(Number.isFinite))throw new RangeError('Invalid sprite surface atlas');
    for(let offset=0;offset<vertices.length;offset+=15){
      const input=[0,1,2].map(i=>transform(Array.from(vertices.subarray(offset+i*5,offset+i*5+5))));
      const polygon=[];
      for(let i=0;i<3;i++){
        const a=input[i],b=input[(i+1)%3];
        if(a.z>=near)polygon.push(a);
        if((a.z>=near)!==(b.z>=near))polygon.push(interpolate(a,b,(near-a.z)/(b.z-a.z)));
      }
      for(let tri=1;tri+1<polygon.length;tri++){
        const [a,b,c]=[polygon[0],polygon[tri],polygon[tri+1]].map(project),area=edge(a,b,c.sx,c.sy);
        if(Math.abs(area)<1e-10)continue;
        const loX=Math.max(0,Math.ceil(Math.min(a.sx,b.sx,c.sx)-.5)),hiX=Math.min(W-1,Math.floor(Math.max(a.sx,b.sx,c.sx)-.5));
        const loY=Math.max(0,Math.ceil(Math.min(a.sy,b.sy,c.sy)-.5)),hiY=Math.min(H-1,Math.floor(Math.max(a.sy,b.sy,c.sy)-.5));
        const u=b.p.map((n,k)=>n-a.p[k]),v=c.p.map((n,k)=>n-a.p[k]);
        const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...normal)||1;
        if(normal.reduce((sum,n,k)=>sum+n*(eye[k]-a.p[k]),0)<0)for(let k=0;k<3;k++)normal[k]=-normal[k];
        for(let y=loY;y<=hiY;y++)for(let x=loX;x<=hiX;x++){
          const weights=[edge(b,c,x+.5,y+.5)/area,edge(c,a,x+.5,y+.5)/area,edge(a,b,x+.5,y+.5)/area];
          if(weights.some(n=>n < -1e-7))continue;
          const row=[a,b,c],w=weights.map((n,k)=>ortho?n:n/row[k].z),sum=w[0]+w[1]+w[2];
          const z=ortho?weights.reduce((s,n,k)=>s+n*row[k].z,0):1/sum,p=y*W+x;
          if(fragments[p]&&z>=fragments[p].z)continue;
          const sample=k=>row.reduce((s,n,i)=>s+n.uv[k]*w[i]/sum,0);
          const tx=Math.max(0,Math.min(width-1,Math.floor(sample(0)))),ty=Math.max(0,Math.min(height-1,Math.floor(sample(1))));
          const texel=(ty*width+tx)*4;
          if(pixels[texel+3]<128)continue;
          const position=[0,1,2].map(k=>row.reduce((s,n,i)=>s+n.p[k]*w[i]/sum,0));
          if(clip&&!clip(position))continue;
          fragments[p]={p,z,alpha:1,color:Array.from(pixels.subarray(texel,texel+3),n=>n/255),position,
            normal:normal.map(n=>n/len),objectPosition:position,surface:true};
        }
      }
    }
  }
  return fragments.filter(Boolean);
}
module.exports={rasterize};
