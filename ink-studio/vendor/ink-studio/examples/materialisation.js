/* Real fragments leave a skinned sculpture, gather into live forms, then rejoin it. */
function materialisationScene({ makeBuilder, makeSculpt, KIT: K, TexturedSurface, SpriteSurface }) {
  return {
    id: 'materialisation',
    name: 'The matter relay',
    seed: 47,
    build(seed) {
      const { V } = K,
        pal = [
          0x080f1b, 0x14243a, 0x234359, 0x35647b, 0x498d9f, 0x7cc7ce, 0xc7f5e5, 0x352b37, 0x6c4a43, 0xa66a4a, 0xdf9b5c,
          0xffd38b, 0xffefd1, 0x1e2c39, 0x405260, 0x7a8b91
        ];
      const B = makeBuilder(seed, pal),
        S = K.sculpt(makeSculpt(B));
      S.pixel = true;
      S.pixelSize(28);
      S.sun = V.norm([-0.7, 0.8, 0.5]);
      S.amb = 0.3;
      S.sky = 0.24;
      S.sunK = 0.75;
      S.aoK = 0.25;
      const stone = K.pixel.masonry({ r: [1, 2, 3, 4], joint: 1, stone: [7, 5], seed }),
        dark = { r: [0, 1, 2] },
        metal = K.surface.preset('brushed-brass', { r: [7, 8, 9, 10] });
      S.box([0, -0.18, 0], [5.8, 0.25, 2.2], dark, { res: 0.16, rd: 0.12 });
      for (const x of [-2.7, 2.7]) {
        S.box([x, 0.05, 0], [1.04, 0.12, 0.85], stone, { res: 0.09, rd: 0.08 });
        S.box([x, 0.18, 0], [0.89, 0.065, 0.72], dark, { res: 0.08, rd: 0.04 });
      }
      for (const z of [-1.95, 1.95])
        for (const x of [-5.2, 5.2]) S.box([x, 0.02, z], [0.21, 0.32, 0.2], metal, { res: 0.08, rd: 0.035 });
      const groups = {};
      const previous = S.emit;
      S.emit = (pr, first, end) => {
        previous?.(pr, first, end);
        if (pr.tag) {
          groups[pr.tag] ??= [];
          for (let i = first; i < end; i++) groups[pr.tag].push(i);
        }
      };
      const sculpt = (name, fn) => {
        fn(name);
      };
      const CX = -2.7,
        body = { r: [1, 2, 3, 4, 5] },
        glow = { r: [4, 5, 6], em: true };
      sculpt('torso', tag => {
        S.box([CX, 1.44, 0], [0.34, 0.49, 0.16], body, { tag, res: 0.065, rd: 0.1 });
        S.box([CX, 1.69, 0.173], [0.19, 0.055, 0.025], glow, { tag, res: 0.045 });
      });
      sculpt('head', tag => {
        S.box([CX, 2.14, 0], [0.26, 0.26, 0.22], body, { tag, res: 0.055, rd: 0.085 });
        S.box([CX, 2.17, 0.225], [0.18, 0.055, 0.025], glow, { tag, res: 0.04, rd: 0.015 });
      });
      for (const sign of [-1, 1]) {
        sculpt(sign < 0 ? 'leftArm' : 'rightArm', tag => {
          S.tube(
            [
              [CX + sign * 0.43, 1.79, 0],
              [CX + sign * 0.69, 1.21, 0.07]
            ],
            0.11,
            0.085,
            body,
            { tag, res: 0.06 }
          );
          S.ball([CX + sign * 0.69, 1.18, 0.07], [0.12, 0.14, 0.1], metal, { tag, res: 0.055 });
        });
        sculpt(sign < 0 ? 'leftLeg' : 'rightLeg', tag => {
          S.box([CX + sign * 0.18, 0.66, 0], [0.13, 0.32, 0.12], body, { tag, res: 0.065, rd: 0.04 });
          S.box([CX + sign * 0.18, 0.33, 0.075], [0.14, 0.09, 0.22], metal, { tag, res: 0.06, rd: 0.04 });
        });
      }
      for (const sign of [-1, 1])
        for (let i = 0; i < 6; i++)
          S.box([sign * (4.3 + i * 0.1), 0.47 + i * 0.23, -0.72], [0.09, 0.13, 0.16], i % 2 ? body : glow, {
            tag: sign < 0 ? 'edgeA' : 'edgeB',
            res: 0.055,
            rd: 0.01
          });
      S.bake();
      const atlas = SpriteSurface.make(256);
      atlas.mesh(
        TexturedSurface.heightfield({ bounds: [-5.65, 5.65, -2.05, 2.05], segments: [1, 1], height: () => 0.079 }),
        256,
        92,
        (i, j) => {
          const line = i % 16 === 0 || j % 16 === 0,
            tick = j > 80 && i % 4 === 0;
          return pal[tick ? 4 : line ? 2 : (i + j) % 29 === 0 ? 2 : 1];
        }
      );
      const font = {
        A: ['.##.', '#..#', '####', '#..#', '#..#'],
        E: ['####', '#...', '###.', '#...', '####'],
        I: ['###', '.#.', '.#.', '.#.', '###'],
        L: ['#...', '#...', '#...', '#...', '####'],
        M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
        O: ['.##.', '#..#', '#..#', '#..#', '.##.'],
        R: ['###.', '#..#', '###.', '#.#.', '#..#'],
        S: ['.###', '#...', '.##.', '...#', '###.'],
        T: ['#####', '..#..', '..#..', '..#..', '..#..'],
        Y: ['#...#', '.#.#.', '..#..', '..#..', '..#..']
      };
      function label(text, x, y, z, color) {
        let cursor = 0;
        for (const ch of text) {
          const rows = font[ch] ?? ['....', '....', '....', '....', '....'];
          for (let j = 0; j < 5; j++)
            for (let i = 0; i < rows[j].length; i++)
              if (rows[j][i] === '#')
                B.disc(x + (cursor + i) * 0.037, y + (4 - j) * 0.037, z, [0, 0, 1], 0.024, 0.006, B.P[color], 2.8, {
                  em: true
                });
          cursor += rows[0].length + 1;
        }
      }
      label('MATTER', -3.3, 0.28, 1.12, 5);
      label('RELAY', 2.15, 0.28, 1.12, 10);
      const W = B.finish({
          spriteSurfaces: atlas.finish(),
          cam: { target: [0, 1.1, 0], dist: 11.8, yaw: 0.18, pitch: 0.32, ortho: true },
          detail: 30,
          dither: 0.08,
          radius: 8,
          look: { pixel: true, native: true }
        }),
        stage = K.stage(W);
      const parts = {
        torso: { ids: groups.torso, pivot: [CX, 1.15, 0] },
        head: { ids: groups.head, parent: 'torso', pivot: [CX, 1.9, 0] },
        leftArm: { ids: groups.leftArm, parent: 'torso', pivot: [CX - 0.43, 1.79, 0] },
        rightArm: { ids: groups.rightArm, parent: 'torso', pivot: [CX + 0.43, 1.79, 0] },
        leftLeg: { ids: groups.leftLeg, parent: 'torso', pivot: [CX - 0.18, 0.98, 0] },
        rightLeg: { ids: groups.rightLeg, parent: 'torso', pivot: [CX + 0.18, 0.98, 0] }
      };
      function pose(t, dt, p) {
        p.pose.torso = { pos: [0, 0.035 * Math.sin(t * 1.3), 0], rot: [0, 7 * Math.sin(t * 0.7), 0] };
        p.pose.head = { rot: [2 * Math.sin(t), -15 * Math.sin(t * 0.65), 0] };
        p.pose.leftArm = { rot: [8 * Math.sin(t), 0, -7 - 5 * Math.sin(t * 0.9)] };
        p.pose.rightArm = { rot: [8 * Math.sin(t + 2), 0, 7 + 5 * Math.sin(t * 0.9)] };
      }
      const puppet = K.puppet(W, { parts, pose });
      const ids = Object.values(parts).flatMap(p => p.ids),
        home = K.materialisation.anchors.splats(stage, ids, {
          pose(t) {
            puppet.time = t;
            puppet.clear();
            pose(t, 0, puppet);
            puppet.flush();
          }
        });
      const eye = [];
      for (let j = -23; j <= 23; j++)
        for (let i = -43; i <= 43; i++) {
          const x = i * 0.027,
            y = j * 0.027,
            q = Math.abs(x) / 1.18 + (y / 0.58) ** 2;
          if (q > 1) continue;
          const r = Math.hypot(x, y * 1.15),
            angle = Math.atan2(y, x),
            iris = r < 0.49,
            pupil = r < 0.16;
          if (pupil) continue;
          const c = iris ? (Math.sin(angle * 45 + r * 83) > 0.15 ? 11 : 9) : q > 0.84 ? 11 : (i + j) % 5 === 0 ? 8 : 10;
          eye.push({
            position: [2.7 + x, 1.65 + y, 0.07 + 0.05 * Math.cos(r * 8)],
            normal: [0, 0, 1],
            color: K.materialisation.color('#' + pal[c].toString(16).padStart(6, '0'))
          });
        }
      const iris = K.materialisation.anchors.points(eye, {
        size: 0.016,
        alpha: 2.6,
        pose(out, t) {
          const x = out.position[0] - 2.7,
            y = out.position[1] - 1.65;
          out.position[2] += 0.035 * Math.sin(t * 2 + x * 4 + y * 2);
        }
      });
      const wing = [];
      for (let j = 0; j <= 30; j++)
        for (let i = -42; i <= 42; i++) {
          const x = i * 0.035,
            v = j / 30,
            r = Math.abs(x) / 1.5;
          if (r > 1) continue;
          const depth = 0.7 * (1 - r * r) + 0.08,
            z = (v - 0.5) * depth * 2;
          if (Math.abs(z) > 0.78) continue;
          const c = Math.abs(x) < 0.1 ? 6 : (i + j) % 9 === 0 ? 6 : (i + j) % 3 ? 4 : 5;
          wing.push({
            position: [2.7 + x, 1.65 + 0.22 * Math.cos(x * 1.4), z],
            color: K.materialisation.color('#' + pal[c].toString(16).padStart(6, '0'))
          });
        }
      const manta = K.materialisation.anchors.points(wing, {
        size: 0.022,
        alpha: 2.6,
        pose(out, t) {
          const x = out.position[0] - 2.7;
          out.position[1] += 0.28 * Math.abs(x) * Math.sin(t * 2.1);
          out.position[0] += 0.12 * Math.sin(t * 0.8);
        }
      });
      const wind = K.flow.sum(K.flow.wind([0.8, 0.12, 0.18]), K.flow.vortex([0, 1.3, 0], [0, 1, 0], 0.14, 8));
      const fx = stage.add(
        K.materialisation.bind(stage, {
          id: 'relay-body',
          ids,
          source: home,
          targets: { iris, manta },
          flow: wind,
          width: 0.01,
          length: 0.035,
          peel: 0.3,
          drag: 1.3,
          emissive: true,
          paths: [
            K.materialisation.paths.arc({ height: 0.5 }),
            K.materialisation.paths.vortex({ radius: 0.35, turns: 1.5 })
          ]
        })
      );
      const story = [
        { at: 1.2, action: 'release', options: { velocity: [0.7, 0.3, 0], stagger: 0.55, normalImpulse: 0.15 } },
        { at: 2.3, action: 'gather', target: 'manta', options: { duration: 2.1, stagger: 0.25 } },
        { at: 6.3, action: 'gather', target: 'iris', options: { duration: 1.7, stagger: 0.2 } },
        { at: 10, action: 'rejoin', options: { duration: 2.6, stagger: 0.3 } }
      ];
      fx.timeline(story, { loop: 15 });
      const edge = [];
      for (const [k, name] of ['edgeA', 'edgeB'].entries()) {
        const effect = stage.add(
          K.materialisation.bind(stage, {
            id: name,
            ids: groups[name],
            flow: K.flow.wind([k ? -0.7 : 0.7, 0.3, 0.1]),
            width: 0.008,
            length: 0.027,
            peel: 0.4,
            emissive: true
          })
        );
        effect.timeline(
          [
            { at: 0.5, action: 'release', options: { fraction: 0.42, stagger: 0.6, normalImpulse: 0.1 } },
            { at: 2.4, action: 'rejoin', options: { duration: 1.8, stagger: 0.3 } }
          ],
          { loop: 5.5 }
        );
        edge.push(effect);
      }
      let saved;
      W.materialisationDemo = {
        fx,
        edge,
        puppet,
        story,
        stage,
        auto: true,
        play() {
          this.auto = true;
          fx.reset();
          fx.timeline(story, { loop: 15 });
        },
        command(name) {
          this.auto = false;
          fx.timeline([]);
          if (name === 'drift') fx.release({ stagger: 0.4, velocity: [0.6, 0.2, 0] });
          else if (name === 'home') fx.rejoin({ duration: 2, stagger: 0.3 });
          else if (name === 'dissolve') fx.dissolve({ duration: 1.2, stagger: 0.4 });
          else fx.gather(name, { duration: 2, stagger: 0.3 });
        },
        save() {
          saved = { state: fx.snapshot(), auto: this.auto };
        },
        restore() {
          if (saved) {
            fx.reset();
            fx.timeline(saved.auto ? story : [], saved.auto ? { loop: 15 } : {});
            this.auto = saved.auto;
            fx.restore(saved.state);
          }
        },
        reset() {
          fx.reset();
          for (const s of edge) s.reset();
        },
        advance(seconds) {
          for (const s of [fx, ...edge]) s.advance(seconds);
        }
      };
      return W;
    }
  };
}
if (typeof module !== 'undefined') module.exports = materialisationScene;
