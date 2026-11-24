const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');

function readDefinition(file) {
  const source = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  if (!source || Object.getPrototypeOf(source) !== Object.prototype)
    throw new TypeError('A dither fit file needs a JSON object');
  return source;
}

function writeRaster(file, raster) {
  PNG.writeIndexed(file, raster.width, raster.height, raster.slots,
    raster.palette.map(swatch => [1, 3, 5].map(i => parseInt(swatch.slice(i, i + 2), 16))));
}

function fit(files, { format = 'png', out, tile }, { KIT: K }, outputFile) {
  if (files.length !== 1 || !['png', 'data'].includes(format) ||
      out !== undefined && typeof out !== 'string' || tile !== undefined && (tile !== true || format !== 'png'))
    throw new TypeError('Use palette fit <fit.json> [--format png|data] [--tile] [--out file]');
  const { context, ...definition } = readDefinition(files[0]);
  const result = K.palette.fitDither(definition, context);
  if (format === 'data') {
    const json = JSON.stringify({ ...result.report, raster: result.indexed() }) + '\n';
    if (!out) return process.stdout.write(json);
    const file = outputFile('dither-fit.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, json);
    return;
  }
  const raster = tile ? result.indexed() : result.preview();
  const file = outputFile(tile ? 'dither-tile.png' : 'dither-fit.png');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeRaster(file,raster);
  console.log('wrote', file, raster.width + 'x' + raster.height);
}

function review(files, options, { KIT: K }, outputFile) {
  if (files.length!==1 || Object.entries(options).some(([key,value])=>key!=='out' || typeof value!=='string'))
    throw new TypeError('Use palette dither-review <fit.json> [--out directory]');
  const {context,...definition}=readDefinition(files[0]);
  const result=K.palette.reviewDither(definition,context);
  const directory=outputFile('dither-review'), reportFile=path.join(directory,'review.json');
  const previews=result.report.pairs.filter(pair=>pair.status==='reviewed').map(pair=>({
    index:pair.index,file:'pair-'+(pair.index+1)+'.png'
  }));
  const input=fs.statSync(path.resolve(files[0]));
  for (const file of [reportFile,...previews.map(preview=>path.join(directory,preview.file))]) {
    const existing=fs.statSync(file,{throwIfNoEntry:false});
    if (existing && input.dev===existing.dev && input.ino===existing.ino)
      throw new RangeError('Choose output files separate from the dither review definition');
  }
  fs.mkdirSync(directory,{recursive:true});
  for (const {index,file} of previews) writeRaster(path.join(directory,file),result.preview(index));
  fs.writeFileSync(reportFile,JSON.stringify({...result.report,previews},null,2)+'\n');
  console.log('wrote',reportFile,'and',previews.length,'native previews');
}

module.exports = { fit, review };
