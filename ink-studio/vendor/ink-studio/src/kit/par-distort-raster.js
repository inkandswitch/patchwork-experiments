/* Versioned graph entry points for warps, independently timed pixels and projections. */
(function(P) {
  const W=P.rasterWarp, {prepareTime}=P.rasterWarpSupport;
  const options={type:'record',default:{}}, mapped={value:'raster',field:'raster'};
  W.operations=Object.freeze({
    'warp.field':{
      inputs:{width:'number',height:'number',matrix:{type:'array<vec3>',default:[[1,0,0],[0,1,0]]}},
      outputs:{value:'raster'},run(input){return {value:W.field(input)};}
    },
    'warp.sample':{
      inputs:{source:'raster',field:'raster',options},outputs:{value:'raster'},
      run({source,field,options}){return {value:W.sample(source,field,options)};}
    },
    'warp.mesh':{
      inputs:{source:'raster',control:'record',options},outputs:mapped,
      run({source,control,options}){return W.mesh(source,control,options);}
    },
    'warp.grid':{
      inputs:{source:'raster',control:'record',options},outputs:mapped,
      run({source,control,options}){return W.grid(source,control,options);}
    },
    'warp.polar':{
      inputs:{source:'raster',options},outputs:mapped,
      run({source,options}){return W.polar(source,options);}
    },
    'warp.displace':{
      inputs:{source:'raster',map:'raster',options},outputs:mapped,
      run({source,map,options}){return W.displace(source,map,options);}
    },
    'warp.refract':{
      inputs:{source:'raster',map:'raster',options},outputs:mapped,
      run({source,map,options}){return W.refract(source,map,options);}
    },
    'warp.morph':{
      inputs:{a:'raster',b:'raster',control:'record',amount:{type:'number',default:.5},options},outputs:{value:'raster'},
      run({a,b,control,amount,options}){return {value:W.morph(a,b,control,amount,options)};}
    },
    'warp.frames':{
      inputs:{source:'any',options},outputs:{value:'array<raster>',fps:'number',times:'array<number>',loop:'boolean'},
      run({source,options}){return W.frames(source,options);}
    },
    'warp.timeRemap':{
      inputs:{frames:'array<raster>',map:'raster',options},outputs:{value:'raster'},time:true,
      instantiate(){
        let prepared,priorFrames,priorOptions;
        return ({frames,map,options},{time})=>{
          if (!prepared || priorFrames!==frames || priorOptions!==options) {
            prepared=prepareTime(frames,options);
            priorFrames=frames; priorOptions=options;
          }
          return {value:prepared(map,time)};
        };
      }
    },
    'warp.surface':{
      inputs:{source:'raster',mesh:'mesh',options},outputs:{value:'record'},
      run({source,mesh,options}){return {value:W.surface(source,mesh,options)};}
    },
    'warp.project':{
      inputs:{source:'raster',options},outputs:{value:'record'},
      run({source,options}){return {value:W.project(source,options)};}
    }
  });
  delete P.rasterWarpSupport;
  Object.freeze(W);
})(KIT.procedural);
