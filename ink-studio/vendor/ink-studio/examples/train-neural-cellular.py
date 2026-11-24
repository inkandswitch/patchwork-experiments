"""Train a small Ink Studio local rule on transparent pigment artwork."""
import argparse
import json
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

SIZE = 23
CHANNELS = ['red', 'green', 'blue', 'alpha', *(f'latent-{n}' for n in range(1, 7))]
FILTERS = ['identity', 'sobelX', 'sobelY']
SEED_STATE = [0, 0, 0, *([1] * (len(CHANNELS) - 3))]
Y, X = np.indices((SIZE, SIZE), dtype=np.float32) - SIZE // 2


def harbor_mark():
    def segment(x1, y1, x2, y2):
        dx, dy = x2 - x1, y2 - y1
        along = np.clip(((X - x1) * dx + (Y - y1) * dy) / (dx * dx + dy * dy), 0, 1)
        return np.hypot(X - x1 - along * dx, Y - y1 - along * dy)

    outline = np.minimum.reduce([segment(-6, 1, 0, 7), segment(0, 7, 6, 1),
                                 segment(6, 1, 3, -4), segment(-6, 1, -3, -4)])
    crest = np.minimum(segment(-3, -4, 0, -7), segment(0, -7, 3, -4))
    fork = np.minimum.reduce([segment(0, 3, 0, -2), segment(0, -1, -3, 2), segment(0, -1, 3, 2)])
    target = np.zeros((SIZE, SIZE, 4), np.float32)
    for distance, radius, color in [(outline, 1.25, [.09, .69, .68]), (crest, 1.25, [.99, .65, .23]),
                                    (fork, 1.15, [1., .79, .36])]:
        alpha = np.clip((radius + .32 - distance) / .65, 0, 1)
        target[:, :, :3] = target[:, :, :3] * (1 - alpha[..., None]) + alpha[..., None] * np.array(color)
        target[:, :, 3] = np.maximum(target[:, :, 3], alpha)
    target[:, :, 3] = np.where(target[:, :, 3] < .07, 0., target[:, :, 3])
    target[:, :, :3] *= (target[:, :, 3] > 0)[..., None]
    return target


def load_art(path):
    from PIL import Image

    with Image.open(path) as source:
        image = source.convert('RGBA')
    image.thumbnail((19, 19), Image.Resampling.NEAREST)
    canvas = Image.new('RGBA', (SIZE, SIZE))
    canvas.paste(image, ((SIZE - image.width) // 2, (SIZE - image.height) // 2))
    data = np.asarray(canvas, dtype=np.float32) / 255
    if np.max(data[..., 3]) <= .1:
        raise ValueError('Artwork needs visible alpha')
    data[..., :3] *= data[..., 3:4]
    return data


class LocalRule(nn.Module):
    def __init__(self, device):
        super().__init__()
        count = len(CHANNELS)
        kernels = torch.tensor([[[0, 0, 0], [0, 1, 0], [0, 0, 0]],
                                [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]],
                                [[-1, -2, -1], [0, 0, 0], [1, 2, 1]]], dtype=torch.float32, device=device)
        kernels[1:] *= .125
        self.register_buffer('kernels', kernels[:, None].repeat(count, 1, 1, 1))
        self.hidden = nn.Linear(count * len(FILTERS), 48, device=device)
        self.delta = nn.Linear(48, count, device=device)
        nn.init.zeros_(self.delta.weight)
        nn.init.zeros_(self.delta.bias)

    def living(self, cells):
        alpha = cells[..., 3].unsqueeze(1)
        return F.max_pool2d(alpha, 3, 1, 1).permute(0, 2, 3, 1) > .1

    def forward(self, cells):
        signal = F.conv2d(cells.permute(0, 3, 1, 2), self.kernels, padding=1, groups=len(CHANNELS))
        local = signal.permute(0, 2, 3, 1).contiguous()
        change = self.delta(F.relu(self.hidden(local)))
        next_cells = (cells + change * (torch.rand_like(cells[..., :1]) < .5)) * self.living(cells)
        return next_cells * self.living(next_cells)

    def export(self):
        def layer(values):
            return {'bias': values.bias.detach().cpu().tolist(), 'weights': values.weight.detach().flatten().cpu().tolist()}

        return {'format': 'ink-studio/neural-cellular', 'version': 1, 'channels': CHANNELS,
                'perception': FILTERS, 'alpha': 'alpha', 'aliveThreshold': .1, 'updateRate': .5,
                'seedState': SEED_STATE, 'hidden': layer(self.hidden), 'delta': layer(self.delta)}


def train(args):
    torch.set_num_threads(args.threads)
    torch.manual_seed(args.seed)
    random = np.random.default_rng(args.seed)
    device = args.device if args.device != 'auto' else ('mps' if torch.backends.mps.is_available() else 'cpu')
    target = torch.tensor(load_art(args.target) if args.target else harbor_mark(), device=device)[None]
    seed = torch.zeros((SIZE, SIZE, len(CHANNELS)), device=device)
    seed[SIZE // 2, SIZE // 2] = torch.tensor(SEED_STATE, device=device)
    model = LocalRule(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=.002)
    pool = seed.repeat(96, 1, 1, 1)

    def loss(cells):
        return ((cells[..., :4] - target).square() * (1 + 1.4 * target[..., 3:4])).mean((1, 2, 3))

    def erase(cells, at, radius):
        x, y = at
        cells[torch.tensor((X - x) ** 2 + (Y - y) ** 2 < radius ** 2, device=device)] = 0

    def grow(cells, ticks):
        for _ in range(ticks):
            cells = model(cells)
        return cells

    def evaluate():
        grown = grow(seed.repeat(3, 1, 1, 1), 76)
        before = loss(grown).mean().item()
        for cells, wound in zip(grown, [(2.2, -4.2, 4.2), (-3.8, 2.7, 4.3), (-3.3, -4.5, 4.4)]):
            erase(cells, wound[:2], wound[2])
        after = loss(grow(grown, 58)).mean().item()
        return before, after

    lowest = float('inf')
    for step in range(1, args.steps + 1):
        selected = random.choice(len(pool), 5, replace=False)
        with torch.no_grad():
            cells = pool[selected].clone()
            order = torch.argsort(loss(cells), descending=True)
            selected = selected[order.cpu().numpy()]
            cells = cells[order]
            cells[0] = seed
            if step > 425 and step % 2 == 0:
                for sample in cells[1:3]:
                    erase(sample, random.uniform(-6.6, 6.6, size=2), random.uniform(2.3, 5.0))
        cells = grow(cells, int(random.integers(31, 49)))
        error = loss(cells).mean() + .03 * (cells.abs() - 5).clamp(min=0).mean()
        optimizer.zero_grad(set_to_none=True)
        error.backward()
        with torch.no_grad():
            for parameter in model.parameters():
                parameter.grad.div_(parameter.grad.norm() + 1e-8)
            pool[selected] = cells.detach()
        optimizer.step()
        if step in (1150, 1750):
            for group in optimizer.param_groups:
                group['lr'] *= .55
        if step % 100 == 0 or step == args.steps:
            with torch.no_grad():
                grown, repaired = evaluate()
            print(f'{step:4d}  growth {grown:.5f}  repair {repaired:.5f}', flush=True)
            if grown + repaired < lowest:
                lowest = grown + repaired
                args.out.write_text(json.dumps(model.export(), indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', type=Path, help='Transparent image. Defaults to the original Harbor Mark.')
    parser.add_argument('--out', type=Path, required=True, help='Path for the exported JSON weights.')
    parser.add_argument('--steps', type=int, default=2300)
    parser.add_argument('--seed', type=int, default=239)
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--device', choices=['auto', 'cpu', 'mps'], default='auto')
    options = parser.parse_args()
    if min(options.steps, options.threads) < 1:
        parser.error('steps and threads must be positive')
    train(options)
