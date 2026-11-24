const fs = require('node:fs'),
  path = require('node:path');
module.exports = (pos, opt, { KIT: K }) => {
  if (!pos[0]) throw new Error('render-graph needs a graph JSON file');
  const graph = K.renderGraph.prepare(JSON.parse(fs.readFileSync(path.resolve(pos[0]), 'utf8')));
  if (!graph) throw new Error('Expected an enabled graph definition');
  const report = K.renderGraph.resources(graph, +(opt.w ?? 900), +(opt.h ?? 620));
  const json = JSON.stringify(report, null, 2) + '\n';
  if (opt.out) {
    const out = path.resolve(opt.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, json);
    console.log('wrote ' + out);
  } else process.stdout.write(json);
};
