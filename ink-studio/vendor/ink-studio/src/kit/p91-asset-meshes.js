/* Small, portable triangle recipes for declarative asset packs. */
(function (K) {
  const A = K.authoring, M = K.mesh;
  const maxVertices = 3072, maxTriangles = 3072, maxBytes = 1048576;
  const maxSockets = 32;
  const triplet = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
  const inRange = (value, max) => Number.isSafeInteger(value) && value >= 0 && value < max;
  const socketMap = value => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length <= maxSockets;
  const socketId = id => id.length > 0 && id.length <= 80 && !['__proto__', 'constructor', 'prototype'].includes(id);

  function validate(raw) {
    const value = A.data.clone(raw);
    const { positions, triangles, colors, faceColors, sockets, texture } = value || {};
    if (value?.type !== 'triangle-mesh' || !Array.isArray(positions) || !Array.isArray(triangles) ||
        positions.length < 9 || positions.length > maxVertices * 3 || positions.length % 3 ||
        triangles.length < 3 || triangles.length > maxTriangles * 3 || triangles.length % 3 ||
        positions.some(x => !Number.isFinite(x) || Math.abs(x) > 12) ||
        triangles.some(index => !inRange(index, positions.length / 3)))
      throw Error('Invalid triangle mesh or mesh exceeds the asset budget');
    if (!Array.isArray(colors) || !colors.length || colors.length > 64 ||
        !colors.every(rgb => triplet(rgb) && rgb.every(x => x >= 0 && x <= 1)) ||
        !Array.isArray(faceColors) || faceColors.length !== triangles.length / 3 ||
        !faceColors.every(index => inRange(index, colors.length)))
      throw Error('Invalid mesh face colors');
    if (sockets !== undefined && (!socketMap(sockets) ||
        Object.entries(sockets).some(([id, socket]) => !socketId(id) || !triplet(socket?.p) ||
          socket.p.some(x => Math.abs(x) > 12) || !triplet(socket.dir) ||
          Math.abs(Math.hypot(...socket.dir) - 1) > 1e-5)))
      throw Error('Invalid mesh socket');
    let area = 0;
    const point = i => positions.slice(i * 3, i * 3 + 3);
    for (let i = 0; i < triangles.length; i += 3) {
      const [a,b,c] = triangles.slice(i,i+3).map(point);
      area += K.V.len(K.V.cross(K.V.sub(b,a),K.V.sub(c,a))) * .5;
    }
    if (!(area > 1e-6 && area <= 60)) throw Error('Mesh surface area is outside the asset budget');
    if (texture !== undefined) A.assetTextures.validate(texture,positions.length/3,triangles.length/3);
    return A.data.freeze(value);
  }

  function recipe(mesh, { size } = {}) {
    if (size !== undefined && (!Number.isFinite(size) || size < .05 || size > 3))
      throw Error('Asset mesh size must be between 0.05 and 3');
    if (mesh.pos.length > maxVertices * 3 || mesh.tri.length > maxTriangles * 3)
      throw Error('Mesh exceeds the asset triangle budget');
    if (mesh.pos.some(x => !Number.isFinite(x))) throw Error('Mesh coordinates must be finite');
    const fitted = M.fit(mesh, { size });
    const colors = [], keys = new Map(), faceColors = [];
    for (let i = 0; i < fitted.tri.length; i += 3) {
      const material = fitted.tmat?.[i / 3] ?? 0;
      const rgb = fitted.vcol ? [0,1,2].map(channel =>
        [0,1,2].reduce((total,j) => total + fitted.vcol[fitted.tri[i+j]*3+channel]/3,0)) :
        fitted.mats?.[material]?.rgb || [.7,.7,.7];
      const tint = rgb.map(channel => Math.round(K.clamp(channel,0,1)*15)/15);
      const key = tint.join(',');
      if (!keys.has(key) && colors.length < 64) {
        keys.set(key, colors.length);
        colors.push(tint);
      }
      let best = keys.get(key);
      if (best === undefined) {
        let distance = Infinity;
        for (const [index, candidate] of colors.entries()) {
          const d = K.V.dist(candidate,tint);
          if (d < distance) { distance = d; best = index; }
        }
      }
      faceColors.push(best);
    }
    const rounded = x => Math.round(x*100000)/100000;
    return validate({ type:'triangle-mesh', positions:Array.from(fitted.pos,rounded),
      triangles:Array.from(fitted.tri), colors, faceColors,
      ...(fitted.sockets && { sockets:Object.fromEntries(Object.entries(fitted.sockets).map(([id, socket]) => [
        id, { p:socket.p.map(rounded), dir:socket.dir }
      ])) }) });
  }

  function readGLB(bytes, textures) {
    if (Object.prototype.toString.call(bytes) !== '[object Uint8Array]' ||
        bytes.byteLength < 20 || bytes.byteLength > maxBytes) throw Error('Expected one GLB file of up to 1 MB');
    const header = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if (header.getUint32(0,true) !== 0x46546c67 || header.getUint32(4,true) !== 2 ||
        header.getUint32(8,true) !== bytes.byteLength) throw Error('Expected a complete GLB 2.0 file');
    let json = null, bin = null;
    for (let at = 12; at < bytes.length;) {
      if (at + 8 > bytes.length) throw Error('Incomplete GLB chunk');
      const length = header.getUint32(at,true), type = header.getUint32(at+4,true), start = at + 8;
      if (length % 4 || start + length > bytes.length) throw Error('Invalid GLB chunk length');
      const chunk = bytes.subarray(start,start+length);
      if (type === 0x4e4f534a && json === null && at === 12)
        json = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(chunk));
      else if (type === 0x004e4942 && json && bin === null) bin = chunk;
      else throw Error('Expected one JSON chunk and one binary GLB buffer');
      at = start + length;
    }
    if (!Array.isArray(json?.buffers) || json.buffers.length !== 1 || json.buffers[0].uri ||
        !bin || json.buffers[0].byteLength > bin.length) throw Error('GLB mesh data must be embedded');

    const nodes = json.nodes, meshes = json.meshes, accessors = json.accessors, views = json.bufferViews;
    if (![nodes,meshes,accessors,views].every(x=>Array.isArray(x)&&x.length<=512))
      throw Error('Invalid GLB mesh tables');
    const roots = json.scenes?.[json.scene || 0]?.nodes;
    if (!Array.isArray(roots) || !roots.length) throw Error('GLB needs an active scene');
    const components = {5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}, widths = {SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
    function accessor(index, width, maxIndex) {
      const a = accessors[index], v = a && views[a.bufferView], widthOf = widths[a?.type], size = components[a?.componentType];
      if (!a || a.sparse || !v || v.buffer !== 0 || !size || !width.includes(widthOf) || !inRange(a.count,maxTriangles*3+1) ||
          !inRange(v.byteOffset??0,bin.length) || !inRange(v.byteLength,bin.length+1) ||
          !inRange(a.byteOffset??0,bin.length)) throw Error('Unsupported GLB vertex or index data');
      const row = size * widthOf, stride = v.byteStride || row, begin = v.byteOffset ?? 0, offset = a.byteOffset ?? 0;
      if (!Number.isSafeInteger(stride) || stride < row || begin + v.byteLength > bin.length ||
          offset + Math.max(0,a.count-1)*stride + row > v.byteLength) throw Error('GLB accessor is out of bounds');
      if (maxIndex !== undefined) {
        const read = {5121:'getUint8',5123:'getUint16',5125:'getUint32'}[a.componentType];
        if (!read || a.normalized) throw Error('GLB indices must be unsigned integers');
        const data = new DataView(bin.buffer,bin.byteOffset+begin+offset);
        for (let i = 0; i < a.count; i++)
          if (data[read](i*stride,true) >= maxIndex) throw Error('GLB index is outside its primitive');
      }
      return a.count;
    }
    let vertices = 0, triangles = 0;
    const visited = new Set();
    function walk(index, depth) {
      const node = nodes[index];
      if (!node || !inRange(index,nodes.length) || depth > 48 || visited.has(index)) throw Error('Invalid GLB scene hierarchy');
      visited.add(index);
      if (node.mesh !== undefined) {
        const primitives = meshes[node.mesh]?.primitives;
        if (!Array.isArray(primitives) || primitives.length > 64) throw Error('Invalid GLB primitives');
        for (const part of primitives) {
          if (part.mode !== undefined && part.mode !== 4) throw Error('Only triangle primitives are supported');
          const count = accessor(part.attributes?.POSITION,[3]);
          if (part.attributes?.COLOR_0 !== undefined && accessor(part.attributes.COLOR_0,[3,4]) !== count)
            throw Error('Vertex colors must match the vertex count');
          if (textures) A.assetTextures.checkPrimitive(json,part,count,accessor);
          const indices = part.indices === undefined ? count : accessor(part.indices,[1],count);
          vertices += count;
          triangles += indices / 3;
          if (indices % 3 || vertices > maxVertices || triangles > maxTriangles) throw Error('GLB exceeds the asset triangle budget');
        }
      }
      for (const child of node.children || []) walk(child,depth+1);
    }
    for (const root of roots) walk(root,0);
    return {json,bin,vertices,triangles};
  }
  function buildGLB({json,bin}, options, visitPrimitive) {
    const names = options?.socketNodes;
    if (names === undefined) return recipe(M.gltf(json,[bin],{visitPrimitive}),options);
    if (!socketMap(names) || Object.entries(names).some(([id, name]) =>
      !socketId(id) || typeof name !== 'string' || !name.length || name.length > 128))
      throw Error('Invalid GLB socket names');
    const requested = Object.entries(names), sockets = new Map();
    const mesh = M.gltf(json,[bin],{visitPrimitive,visitNode(name, matrix) {
      for (const [id, target] of requested) {
        if (name !== target) continue;
        if (sockets.has(id)) throw Error('Ambiguous GLB socket node: ' + target);
        const forward = matrix.slice(8,11), length = Math.hypot(...forward);
        if (!Number.isFinite(length) || length < 1e-9) throw Error('Invalid GLB socket direction: ' + target);
        sockets.set(id,{p:matrix.slice(12,15), dir:forward.map(value => value / length)});
      }
    }});
    if (sockets.size) mesh.sockets = Object.fromEntries(sockets);
    return recipe(mesh,options);
  }
  function fromGLB(bytes,options) {
    return buildGLB(readGLB(bytes,false),options);
  }
  async function importGLB(bytes,options={}) {
    const glb=readGLB(bytes,true);
    const textures=A.assetTextures.read(glb);
    const asset=buildGLB(glb,options,textures.visit);
    const texture=await textures.finish(options.decodeImage);
    return texture ? validate({...asset,texture}) : asset;
  }
  function colorSampler(raw) {
    return A.assetTextures.sampler(A.data.isImmutable(raw)?raw:validate(raw));
  }
  function thumbnail(raw, { size = 40, padding = .10, yaw = .62, pitch = .42,
    light = [-.4,.9,.55] } = {}) {
    if (!Number.isInteger(size) || size < 8 || size > 128 || !Number.isFinite(padding) ||
        padding < 0 || padding > .35 || !Number.isFinite(yaw) || !Number.isFinite(pitch) ||
        !triplet(light) || K.V.len(light) < 1e-6) throw Error('Invalid mesh thumbnail settings');
    const asset=validate(raw), {positions,triangles}=asset, {V}=K;
    const sample=colorSampler(asset), detailed=!!asset.texture?.layers;
    const forward = [Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)];
    const right = [Math.cos(yaw),0,-Math.sin(yaw)], up = V.cross(forward,right), sun = V.norm(light);
    const points = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i=0;i<positions.length;i+=3) {
      const point=positions.slice(i,i+3), x=V.dot(point,right), y=-V.dot(point,up);
      points.push([x,y,V.dot(point,forward)]);
      minX=Math.min(minX,x); maxX=Math.max(maxX,x);
      minY=Math.min(minY,y); maxY=Math.max(maxY,y);
    }
    const scale=size*(1-2*padding)/Math.max(maxX-minX,maxY-minY),
      centerX=(minX+maxX)*.5, centerY=(minY+maxY)*.5;
    for (const point of points) {
      point[0]=size*.5+(point[0]-centerX)*scale;
      point[1]=size*.5+(point[1]-centerY)*scale;
    }
    const pixels=new Uint8ClampedArray(size*size*4), fragments=Array.from({length:size*size},()=>[]);
    const point = index => positions.slice(index*3,index*3+3);
    for (let i=0;i<triangles.length;i+=3) {
      const ia=triangles[i], ib=triangles[i+1], ic=triangles[i+2];
      const [ax,ay,az]=points[ia], [bx,by,bz]=points[ib], [cx,cy,cz]=points[ic];
      const ux=bx-ax, uy=by-ay, vx=cx-ax, vy=cy-ay, area=ux*vy-uy*vx;
      if (Math.abs(area)<1e-9) continue;
      const origin=point(ia);
      let n=V.norm(V.cross(V.sub(point(ib),origin),V.sub(point(ic),origin)));
      if (V.dot(n,forward)<0) n=V.mul(n,-1);
      const gain=.46+.54*Math.max(0,V.dot(n,sun));
      const flat=!detailed&&!(asset.texture?.faces[i/3]>=0)
        ? sample.at(i/3,0,0).map(value=>Math.round(value*gain*255)) : null;
      const left=Math.max(0,Math.ceil(Math.min(ax,bx,cx)-.5)), right=Math.min(size-1,Math.floor(Math.max(ax,bx,cx)-.5));
      const top=Math.max(0,Math.ceil(Math.min(ay,by,cy)-.5)), bottom=Math.min(size-1,Math.floor(Math.max(ay,by,cy)-.5));
      for (let y=top;y<=bottom;y++) for (let x=left;x<=right;x++) {
        const dx=x+.5-ax, dy=y+.5-ay, u=(dx*vy-dy*vx)/area, v=(ux*dy-uy*dx)/area;
        if (u<-1e-8 || v<-1e-8 || u+v>1+1e-8) continue;
        const z=Math.fround(az+u*(bz-az)+v*(cz-az)), pixel=y*size+x;
        const opacity=sample.opacityAt(i/3,u,v);
        if(!opacity) continue;
        let color=flat;
        if(detailed) {
          const material=sample.materialAt(i/3,u,v,n);
          const irradiance=.22+.78*Math.max(0,V.dot(material.normal,sun));
          color=A.assetTextures.shade(material,{irradiance,light:sun,view:forward}).map(v=>Math.round(v*255));
        }
        fragments[pixel].push({z,opacity,color:color||sample.at(i/3,u,v).map(value=>Math.round(value*gain*255))});
      }
    }
    const linear = q => q <= .04045 ? q / 12.92 : ((q + .055) / 1.055) ** 2.4;
    const srgb = q => q <= .0031308 ? 12.92 * q : 1.055 * q ** (1 / 2.4) - .055;
    for(const [pixel,layers] of fragments.entries()) {
      layers.sort((a,b)=>a.z-b.z);
      const rgb=[0,0,0];
      let alpha=0;
      for(let j=0;j<layers.length;j++) {
        const layer=layers[j];
        if(j+1<layers.length&&Math.abs(layers[j+1].z-layer.z)<1e-7) continue;
        for(let k=0;k<3;k++) rgb[k]=linear(layer.color[k]/255)*layer.opacity+rgb[k]*(1-layer.opacity);
        alpha=layer.opacity+alpha*(1-layer.opacity);
      }
      if(alpha) pixels.set([...rgb.map(c=>Math.round(srgb(c/alpha)*255)),Math.round(alpha*255)],pixel*4);
    }
    return {width:size,height:size,pixels};
  }

  A.assetMeshes = Object.freeze({ recipe, validate, fromGLB, importGLB, colorSampler,
    shadeMaterial: (material,options)=>A.assetTextures.shade(material,options),
    highlight: (normal,roughness,light,view)=>A.assetTextures.highlight(normal,roughness,light,view),
    get highlightGLSL(){return A.assetTextures.highlightGLSL;}, thumbnail });
})(KIT);
