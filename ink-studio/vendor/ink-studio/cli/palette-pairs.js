const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');

module.exports = function palettePairsCLI(files, options, {KIT:K}, outputFile) {
  const flags = ['sort','max-distance','max-lightness','limit','columns','scale','out'];
  if (files.length !== 1 || Object.entries(options).some(([key,value])=>!flags.includes(key) || typeof value!=='string'))
    throw new TypeError('Use palette pairs <palette.json> [--sort distance|lightness] [--max-distance .035] ' +
      '[--max-lightness .02] [--limit 12] [--scale 16] [--out directory]');
  const source = path.resolve(files[0]);
  const data = JSON.parse(fs.readFileSync(source,'utf8'));
  const number = key=>options[key] === undefined ? undefined : Number(options[key]);
  const scale = number('scale') ?? 16;
  const review = K.palette.reviewPairs({
    palette:Array.isArray(data) ? data : data?.palette,
    sort:options.sort,
    maxDistance:number('max-distance'),maxLightnessDelta:number('max-lightness'),
    limit:number('limit'),columns:number('columns')
  });
  const directory = outputFile('palette-pairs');
  const filesOut = { report:'pairs.json', native:'native.png', viewing:'view.png' };
  const original = fs.statSync(source,{bigint:true});
  for (const file of Object.values(filesOut)) {
    const prior = fs.statSync(path.join(directory,file),{bigint:true,throwIfNoEntry:false});
    if (prior && prior.dev === original.dev && prior.ino === original.ino)
      throw new Error('Palette pair outputs must use separate files from the input palette');
  }
  const native = review.preview(), viewing = review.preview(scale);
  const describe = (kind,image,scale)=>({file:filesOut[kind],width:image.w,height:image.h,scale});
  const report = { ...review.report, previews:{native:describe('native',native,1),viewing:describe('viewing',viewing,scale)} };
  fs.mkdirSync(directory,{recursive:true});
  for (const [kind,image] of [['native',native],['viewing',viewing]])
    PNG.write(path.join(directory,filesOut[kind]),image.w,image.h,image.rgb,image.alpha);
  fs.writeFileSync(path.join(directory,filesOut.report),JSON.stringify(report,null,2)+'\n');
  const {duplicate,close} = report.counts;
  console.log('wrote',directory,'with',duplicate,'duplicate pairs and',close,'close pairs');
};
