#!/usr/bin/env python3
"""Pack a cut-point block export for the browser and upload to HF:
  - block_weights_fp32.npz → block.bin (fp16, concatenated) + block.json (manifest)
  - upload q8 ONNX + config/tokenizer + block.bin + block.json + README
Usage: pack_block.py <block_dir> <repo_id>
"""
import json
import os
import sys

import numpy as np
from huggingface_hub import HfApi, get_token

d = sys.argv[1]
repo = sys.argv[2]
npz = np.load(os.path.join(d, "block_weights_fp32.npz"))
order = ["n2w", "Wgate", "Wup", "Wdown", "nfw", "Wlm"]

manifest = {}
offset = 0
chunks = []
for name in order:
    flat = npz[name].astype(np.float16).reshape(-1)
    manifest[name] = {"shape": list(npz[name].shape), "offset": offset, "count": int(flat.size)}
    chunks.append(flat.tobytes())
    offset += flat.size
blob = b"".join(chunks)
open(os.path.join(d, "block.bin"), "wb").write(blob)
json.dump({"dtype": "float16", "order": order, "tensors": manifest}, open(os.path.join(d, "block.json"), "w"))
print(f"block.bin {len(blob) / 1e6:.0f} MB; tensors:", {k: v["shape"] for k, v in manifest.items()})

cfg = json.load(open(os.path.join(d, "config.json")))
open(os.path.join(d, "README.md"), "w").write(f"""---
library_name: transformers.js
tags: [onnx, transformers.js, lora, choochoo]
---

# {os.path.basename(d)} — cut-point ONNX (choochoo rung 2)

Prefill-only ONNX with an extra **`cut_hidden`** output (x1 = the residual stream
just before the LAST block's MLP), plus **`block.bin`/`block.json`** — the frozen
last-block MLP + both norms + the head, fp16 — so a LoRA adapter can be trained on
the last block's MLP in the browser.

- ONNX outputs: `logits`, `cut_hidden [batch, seq, {cfg['hidden_size']}]`
- block.json lists fp16 tensors n2w, Wgate, Wup, Wdown, nfw, Wlm (concatenated in block.bin)
- dtype: q8 (`onnx/model_quantized.onnx`)
""")

api = HfApi(token=get_token())
api.create_repo(repo, repo_type="model", exist_ok=True, private=False)
api.upload_folder(
    repo_id=repo, folder_path=d, repo_type="model",
    allow_patterns=["*.json", "*.txt", "*.jinja", "*.md", "onnx/model_quantized.onnx", "block.bin"],
    commit_message="cut-point ONNX (q8) + frozen block weights (fp16) for choochoo rung 2",
)
print("UPLOAD DONE -> https://huggingface.co/" + repo)
