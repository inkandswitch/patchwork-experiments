const fs = require('node:fs'),
  path = require('node:path');
module.exports = function hierarchyCLI(pos, opt, kit) {
  if (!pos[0]) throw Error('hierarchy needs a graph JSON file');
  const input = JSON.parse(fs.readFileSync(path.resolve(pos[0]), 'utf8')),
    graph = kit.KIT.sceneGraph.create(input.definition ?? input);
  if (opt.parent !== undefined) {
    if (!opt.node) throw Error('--parent requires --node');
    graph.reparent(
      String(opt.node),
      opt.parent === 'world' ? null : { node: String(opt.parent), ...(opt.socket && { socket: String(opt.socket) }) },
      { keepWorld: !opt['keep-local'] }
    );
  }
  const definition = graph.snapshot(),
    report = { definition, frames: Object.fromEntries(graph.ids().map(id => [id, graph.frame(id)])) };
  if (opt.node) {
    report.node = graph.node(String(opt.node));
    if (opt.point !== undefined) {
      const p = String(opt.point).split(',').map(Number);
      report.point = opt['to-local'] ? graph.toLocal(String(opt.node), p) : graph.toWorld(String(opt.node), p);
    }
  }
  const json = JSON.stringify(report, null, 2) + '\n';
  if (opt.out) {
    const file = path.resolve(String(opt.out));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, json);
  } else process.stdout.write(json);
};
