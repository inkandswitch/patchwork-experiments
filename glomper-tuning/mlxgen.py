#!/usr/bin/env python
"""Greedy-generate from a base (+ optional LoRA adapter) using the mlx_lm API.
The mlx_lm.generate CLI mangles our long raw-continuation prompt (chat-template
quirk -> 0 tokens); the API path is clean. Prompt is read from stdin.

Usage:  echo "<prompt>" | mlxgen.py <base-or-merged> <adapter|-> <max_tokens>
"""
import sys

from mlx_lm import generate, load
from mlx_lm.sample_utils import make_sampler

base = sys.argv[1]
adapter = sys.argv[2]
max_tokens = int(sys.argv[3]) if len(sys.argv) > 3 else 400
prompt = sys.stdin.read()

model, tok = load(base, adapter_path=(None if adapter in ("", "-") else adapter))
out = generate(
    model, tok, prompt=prompt, max_tokens=max_tokens,
    sampler=make_sampler(temp=0.0), verbose=False,
)
print(out)
