import { layerSamplingGLSL } from './frame-composite.mjs';

const shared = `
precision highp float;
precision highp int;
uniform sampler2D u_input, u_mask, u_owner, u_selected, u_depth, u_groups, u_work;
uniform vec2 u_size, u_workSize, u_depthRange;
uniform bool u_packedDepth, u_hasMask, u_hasSelect, u_hasDepth, u_hasGroups, u_depthMask, u_depthInvert, u_background, u_protect, u_sourceMask, u_outputMask, u_linear;
uniform vec3 u_depthWindow, u_tint;
uniform int u_kind, u_samples, u_side, u_span;
uniform float u_depthThreshold, u_opacity, u_radius, u_threshold, u_intensity, u_inner, u_width, u_relativeDepth;
uniform vec2 u_offset, u_center, u_blockSize, u_sortThreshold;
uniform float u_radial, u_probability;
uniform uint u_seed, u_tick;
uniform bool u_horizontal, u_descending;
${layerSamplingGLSL}
vec4 readAt(vec2 p){return layerAt(u_input,p,u_size,false,false);}
bool inside(vec2 p){return all(greaterThanEqual(p,vec2(0.0)))&&all(lessThan(p,u_size));}
float zAt(vec2 p){
  if(!u_hasDepth)return 1e20;
  vec4 value=layerAt(u_depth,p,u_size,false,false);
  float n=u_packedDepth?(value.a<.5?1.0:dot(round(value.rgb*255.0),vec3(1.0,256.0,65536.0))/16777215.0):value.r;
  return n>=1.0?1e20:mix(u_depthRange.x,u_depthRange.y,n);
}
int ownerAt(vec2 p){
  ivec3 bytes=ivec3(floor(layerAt(u_owner,p,u_size,false,false).rgb*255.0+.5));
  return bytes.r+bytes.g*256+bytes.b*65536;
}
vec4 groupAt(vec2 p){
  if(!u_hasGroups)return vec4(0.0);
  int id=ownerAt(p),width=textureSize(u_groups,0).x;
  return texelFetch(u_groups,ivec2(id%width,id/width),0);
}
float weightAt(vec2 p){
  float weight=u_hasMask?layerAt(u_mask,p,u_size,false,false).r:1.0;
  if(u_hasSelect){int id=ownerAt(p),width=textureSize(u_selected,0).x;weight*=texelFetch(u_selected,ivec2(id%width,id/width),0).r;}
  if(u_depthMask){
    float z=zAt(p),edge=min(z-u_depthWindow.x,u_depthWindow.y-z);
    float a=u_depthWindow.z>0.0?clamp(edge/u_depthWindow.z,0.0,1.0):step(0.0,edge);
    weight*=z>1e19?(u_background?1.0:0.0):(u_depthInvert?1.0-a:a);
  }
  return weight;
}
bool compatible(vec2 p,vec2 q,bool emission){
  if(!inside(q))return false;
  float a=zAt(p),b=zAt(q);bool skyA=a>1e19,skyB=b>1e19;
  if(emission)return skyA||(!skyB&&b<=a+u_depthThreshold);
  return skyA==skyB&&(skyA||abs(a-b)<=u_depthThreshold)&&(!u_protect||groupAt(p)==groupAt(q));
}
float luminance(vec4 c){return dot(c.rgb,vec3(.2126,.7152,.0722))/max(1e-9,c.a);}
vec3 linearRGB(vec3 c){return mix(pow((c+.055)/1.055,vec3(2.4)),c/12.92,lessThanEqual(c,vec3(.04045)));}
vec3 displayRGB(vec3 c){return mix(1.055*pow(max(c,vec3(0.0)),vec3(1.0/2.4))-.055,c*12.92,lessThanEqual(c,vec3(.0031308)));}
uint hash(uint x){x=(x^(x>>16))*0x7feb352du;x=(x^(x>>15))*0x846ca68bu;return x^(x>>16);}
vec2 sortAt(int n,vec2 p){return u_horizontal?vec2((float(n)+.5)*u_size.x/u_workSize.x,p.y):vec2(p.x,(float(n)+.5)*u_size.y/u_workSize.y);}
bool eligible(vec2 p,vec2 q){
  if(!compatible(q,p,false)||(u_sourceMask&&weightAt(p)<=0.0))return false;
  vec4 c=readAt(p);float l=luminance(c);
  return c.a>0.0&&l>=u_sortThreshold.x&&l<=u_sortThreshold.y;
}
`;

const workFragment = `#version 300 es
${shared}
out vec4 color;
void main(){
  vec2 site=vec2(gl_FragCoord.x,u_workSize.y-gl_FragCoord.y),p=site*u_size/u_workSize;
  vec4 base=readAt(p),result=base;
  if(u_kind==8||u_kind==9){
    vec3 sum=vec3(0.0);
    for(int k=0;k<64;k++){
      if(k>=u_samples)break;
      float t=(float(k)+.5)/float(u_samples),r=u_radius*sqrt(u_kind==9?u_inner*u_inner+t*(1.0-u_inner*u_inner):t),a=float(k)*2.39996323;
      vec2 q=p+r*vec2(cos(a),sin(a));
      if(!compatible(p,q,true))continue;
      vec4 c=readAt(q);float bright=max(c.r,max(c.g,c.b))/max(c.a,1e-9);
      float amount=clamp((bright-u_threshold)/(1.0-u_threshold),0.0,1.0)*(u_sourceMask?weightAt(q):1.0)*(u_kind==8?exp(-2.0*t):1.0);
      sum+=linearRGB(c.rgb/max(c.a,1e-9))*c.a*amount*u_tint/float(u_samples);
    }
    color=vec4(sum*u_intensity*(u_kind==8?2.35:1.0),1.0);return;
  }
  if(u_kind==10){
    float z=zAt(p),coverage=0.0;vec4 g=groupAt(p);
    for(int k=0;k<8;k++){
      if(k>=u_samples)break;float a=float(k)*6.28318530718/float(u_samples);vec2 q=p+u_width*vec2(cos(a),sin(a));if(!inside(q))continue;
      float nz=zAt(q);vec4 ng=groupAt(q);bool near=z<nz,far=nz<z,sky=z>1e19,nsky=nz>1e19;
      bool boundary=sky!=nsky||!sky&&!nsky&&abs(z-nz)>max(u_depthThreshold,min(z,nz)*u_relativeDepth)||u_protect&&g!=ng;
      if(!boundary)continue;
      if(u_side!=1&&!sky&&(near||g!=ng&&!far))coverage=max(coverage,u_sourceMask?weightAt(p):1.0);
      if(u_side!=0&&!nsky&&(far||g!=ng&&!near))coverage=max(coverage,u_sourceMask?weightAt(q):1.0);
    }
    color=vec4(u_tint,coverage);return;
  }
  if(u_kind==11){
    vec2 offset=u_offset+(p/u_size-u_center)*u_radial;
    if(compatible(p,p+offset,false)&&(!u_sourceMask||weightAt(p+offset)>0.0))result.r=readAt(p+offset).r;
    if(compatible(p,p-offset,false)&&(!u_sourceMask||weightAt(p-offset)>0.0))result.b=readAt(p-offset).b;
  }else if(u_kind==12){
    uvec2 block=uvec2(floor(p/u_blockSize));
    uint key=hash(block.x*73856093u^block.y*19349663u^u_tick*83492791u^u_seed);
    if(float(key>>8u)/16777216.0<u_probability){
      vec2 q=p+u_offset*((key&1u)==1u?1.0:-1.0);
      if(compatible(p,q,false)&&(!u_sourceMask||weightAt(q)>0.0))result=readAt(q);
    }
  }else if(u_kind==13){
    int center=int(u_horizontal?site.x:site.y),extent=int(u_horizontal?u_workSize.x:u_workSize.y),start=center/u_span*u_span;
    if(eligible(p,p)){
      int left=center,right=center;
      for(int k=0;k<32;k++){if(left<=start||!eligible(sortAt(left-1,p),sortAt(left,p)))break;left--;}
      for(int k=0;k<32;k++){if(right+1>=min(start+u_span,extent)||!eligible(sortAt(right+1,p),sortAt(right,p)))break;right++;}
      // Bounded insertion sort. Each bucket is <=32 working cells; the resource
      // plan charges its quadratic comparison cost as well as source samples.
      vec4 values[32];int count=right-left+1;
      for(int k=0;k<32;k++){
        if(k>=count)break;
        vec4 value=readAt(sortAt(left+k,p));int dest=k;
        for(int j=0;j<32;j++){
          if(dest<=0)break;
          float d=(luminance(values[dest-1])-luminance(value))*(u_descending?-1.0:1.0);
          if(d<=0.0)break;values[dest]=values[dest-1];dest--;
        }
        values[dest]=value;
      }
      result=values[center-left];
    }
  }
  float gate=u_sourceMask?weightAt(p):1.0;
  color=vec4((vec3(128.0)+(result.rgb-base.rgb)*gate*127.0)/255.0,1.0);
}`;

const compositeFragment = `#version 300 es
${shared}
out vec4 color;
void main(){
  vec2 p=vec2(gl_FragCoord.x,u_size.y-gl_FragCoord.y);vec4 base=readAt(p);color=base;
  float amount=u_opacity*(u_outputMask?weightAt(p):1.0);if(amount<=0.0)return;
  vec2 uv=p*u_workSize/u_size-.5,origin=floor(uv),fraction=fract(uv);
  vec4 sum=vec4(0.0);float norm=0.0;bool glow=u_kind==8||u_kind==9;
  for(int k=0;k<4;k++){
    if(!u_linear&&k>0)break;
    vec2 index=clamp(u_linear?origin+vec2(k%2,k/2):floor(uv+.5),vec2(0.0),u_workSize-1.0);
    vec2 q=(index+.5)*u_size/u_workSize;
    if(!compatible(p,q,glow||u_kind==10&&u_side!=0))continue;
    float a=u_linear?(k%2==1?fraction.x:1.0-fraction.x)*(k>=2?fraction.y:1.0-fraction.y):1.0;
    sum+=layerAt(u_work,index+.5,u_workSize,false,false)*a;norm+=a;
  }
  if(norm<=0.0)return;sum/=norm;
  if(glow)color.rgb=displayRGB(linearRGB(base.rgb/max(base.a,1e-9))+sum.rgb*amount)*base.a;
  else if(u_kind==10)color.rgb=mix(base.rgb,sum.rgb*base.a,sum.a*amount);
  else color.rgb=base.rgb+(sum.rgb*255.0-128.0)/127.0*amount;
  color.rgb=clamp(color.rgb,vec3(0.0),vec3(base.a));
}`;

export function createRenderEffects(gl, { program, target, textureUnit, fullscreen }) {
  // Compile only when a graph actually uses one of these effects.
  let workShader, compositeShader, packet;
  return function execute(node, layout, out, values, w, h, time, inputTexture) {
    workShader ??= program(workFragment);
    compositeShader ??= program(compositeFragment);
    gl.activeTexture(gl.TEXTURE10);
    packet ??= target();
    packet.resize(layout.width, layout.height);
    textureUnit(0, inputTexture);
    textureUnit(10, packet.textures[0]);
    const uniforms = {
      ...values,
      u_work: 10,
      u_groups: 9,
      u_workSize: [layout.width, layout.height],
      u_kind: node.operation,
      u_sourceMask: node.maskMode !== 'output',
      u_outputMask: node.maskMode !== 'source',
      u_protect: node.protectObjects,
      u_linear: node.budget.filter === 'linear',
      u_samples: layout.samples,
      u_tint: (node.tint ?? node.color ?? [255, 255, 255]).map(n => n / 255),
      u_radius: node.radius ?? 1,
      u_threshold: Array.isArray(node.threshold) ? 0 : (node.threshold ?? 0),
      u_intensity: node.intensity ?? 1,
      u_inner: node.inner ?? 0,
      u_width: node.width ?? 1,
      u_relativeDepth: node.relativeDepth ?? 0,
      u_side: ['inner', 'outer', 'both'].indexOf(node.side),
      u_offset: node.offset ?? [0, 0],
      u_center: node.center ?? [0.5, 0.5],
      u_radial: node.radial ?? 0,
      u_blockSize: node.blockSize ?? [1, 1],
      u_probability: node.probability ?? 0,
      u_seed: node.seed ?? 1,
      u_tick: Math.floor(time * (node.rate ?? 0)) >>> 0,
      u_span: Math.min(node.span ?? 2, layout.samples),
      u_sortThreshold: Array.isArray(node.threshold) ? node.threshold : [0, 1],
      u_horizontal: node.axis !== 'y',
      u_descending: node.descending ?? false
    };
    // The work shader never reads u_work, so binding this target there is safe.
    fullscreen(workShader, packet.framebuffer, layout.width, layout.height, uniforms);
    fullscreen(compositeShader, out.framebuffer, w, h, uniforms);
  };
}
