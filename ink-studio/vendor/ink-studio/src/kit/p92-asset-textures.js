/* Portable texture and material channels for imported triangle assets. */
(function (K) {
  const A=K.authoring, maxEdge=128, maxPixels=16384, maxMaps=16;
  const inRange=(v,lo,hi)=>Number.isFinite(v)&&v>=lo&&v<=hi;
  const integer=(v,lo,hi)=>Number.isInteger(v)&&inRange(v,lo,hi);
  const vector=(v,n,lo,hi)=>Array.isArray(v)&&v.length===n&&Array.from(v).every(x=>inRange(x,lo,hi));
  const wraps=new Map([[33071,'clamp'],[33648,'mirror'],[10497,'repeat']]);
  const linear=q=>q<=.04045?q/12.92:((q+.055)/1.055)**2.4;
  const srgb=q=>q<=.0031308?q*12.92:1.055*q**(1/2.4)-.055;
  const linearByte=Array.from({length:256},(_,i)=>linear(i/255));
  const bytes=(s,n)=>typeof s==='string'&&s.length===4*Math.ceil(n/3)&&
    s.endsWith('='.repeat((3-n%3)%3))&&/^[A-Za-z0-9+/]*={0,2}$/.test(s)&&
    (s.replace(/=+$/,'').length*6>>3)===n;
  const unpack=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const pack=v=>btoa(String.fromCharCode(...v));

  const channels=['color','normal','roughness','emission'];
  function validate(texture,vertices,faces) {
    const { tints, alphaTints, images, layers={} }=texture||{};
    if(alphaTints!==undefined&&!bytes(alphaTints,vertices)||tints!==undefined&&!bytes(tints,vertices*3)||!Array.isArray(images)||images.length>maxMaps||
       !layers||typeof layers!=='object'||Array.isArray(layers)||
       !Object.keys(layers).every(key=>channels.slice(1).includes(key)))
      throw Error('Invalid asset texture');
    let sum=0;
    for(const image of images) {
      const {width,height,rgb,alpha}=image||{};
      if(!integer(width,1,maxEdge)||!integer(height,1,maxEdge)||!bytes(rgb,width*height*3)||alpha!==undefined&&!bytes(alpha,width*height))
        throw Error('Invalid asset texture image');
      sum+=width*height;
    }
    if(sum>maxPixels) throw Error('Asset images exceed the texel budget');
    for(const [channel,layer] of Object.entries({color:texture,...layers})) {
      const {uv,maps,faces:bindings,normals,tangents}=layer||{};
      if(!vector(uv,vertices*2,-1e6,1e6)||!Array.isArray(maps)||maps.length>maxMaps||
         !Array.isArray(bindings)||bindings.length!==faces||
         !Array.from(bindings).every(v=>integer(v,-1,maps.length-1))||
         channel==='normal'&&(normals!==undefined&&!bytes(normals,vertices*3)||
          tangents!==undefined&&(!normals||!bytes(tangents,vertices*4))))
        throw Error('Invalid asset '+channel+' texture');
      for(const map of maps) {
        const {image,wrap,filter,factor,alphaMode,alphaCutoff,opacity}=map||{};
        const min=channel==='normal'?-16:0, max=['normal','emission'].includes(channel)?16:1;
        if(channel==='color'&&(alphaMode!==undefined&&!['OPAQUE','MASK','BLEND'].includes(alphaMode)||
           alphaCutoff!==undefined&&!inRange(alphaCutoff,0,1)||opacity!==undefined&&!inRange(opacity,0,1))||
           !vector(factor,3,min,max)||((image!==undefined||channel==='normal')&&
           (!integer(image,0,images.length-1)||!Array.isArray(wrap)||wrap.length!==2||
            !Array.from(wrap).every(w=>['clamp','mirror','repeat'].includes(w))||
            !['nearest','linear'].includes(filter)))) throw Error('Invalid asset '+channel+' sampler');
      }
    }
  }

  function binding(json,part,channel) {
    const material=json.materials?.[part.material], pbr=material?.pbrMetallicRoughness;
    const info=channel==='color'?pbr?.baseColorTexture:channel==='normal'?material?.normalTexture:
      channel==='roughness'?pbr?.metallicRoughnessTexture:material?.emissiveTexture;
    const strength=channel==='emission'?(material?.extensions?.KHR_materials_emissive_strength?.emissiveStrength??1):1;
    const base=pbr?.baseColorFactor??[1,1,1,1], glow=material?.emissiveFactor??[0,0,0];
    if(channel==='color'&&!vector(base,4,0,1)||
       channel==='emission'&&(!vector(glow,3,0,1)||!inRange(strength,0,16))) throw Error('Invalid GLB '+channel+' factor');
    const alphaMode=material?.alphaMode??'OPAQUE', alphaCutoff=material?.alphaCutoff??.5;
    if(channel==='color'&&(!['OPAQUE','MASK','BLEND'].includes(alphaMode)||!inRange(alphaCutoff,0,1)))
      throw Error('Invalid GLB alpha material');
    const alpha=channel==='color'?{alphaMode,alphaCutoff,opacity:base[3]}:{};
    const factor=channel==='color'?base.slice(0,3):
      channel==='normal'?[info?.scale??1,info?.scale??1,1]:
      channel==='roughness'?Array(3).fill(pbr?.roughnessFactor??1):
      glow.map(value=>value*strength);
    if(!vector(factor,3,channel==='normal'?-16:0,['normal','emission'].includes(channel)?16:1))
      throw Error('Invalid GLB '+channel+' factor');
    if(info===undefined) {
      if(channel==='color') return {factor,...alpha};
      if(channel==='roughness'&&factor[0]<1||channel==='emission'&&factor.some(n=>n>0)) return {factor};
      return null;
    }
    if(!info||!integer(info.index,0,(json.textures?.length??0)-1)) throw Error('Invalid GLB '+channel+' binding');
    const transform=info.extensions?.KHR_texture_transform||{};
    const source=transform.texCoord??info.texCoord??0,
      scale=transform.scale??[1,1],offset=transform.offset??[0,0],rotation=transform.rotation??0;
    if(!integer(source,0,0x7fffffff)||!vector(scale,2,-1e6,1e6)||!vector(offset,2,-1e6,1e6)||
       !Number.isFinite(rotation)) throw Error('Invalid GLB '+channel+' coordinates');
    const index=part.attributes['TEXCOORD_'+source];
    const texture=json.textures[info.index], sampler=texture&&json.samplers?.[texture.sampler];
    if(!texture||!integer(texture.source,0,(json.images?.length??0)-1)||
       texture.sampler!==undefined&&!sampler) throw Error('GLB texture needs an embedded PNG or JPEG image');
    const wrap=[wraps.get(sampler?.wrapS??10497),wraps.get(sampler?.wrapT??10497)],
      filter=sampler?.magFilter??9729;
    if(wrap.includes(undefined)||![9728,9729].includes(filter)) throw Error('Unsupported GLB texture sampler');
    return {index,scale,offset,rotation,factor,...alpha,source:texture.source,
      wrap,filter:filter===9728?'nearest':'linear'};
  }

  function checkPrimitive(json,part,count,accessor) {
    for(const channel of channels) {
      const spec=binding(json,part,channel);
      if(!spec||spec.source===undefined) continue;
      const a=json.accessors[spec.index];
      if(!a||!(a.componentType===5126&&!a.normalized||[5121,5123].includes(a.componentType)&&a.normalized)||
         accessor(spec.index,[2])!==count) throw Error('Textured GLB primitives need valid texture coordinates');
      if(channel==='color'&&part.attributes.COLOR_0!==undefined) {
        const color=json.accessors[part.attributes.COLOR_0];
        if(!(color.componentType===5126&&!color.normalized||[5121,5123].includes(color.componentType)&&color.normalized))
          throw Error('Textured GLB vertex colors need normalized channels');
      }
      if(channel==='normal') for(const [attribute,width] of [['NORMAL',3],['TANGENT',4]]) {
        const index=part.attributes[attribute];
        if(index!==undefined&&(json.accessors[index]?.componentType!==5126||accessor(index,[width])!==count))
          throw Error('Normal-mapped GLB primitives need valid '+attribute+' data');
      }
    }
  }

  function embedded(glb,index) {
    const image=glb.json.images[index], uri=image?.uri;
    if(typeof uri==='string') {
      const match=/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(uri);
      if(match&&image.bufferView===undefined) return {mime:match[1],pixels:unpack(match[2])};
      throw Error('GLB base-color images must be embedded');
    }
    const mime=image?.mimeType, view=image&&glb.json.bufferViews[image.bufferView];
    const start=view?.byteOffset??0, length=view?.byteLength;
    if(!['image/png','image/jpeg'].includes(mime)||view?.buffer!==0||!integer(length,1,glb.bin.length)||
       !integer(start,0,glb.bin.length-length)) throw Error('GLB base color needs an embedded PNG or JPEG image');
    return {mime,pixels:glb.bin.subarray(start,start+length)};
  }

  function reduceImage(decoded, limit=maxEdge) {
    const {width,height,pixels}=decoded||{};
    const pixelsType=Object.prototype.toString.call(pixels);
    if(!integer(width,1,4096)||!integer(height,1,4096)||
       !['[object Uint8Array]','[object Uint8ClampedArray]'].includes(pixelsType)||pixels.length!==4*width*height)
      throw Error('GLB image decoder must return bounded RGBA bytes');
    const scale=Math.min(1,limit/Math.max(width,height)), w=Math.max(1,Math.round(width*scale)), h=Math.max(1,Math.round(height*scale));
    const rgb=new Uint8Array(w*h*3), alpha=new Uint8Array(w*h);
    let transparent=false;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      const dx=Math.min(width-1,Math.floor((x+.5)*width/w)), dy=Math.min(height-1,Math.floor((y+.5)*height/h));
      rgb.set(pixels.subarray((dy*width+dx)*4,(dy*width+dx)*4+3),(y*w+x)*3);
      const a=pixels[(dy*width+dx)*4+3];
      alpha[y*w+x]=a; transparent ||= a<255;
    }
    return {width:w,height:h,rgb:pack(rgb),...(transparent&&{alpha:pack(alpha)})};
  }
  function dimensions(pixels,mime) {
    const bytes=new DataView(pixels.buffer,pixels.byteOffset,pixels.byteLength);
    if(mime==='image/png'&&pixels.length>=24&&bytes.getUint32(0)===0x89504e47&&
       bytes.getUint32(4)===0x0d0a1a0a&&bytes.getUint32(12)===0x49484452) {
      return [bytes.getUint32(16),bytes.getUint32(20)];
    }
    if(mime==='image/jpeg'&&pixels.length>=4&&bytes.getUint16(0)===0xffd8) {
      for(let i=2;i+3<pixels.length;) {
        if(pixels[i++]!==255) break;
        while(pixels[i]===255) i++;
        const marker=pixels[i++];
        if(marker===0xda||marker===0xd9||i+2>pixels.length) break;
        const size=bytes.getUint16(i);
        if(size<2||i+size>pixels.length) break;
        if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker)&&size>=8)
          return [bytes.getUint16(i+5),bytes.getUint16(i+3)];
        i+=size;
      }
    }
    throw Error('Invalid embedded GLB image header');
  }

  function read(glb) {
    const {json,vertices,triangles}=glb, images=[], imageIds=new Map();
    const layers=new Map(), materialIds=new Map();
    const color=newLayer(), tints=new Uint8Array(vertices*3).fill(255);
    const alphaTints=new Uint8Array(vertices).fill(255);
    let tinted=false, translucent=false, normals, tangents;
    function newLayer() {
      return {uv:new Array(vertices*2).fill(0),faces:new Array(triangles).fill(-1),maps:[]};
    }
    function store(layer,keys,material,spec,range) {
      const {firstVertex,vertexCount,firstFace,faceCount,accessor}=range;
      if(!keys.has(material)) {
        const map={factor:spec.factor};
        if(spec.alphaMode!==undefined) Object.assign(map,{alphaMode:spec.alphaMode,alphaCutoff:spec.alphaCutoff,opacity:spec.opacity});
        if(spec.source!==undefined) {
          if(!imageIds.has(spec.source)) {
            if(images.length>=maxMaps) throw Error('Asset exceeds the embedded image budget');
            imageIds.set(spec.source,images.length);
            images.push(embedded(glb,spec.source));
          }
          Object.assign(map,{image:imageIds.get(spec.source),wrap:spec.wrap,filter:spec.filter});
        }
        if(layer.maps.length>=maxMaps) throw Error('Asset exceeds the material channel budget');
        keys.set(material,layer.maps.length);
        layer.maps.push(map);
      }
      layer.faces.fill(keys.get(material),firstFace,firstFace+faceCount);
      if(spec.source===undefined) return;
      const src=accessor(spec.index), c=Math.cos(spec.rotation),s=Math.sin(spec.rotation);
      for(let i=0;i<vertexCount;i++) {
        const u=src.get(i,0)*spec.scale[0],v=src.get(i,1)*spec.scale[1],slot=firstVertex+i;
        layer.uv[slot*2]=Math.round((spec.offset[0]+c*u-s*v)*1e5)/1e5;
        layer.uv[slot*2+1]=Math.round((spec.offset[1]+s*u+c*v)*1e5)/1e5;
      }
    }
    function storeFrame(part,range) {
      const index=part.attributes.NORMAL;
      if(index===undefined) return;
      const {accessor,matrix,firstVertex,vertexCount}=range, {M,V}=K;
      const R=[matrix[0],matrix[4],matrix[8],matrix[1],matrix[5],matrix[9],matrix[2],matrix[6],matrix[10]];
      const sign=Math.sign(M.det(R));
      if(!sign) return;
      const normalMap=M.tr(M.inv(R)), src=accessor(index),
        tangent=part.attributes.TANGENT===undefined?null:accessor(part.attributes.TANGENT);
      normals ||= new Uint8Array(vertices*3).fill(128);
      if(tangent) tangents ||= new Uint8Array(vertices*4).fill(128);
      const byte=n=>128+Math.round(n*127);
      for(let i=0;i<vertexCount;i++) {
        const n=V.norm(M.app(normalMap,[src.get(i,0),src.get(i,1),src.get(i,2)]));
        if(!n.every(Number.isFinite)) throw Error('GLB normals must be finite');
        normals.set(n.map(byte),(firstVertex+i)*3);
        if(tangent) {
          const t=V.norm(M.app(R,[tangent.get(i,0),tangent.get(i,1),tangent.get(i,2)]));
          const hand=tangent.get(i,3);
          if(!t.every(Number.isFinite)||hand!==1&&hand!==-1) throw Error('GLB tangents must be finite with a handedness');
          tangents.set([...t.map(byte),byte(hand*sign)],(firstVertex+i)*4);
        }
      }
    }
    return {
      visit(part,range) {
        for(const channel of channels) {
          const spec=binding(json,part,channel);
          if(!spec) continue;
          if(!materialIds.has(channel)) materialIds.set(channel,new Map());
          if(channel!=='color'&&!layers.has(channel)) layers.set(channel,newLayer());
          store(channel==='color'?color:layers.get(channel),materialIds.get(channel),part.material,spec,range);
          if(channel==='normal') storeFrame(part,range);
          if(channel==='color'&&part.attributes.COLOR_0!==undefined) {
            const {accessor,firstVertex,vertexCount}=range, tint=accessor(part.attributes.COLOR_0);
            for(let i=0;i<vertexCount;i++)for(let k=0;k<3;k++) {
              const q=tint.get(i,k);
              if(!inRange(q,0,1)) throw Error('GLB vertex colors must be normalized');
              tints[(firstVertex+i)*3+k]=Math.round(q*255);
              tinted ||= q<1;
            }
            if(tint.w===4) for(let i=0;i<vertexCount;i++) {
              const alpha=tint.get(i,3);
              if(!inRange(alpha,0,1)) throw Error('GLB vertex alpha must be normalized');
              alphaTints[firstVertex+i]=Math.round(alpha*255);
              translucent ||= alpha<1;
            }
          }
        }
      },
      async finish(decodeImage) {
        if(!color.maps.length&&!layers.size) return null;
        if(images.length&&typeof decodeImage!=='function') throw Error('Embedded GLB textures need an image decoder');
        const decoded=[];
        for(const {mime,pixels} of images) {
          const [width,height]=dimensions(pixels,mime);
          if(![width,height].every(n=>integer(n,1,4096)))
            throw Error('Embedded GLB image dimensions exceed the decoder budget');
          const edgeLimit=images.length===1?maxEdge:64;
          decoded.push(reduceImage(await decodeImage(pixels,mime,{width,height,maxEdge:edgeLimit}),edgeLimit));
        }
        if(normals) layers.get('normal').normals=pack(normals);
        if(tangents) layers.get('normal').tangents=pack(tangents);
        return {...color,images:decoded,...(tinted&&{tints:pack(tints)}),
          ...(translucent&&{alphaTints:pack(alphaTints)}),
          ...(layers.size&&{layers:Object.fromEntries(layers)})};
      }
    };
  }

  function edge(i,size,mode) {
    if(mode==='clamp') return Math.min(size-1,Math.max(0,i));
    const span=mode==='mirror'?2*size:size, q=((i%span)+span)%span;
    return q>=size?span-1-q:q;
  }
  const compiled=new WeakMap(), decodedImages=new Map(), decodedImageLimit=64;
  function decodedImage({width,height,rgb,alpha}) {
    const key=width+'/'+height+'/'+rgb+'/'+(alpha??'');
    let image=decodedImages.get(key);
    if(image) decodedImages.delete(key);
    else {
      image={width,height,data:unpack(rgb),alpha:alpha&&unpack(alpha)};
      if(decodedImages.size===decodedImageLimit) decodedImages.delete(decodedImages.keys().next().value);
    }
    decodedImages.set(key,image);
    return image;
  }
  function sampler(recipe) {
    if(compiled.has(recipe)) return compiled.get(recipe);
    const {texture,positions,triangles,colors,faceColors}=recipe, {V}=K;
    const images=texture?.images.map(decodedImage);
    const normalLayer=texture?.layers?.normal;
    const normals=normalLayer?.normals&&unpack(normalLayer.normals),
      tangents=normalLayer?.tangents&&unpack(normalLayer.tangents), tints=texture?.tints&&unpack(texture.tints),
      alphaTints=texture?.alphaTints&&unpack(texture.alphaTints);
    const projection=new Map(), frames=new Map();
    const mix=(a,b,q)=>a+(b-a)*q;
    const ids=t=>triangles.slice(t*3,t*3+3);
    const localPoint=i=>positions.slice(i*3,i*3+3);
    function weightsAt(t,x,y,z) {
      if(!projection.has(t)) {
        const [i,j,k]=ids(t), anchor=localPoint(i), b=V.sub(localPoint(j),anchor), c=V.sub(localPoint(k),anchor);
        const bb=V.dot(b,b),bc=V.dot(b,c),cc=V.dot(c,c),den=bb*cc-bc*bc;
        const u=V.mul(V.sub(V.mul(b,cc),V.mul(c,bc)),1/(den||1));
        const v=V.mul(V.sub(V.mul(c,bb),V.mul(b,bc)),1/(den||1));
        projection.set(t,den>1e-16?{u,v,originU:V.dot(anchor,u),originV:V.dot(anchor,v)}:null);
      }
      const row=projection.get(t);
      if(!row) return [1,0,0];
      const {u:a,v:b,originU,originV}=row;
      const u=x*a[0]+y*a[1]+z*a[2]-originU,v=x*b[0]+y*b[1]+z*b[2]-originV;
      const w=[Math.max(0,1-u-v),Math.max(0,u),Math.max(0,v)], sum=w[0]+w[1]+w[2];
      return w.map(value=>value/sum);
    }
    function interpolate(values, stride, vertices, weights, channel) {
      const [a,b,c]=vertices, [wa,wb,wc]=weights;
      return wa*values[stride*a+channel]+wb*values[stride*b+channel]+wc*values[stride*c+channel];
    }
    function texel(layer,map,vertices,weights,encoded,alpha=false) {
      const image=images[map.image];
      const {width,height}=image, data=alpha?image.alpha:image.data;
      if(alpha&&!data) return [1];
      const stride=alpha?1:3, count=alpha?1:3;
      const {filter}=map;
      const nearest=filter==='nearest';
      /* Shared addressing keeps alpha and color aligned for either filter. */
      const x=interpolate(layer.uv,2,vertices,weights,0)*width-(nearest?0:.5);
      const y=interpolate(layer.uv,2,vertices,weights,1)*height-(nearest?0:.5);
      const u=Math.floor(x),v=Math.floor(y),fx=nearest?0:x-u,fy=nearest?0:y-v;
      const left=edge(u,width,map.wrap[0]),right=edge(u+1,width,map.wrap[0]),
        top=edge(v,height,map.wrap[1]),bottom=edge(v+1,height,map.wrap[1]);
      const offsets=[top*width+left,top*width+right,bottom*width+left,bottom*width+right].map(i=>stride*i);
      return Array.from({length:count},(_,channel)=>{
        const [a,b,c,d]=offsets.map(i=>encoded?linearByte[data[i+channel]]:data[i+channel]/255);
        return mix(mix(a,b,fx),mix(c,d,fx),fy);
      });
    }
    const bindingAt=(layer,t)=>layer?.maps[layer.faces[t]];
    function baseColor(t,vertices,weights) {
      const map=bindingAt(texture,t);
      if(!map) return colors[faceColors[t]];
      return (map.image===undefined?[1,1,1]:texel(texture,map,vertices,weights,true)).map((value,c)=>{
        const tint=tints?interpolate(tints,3,vertices,weights,c)/255:1;
        return srgb(value*tint*map.factor[c]);
      });
    }
    function coverage(t,vertices,weights) {
      const map=bindingAt(texture,t);
      if(!map||!map.alphaMode||map.alphaMode==='OPAQUE') return 1;
      const image=map.image===undefined?1:texel(texture,map,vertices,weights,false,true)[0];
      const tint=alphaTints?interpolate(alphaTints,1,vertices,weights,0)/255:1;
      const alpha=K.clamp(image*tint*(map.opacity??1),0,1);
      return map.alphaMode==='MASK'?Number(alpha>=(map.alphaCutoff??.5)):alpha;
    }
    function frame(t,vertices) {
      if(frames.has(t)) return frames.get(t);
      const [i,j,k]=vertices,[a,b,c]=vertices.map(localPoint), e1=V.sub(b,a),e2=V.sub(c,a);
      const uv=normalLayer.uv, s1=uv[2*j]-uv[2*i],s2=uv[2*k]-uv[2*i],
        t1=uv[2*j+1]-uv[2*i+1],t2=uv[2*k+1]-uv[2*i+1],det=s1*t2-t1*s2;
      const n=V.norm(V.cross(e1,e2));
      const tangent=Math.abs(det)>1e-12?V.mul(V.sub(V.mul(e1,t2),V.mul(e2,t1)),1/det):null;
      const bitangent=tangent?V.mul(V.sub(V.mul(e2,s1),V.mul(e1,s2)),1/det):null;
      const entry={n,tangent,bitangent};
      frames.set(t,entry);
      return entry;
    }
    function mappedNormal(t,vertices,weights,geometric) {
      const map=bindingAt(normalLayer,t);
      if(!map) return geometric;
      const legs=frame(t,vertices);
      const decode=(data,stride)=>[0,1,2].map(c=>(interpolate(data,stride,vertices,weights,c)-128)/127);
      const authored=normals&&decode(normals,3);
      let n=authored&&V.len(authored)>.02?V.norm(authored):legs.n;
      const authoredT=tangents&&decode(tangents,4);
      const tangent=authoredT&&V.len(authoredT)>.02?authoredT:legs.tangent;
      if(!tangent||V.len(n)<.01) return geometric||n;
      if(geometric&&V.dot(n,geometric)<0) n=V.mul(n,-1);
      const flat=V.sub(tangent,V.mul(n,V.dot(n,tangent)));
      if(V.len(flat)<1e-6) return n;
      const axis=V.norm(flat), cross=V.cross(n,axis);
      const reference=authoredT&&tangent===authoredT?(interpolate(tangents,4,vertices,weights,3)-128):
        V.dot(cross,legs.bitangent);
      const binormal=V.mul(cross,reference<0?-1:1);
      const [x,y,z]=texel(normalLayer,map,vertices,weights,false).map((value,i)=>(2*value-1)*map.factor[i]);
      const mapped=V.add(V.add(V.mul(axis,x),V.mul(binormal,y)),V.mul(n,z));
      return V.len(mapped)>1e-6?V.norm(mapped):n;
    }
    function at(t,u,v) {
      return baseColor(t,ids(t),[1-u-v,u,v]);
    }
    function atPoint(t,x,y,z) {
      if(!bindingAt(texture,t)) return colors[faceColors[t]];
      return baseColor(t,ids(t),weightsAt(t,x,y,z));
    }
    function material(t,vertices,weights,geometric) {
      if(!geometric) {
        const [a,b,c]=vertices.map(localPoint);
        geometric=V.norm(V.cross(V.sub(b,a),V.sub(c,a)));
      }
      const roughnessLayer=texture?.layers?.roughness, emissionLayer=texture?.layers?.emission;
      const rough=bindingAt(roughnessLayer,t), emitted=bindingAt(emissionLayer,t);
      const roughness=rough?(rough.image===undefined?1:texel(roughnessLayer,rough,vertices,weights,false)[1])*rough.factor[1]:1;
      const emission=emitted?(emitted.image===undefined?emitted.factor:texel(emissionLayer,emitted,vertices,weights,true)
        .map((value,i)=>value*emitted.factor[i])):[0,0,0];
      return {opacity:coverage(t,vertices,weights),color:baseColor(t,vertices,weights),normal:mappedNormal(t,vertices,weights,geometric),roughness,emission};
    }
    const result=Object.freeze({at,atPoint,
      opacityAt:(t,u,v)=>coverage(t,ids(t),[1-u-v,u,v]),
      opacityAtPoint:(t,x,y,z)=>coverage(t,ids(t),weightsAt(t,x,y,z)),
      materialAt:(t,u,v,geometric)=>material(t,ids(t),[1-u-v,u,v],geometric),
      materialAtPoint:(t,x,y,z,geometric)=>material(t,ids(t),weightsAt(t,x,y,z),geometric)});
    compiled.set(recipe,result);
    return result;
  }
  const specularGain=.20, minPower=4, glossPower=56;
  function highlight(normal,roughness,light,view) {
    const {V}=K, gloss=1-K.clamp(roughness,0,1);
    if (!gloss || V.dot(normal,light)<=0 || V.dot(normal,view)<=0) return 0;
    const midpoint=V.norm(V.add(light,view),[0,0,0]);
    return specularGain*gloss*Math.max(0,V.dot(normal,midpoint))**(minPower+glossPower*gloss**2);
  }
  const highlightGLSL=`
float assetHighlight(vec3 normal, float roughness, vec3 light, vec3 view) {
  float gloss = 1.0 - clamp(roughness, 0.0, 1.0);
  if (gloss <= 0.0 || dot(normal, light) <= 0.0 || dot(normal, view) <= 0.0) return 0.0;
  vec3 halfVector = light + view;
  halfVector *= inversesqrt(max(dot(halfVector, halfVector), 1e-18));
  return ${specularGain} * gloss * pow(max(0.0, dot(normal, halfVector)), ${minPower.toFixed(1)} + ${glossPower.toFixed(1)} * gloss * gloss);
}
vec3 assetAddHighlight(vec3 color, float linearGain) {
  vec3 linearColor = mix(pow((color + 0.055) / 1.055, vec3(2.4)), color / 12.92, lessThanEqual(color, vec3(0.04045)));
  linearColor = clamp(linearColor + linearGain, 0.0, 1.0);
  return mix(1.055 * pow(linearColor, vec3(1.0 / 2.4)) - 0.055, 12.92 * linearColor, lessThanEqual(linearColor, vec3(0.0031308)));
}
`;
  function shade({color,normal,roughness=1,emission=[0,0,0]}, {irradiance=1,light,view}={}) {
    const extra=normal&&light&&view?highlight(normal,roughness,light,view):0;
    return color.map((value,i)=>srgb(K.clamp(linear(value)*irradiance+extra+emission[i],0,1)));
  }
  A.assetTextures=Object.freeze({validate,checkPrimitive,read,sampler,shade,highlight,highlightGLSL});
})(KIT);
