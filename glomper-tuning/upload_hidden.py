#!/usr/bin/env python3
"""Upload a hidden-state ONNX export (browser files only) to the HF hub.
Usage: upload_hidden.py <model_dir> <repo_id>
"""
import json
import os
import sys

from huggingface_hub import HfApi, get_token

src = sys.argv[1]
repo = sys.argv[2]
cfg = json.load(open(os.path.join(src, "config.json")))
H, V = cfg.get("hidden_size"), cfg.get("vocab_size")

readme = f"""---
library_name: transformers.js
pipeline_tag: text-generation
tags: [onnx, transformers.js, lora, choochoo]
---

# {os.path.basename(src)} — hidden-state ONNX export

Prefill-only ONNX export that adds a `last_hidden_state` output (post-final-norm,
the input to `lm_head`) alongside `logits`, for training a LoRA adapter on the
output head in the browser (the choochoo tool).

- outputs: `logits [batch, seq, {V}]`, `last_hidden_state [batch, seq, {H}]`
- `lm_head(last_hidden_state) == logits`
- dtype: `q8` (`onnx/model_quantized.onnx`)

See `onnx_hidden.py`.
"""
open(os.path.join(src, "README.md"), "w").write(readme)

api = HfApi(token=get_token())
api.create_repo(repo, repo_type="model", exist_ok=True, private=False)
api.upload_folder(
    repo_id=repo,
    folder_path=src,
    repo_type="model",
    allow_patterns=["*.json", "*.txt", "*.jinja", "*.md", "onnx/model_quantized.onnx"],
    commit_message="hidden-state ONNX export (q8) for choochoo LoRA-on-head",
)
print("UPLOAD DONE -> https://huggingface.co/" + repo)
