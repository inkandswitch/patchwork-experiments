/* Artist-authored directional sprite atlases. Coordinates in the atlas are top-down. */
const AtlasSprites = (() => {
  const drawing=typeof FrameComposite==='undefined'?require('./frame-composite.js'):FrameComposite;
  const cels=typeof SpriteCels==='undefined'?require('./sprite-cels.js'):SpriteCels;
  const assetBrand=Symbol.for('ink-studio.sprite-atlas'), placedBrand=Symbol.for('ink-studio.atlas-placement');
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const finite=(n,label)=>{
    if (!Number.isFinite(n)) throw new RangeError(label+' must be finite');
    return n;
  };
  const positive=(n,label)=>{
    if (!Number.isFinite(n)||n<=0) throw new RangeError(label+' must be positive');
    return n;
  };
  const vector=(v,label)=>{
    if (!Array.isArray(v)||v.length!==3||!Array.from(v).every(Number.isFinite))
      throw new TypeError(label+' needs a finite XYZ position');
    return v.slice();
  };

  function basis(yaw,pitch) {
    const x=Math.sin(yaw),z=Math.cos(yaw),s=Math.sin(pitch),c=Math.cos(pitch);
    return {right:[z,0,-x],up:[-x*s,c,-z*s],normal:[x*c,s,z*c]};
  }

  function paintedScenery(settings, width, height, maps) {
    const { bands, base, depthPaint = [], lightPaint = [] } = settings ?? {};
    const names = bands && typeof bands === 'object' && !Array.isArray(bands) ? Object.keys(bands) : [];
    if (!names.length || names.length > 16 || names.some(name => !name.trim() || !Number.isFinite(bands[name])) ||
        !names.includes(base) || width*height > 4e6)
      throw new RangeError('Painted scenery needs 1–16 named depth bands, a base band and a bounded image');
    if (maps.depth) throw new TypeError('Painted scenery uses depth bands in place of a depth image');
    if (![depthPaint, lightPaint].every(paint => Array.isArray(paint) && paint.length <= 512))
      throw new TypeError('Scenery paint needs lists of up to 512 strokes');
    const depths = names.map(name => bands[name]);
    const baseId = names.indexOf(base);
    const hex = values => '#' + values.map(value => value.toString(16).padStart(2, '0')).join('');
    const draw = (paint, color) => {
      const { shape } = paint ?? {};
      if (!shape || Object.keys(shape).some(key =>
          !['type', 'points', 'width', 'closed', 'rect', 'rings'].includes(key)))
        throw new TypeError('Scenery paint needs a pixel path, polygon or rectangle');
      return { ...shape, color };
    };
    const ids = depthPaint.length && drawing.paintMap(width, height, Array.from(depthPaint, paint => {
      const id = names.indexOf(paint?.band);
      if (id < 0) throw new RangeError('Unknown scenery band: ' + paint?.band);
      return draw(paint, hex([id, 0, 0]));
    }));
    if (lightPaint.length) {
      const normals = drawing.paintMap(width, height, Array.from(lightPaint, paint => {
        const normal = vector(paint?.normal, 'Painted normal');
        const length = positive(Math.hypot(...normal), 'Painted normal length');
        return draw(paint, hex(normal.map(value => Math.round((1 + value/length)*127.5))));
      }));
      if (!maps.normal) maps.normal = normals;
      else for (let i = 0; i < normals.length; i += 4)
        if (normals[i + 3]) maps.normal.set(normals.subarray(i, i + 4), i);
    }
    const bandAt = index => ids && ids[index + 3] ? ids[index] : baseId;
    const bounds = new Map();
    for (let i = 0; i < maps.color.length; i += 4) {
      if (!maps.color[i + 3]) continue;
      const id = bandAt(i), pixel = i / 4, x = pixel % width, y = Math.floor(pixel / width);
      const rect = bounds.get(id);
      if (rect) {
        rect[0] = Math.min(rect[0], x);
        rect[1] = Math.min(rect[1], y);
        rect[2] = Math.max(rect[2], x + 1);
        rect[3] = Math.max(rect[3], y + 1);
      } else bounds.set(id, [x, y, x + 1, y + 1]);
    }
    const planes = Object.freeze([...bounds].map(([id, bounds]) =>
      Object.freeze({ id, depth: depths[id], bounds: Object.freeze(bounds) })));
    return { bandAt, depths, planes };
  }

  function copyRgba(data, length, label) {
    if (!(Array.isArray(data)||(ArrayBuffer.isView(data)&&data.BYTES_PER_ELEMENT===1))||data.length!==length||
        (Array.isArray(data)&&!Array.from(data).every(n=>integer(n,0,255))))
      throw new TypeError(label+' needs a matching RGBA image');
    return Uint8Array.from(data);
  }

  function compile(source) {
    if (source?.[assetBrand]) return source;
    const { metadata:m,images }=source??{};
    const { width,height,scenery:painted,frames=painted===undefined?undefined:[{rect:{x:0,y:0,width,height}}],
      encodings={},normalSpace=typeof encodings.normal==='string'?'asset':'view',
      emissionMode=typeof encodings.emission==='string'?'baked':'add', depthFormat='rgb24' }=m??{};
    if (!integer(width,1,8192)||!integer(height,1,8192)||!Array.isArray(frames)||!frames.length||frames.length>32768)
      throw new RangeError('Sprite atlas needs valid dimensions and view frames');
    if (!['view','asset'].includes(normalSpace)||!['baked','add'].includes(emissionMode)||!['rgb24','gray'].includes(depthFormat))
      throw new RangeError('Invalid sprite atlas map encoding');
    const names=['color','depth','normal','emission','silhouette'];
    const pixels=width*height*names.filter(name=>images?.[name]).length;
    if (pixels>32e6)
      throw new RangeError('Sprite atlas exceeds its pixel budget');
    const maps={};
    for (const name of names) {
      const data=images?.[name];
      if (!data&&name!=='color') continue;
      maps[name]=copyRgba(data,width*height*4,'Sprite atlas '+name);
    }
    const {cels:sourceCels,...settings}=m;
    const sourceMaps={...maps}, metadata=structuredClone(settings);
    delete metadata.files;
    if (painted?.lightPaint?.length && maps.normal) maps.normal=maps.normal.slice();
    const scenery=painted===undefined?null:paintedScenery(painted,width,height,maps);
    const range=encodings.depth?.range??m.depthRange;
    if (maps.depth && range===undefined && !maps.depth.some((n,i)=>i%4===3&&n)) delete maps.depth;
    const validRange=Array.isArray(range)&&range.length===2&&Array.from(range).every(Number.isFinite)&&range[1]>=range[0];
    if (maps.depth&&!validRange) throw new RangeError('Sprite atlas depth needs a finite increasing range');
    const depthLo=range?.[0]??0, depthSpan=(range?.[1]??0)-depthLo;
    const legacyOrigin = typeof encodings.depth?.encoding==='string' && range ?
      .5*range[0]+.5*range[1] : 0;
    const groups=new Map(), timing=[], fps=m.fps??12;
    for (const entry of frames) {
      const {frame=0,direction,yaw=0,pitch=m.pitch??0,rect,unitsPerPixel=m.unitsPerPixel??1,
        depthOrigin=m.depthOrigin??legacyOrigin}=entry??{};
      const {x,y,width:w,height:h}=rect??{};
      if (!integer(frame,0,32767)||!integer(x,0,width-1)||!integer(y,0,height-1)||
          !integer(w,1,width-x)||!integer(h,1,height-y))
        throw new RangeError('Sprite atlas view rectangle or frame is out of range');
      const pivot=entry.pivot??{x:w*.5,y:h*.5};
      const view={
        rect:{x,y,width:w,height:h}, pivot:{x:finite(pivot.x,'Sprite pivot X'),y:finite(pivot.y,'Sprite pivot Y')},
        unitsPerPixel:positive(unitsPerPixel,'Sprite units per pixel'), depthOrigin:finite(depthOrigin,'Sprite depth origin'),
        yaw:finite(yaw,'Sprite yaw'), pitch:finite(pitch,'Sprite pitch'), direction
      };
      view.basis=basis(view.yaw,view.pitch);
      if (!groups.has(frame)) groups.set(frame,[]);
      groups.get(frame).push(view);
      timing.push({frame,time:entry.time,duration:entry.duration});
    }
    if (scenery && m.cels !== undefined) throw new TypeError('Sprite cel edits apply to animated atlases');
    const edits=cels.prepare(sourceCels,groups,{
      width,color:maps.color,depthRange:validRange,copyRgba,pixelBudget:32e6-pixels
    });
    if (edits) {
      const {replacements,...celSettings}=sourceCels;
      metadata.cels=structuredClone(celSettings);
      if (replacements) {
        const edited=[...edits.edited.values()];
        metadata.cels.replacements=replacements.map(({images,...edit},index)=>({
          ...structuredClone(edit), images:edited[index].maps
        }));
      }
    }
    function select(frame,mode,direction) {
      const views=groups.get(frame??groups.keys().next().value);
      if (!views) throw new RangeError('Unknown sprite atlas frame: '+frame);
      const view=mode==='card'||mode==='scenery'?views[0]:
        views.reduce((best,view)=>dot(view.basis.normal,direction)>dot(best.basis.normal,direction)?view:best);
      return edits?.held.get(view)??view;
    }
    function sample(view,x,y,channels,out,band) {
      const index=((view.rect.y+y)*width+view.rect.x+x)*4;
      const edit=edits?.edited.get(view), patch=edit?.maps, texel=(y*view.rect.width+x)*4;
      const bakedAlpha=maps.color[index+3];
      const rgba=patch?.color??maps.color, colorIndex=patch?.color?texel:index;
      const a=rgba[colorIndex+3]/255;
      if (!a || band !== undefined && scenery.bandAt(index) !== band) return false;
      out.alpha=a;
      for (let c=0;c<3;c++) out.color[c]=rgba[colorIndex+c]/255;
      const depth=patch?.depth??maps.depth, d=patch?.depth?texel:index;
      const normal=patch?.normal??maps.normal, n=patch?.normal?texel:index;
      const emission=patch?.emission??maps.emission, e=patch?.emission?texel:index;
      out.depth=0;
      if (channels.depth) {
        if (scenery) out.depth=scenery.depths[scenery.bandAt(index)];
        else if (depth?.[d+3] && (!edit || bakedAlpha || patch.depth))
          out.depth=depthLo+depthSpan*(depthFormat==='gray'?depth[d]/255:
            (depth[d]*65536+depth[d+1]*256+depth[d+2])/0xffffff)-view.depthOrigin;
        else if (!bakedAlpha && edit) out.depth=edit.extensionDepth??0;
      }
      out.hasNormal=!!(normal?.[n+3] && (bakedAlpha || patch?.normal));
      out.hasEmission=!!(channels.emission&&emission?.[e+3]&&(bakedAlpha||patch?.emission));
      if (out.hasNormal) for (let c=0;c<3;c++) out.normal[c]=normal[n+c]/127.5-1;
      if (out.hasEmission) {
        const gain=emissionMode==='baked'?255/(patch?.emission?rgba[colorIndex+3]:bakedAlpha):emission[e+3]/255;
        for(let c=0;c<3;c++) out.emission[c]=Math.min(1,emission[e+c]/255*gain);
      } else out.emission.fill(0);
      return true;
    }
    function effect(view) {
      const edit=edits?.edited.get(view), image=edit?.maps.effect;
      if (!image) return null;
      return {
        depth:edit.effectDepth,
        sample(x,y,out) {
          const i=(y*view.rect.width+x)*4, alpha=image[i+3];
          if (!alpha) return 0;
          for (let c=0;c<3;c++) out[c]=image[i+c]/255;
          return alpha/255;
        }
      };
    }
    const editedDepth=edits&&Array.from(edits.edited.values()).some(edit=>edit.maps.depth||edit.extensionDepth!==undefined);
    return Object.freeze({[assetBrand]:true,select,sample,effect,playback:mode=>cels.playback(timing,fps,mode),
      snapshot:()=>({metadata:structuredClone(metadata),images:structuredClone(sourceMaps)}),
      normalSpace,emissionMode,hasDepth:Boolean(maps.depth||scenery||editedDepth),sceneryPlanes:scenery?.planes});
  }

  function place(value) {
    if (value?.[placedBrand]) return value;
    const { atlas,at,mode,yaw=0,scale=1,opacity=1,frame,playback,depth=true,lighting=true,emission=true,objectId,materialId }=value??{};
    const asset=compile(atlas), placementMode=mode===undefined?(asset.sceneryPlanes?'scenery':'impostor'):mode;
    if (!['card','impostor','scenery'].includes(placementMode)||placementMode==='scenery'&&!asset.sceneryPlanes||!Number.isFinite(opacity)||opacity<0||opacity>1||
        [depth,lighting,emission].some(value=>typeof value!=='boolean')||
        (frame!==undefined&&(playback!==undefined||typeof frame!=='function'&&!integer(frame,0,32767))))
      throw new RangeError('Invalid sprite atlas placement');
    if (objectId!==undefined || materialId!==undefined) {
      const selectors = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
      if (objectId!==undefined) selectors.prepare({object:objectId});
      if (materialId!==undefined) selectors.prepare({material:materialId});
    }
    const anchor=typeof at==='function'?at:Object.freeze(vector(at,'Sprite atlas anchor'));
    return Object.freeze({[placedBrand]:true, atlas:asset, at:anchor, mode:placementMode,
      yaw:finite(yaw,'Sprite placement yaw'), scale:positive(scale,'Sprite placement scale'),
      opacity,frame,depth,lighting,emission,...(playback!==undefined&&{frameAt:asset.playback(playback)}),...(objectId!==undefined&&{objectId}),...(materialId!==undefined&&{materialId}) });
  }
  function placements(authored,override) {
    const source=override===true?authored:override??authored;
    if (source===false||source===undefined) return [];
    if (!Array.isArray(source)||source.length>128) throw new TypeError('Sprite atlases need a list of up to 128 placements');
    return source.map(place);
  }

  return Object.freeze({compile,place,placements,basis,dot,vector});
})();
if (typeof module !== 'undefined') module.exports = AtlasSprites;
