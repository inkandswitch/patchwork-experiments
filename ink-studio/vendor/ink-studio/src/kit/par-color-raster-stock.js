/* Palette and color operations for versioned raster graphs. */
(function (K) {
  const P = K.procedural, R = P.rasterColor;
  const options = {type:'record',default:{}};
  R.operations = Object.freeze({
    'palette.recipe': {
      inputs:{definition:'record'},outputs:{value:'palette',roles:'record'},
      run({definition}) {
        const {palette,roles}=K.palette.recipe(definition);
        return {value:{palette,roles},roles};
      }
    },
    'palette.resolve': {
      inputs:{source:'raster',policy:'record',options},outputs:{value:'raster',indices:'raster',palette:'palette'},
      run({source,policy,options}) { return R.resolve(source,policy,options); }
    },
    'color.look': {
      inputs:{source:'raster',pack:'any',binding:'any',options},outputs:{value:'raster',metadata:'record'},time:true,
      run({source,pack,binding,options},{time}) { return R.look(source,pack,binding,{...options,time}); }
    },
    'color.gradient': {
      inputs:{source:'raster',ramp:'any',options},outputs:{value:'raster'},time:true,
      run({source,ramp,options},{time}) { return {value:R.gradient(source,ramp,{...options,time})}; }
    },
    'color.stack': {
      inputs:{source:'raster',stack:'record',options},outputs:{value:'raster'},
      run({source,stack,options}) { return {value:R.stack(source,stack,options)}; }
    },
    'color.channels': {
      inputs:{source:'raster',options},outputs:{value:'raster'},
      run({source,options}) { return {value:R.channels(source,options)}; }
    },
    'color.key': {
      inputs:{source:'raster',options},outputs:{value:'raster',matte:'raster'},
      run({source,options}) { return R.key(source,options); }
    },
    'color.replace': {
      inputs:{source:'raster',rules:'array<record>',options},outputs:{value:'raster'},
      run({source,rules,options}) { return {value:R.replace(source,rules,options)}; }
    }
  });
  delete P.rasterColorSupport;
  Object.freeze(R);
})(KIT);
