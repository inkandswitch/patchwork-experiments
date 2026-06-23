#!/usr/bin/env python3
"""Export a *prefill-only* causal-LM to ONNX that ALSO outputs attention
weights — for building attention-visualizer explorables.

Unlike `./and onnx` (optimum, text-generation-with-past), this:
  - forces attn_implementation="eager"  (SDPA returns attentions=None)
  - runs with use_cache=False           (q_len == kv_len, clean shapes)
  - adds a named `attentions` output     [batch, layers, heads, seq, seq]

Outputs in transformers.js layout: config + tokenizer on top, weights under
onnx/ — so mkonnx.py / `./and upload` work on it unchanged.

Usage:
  python onnx_attn.py [model] [out_dir]
    model    HF id or local merged dir   (default: Qwen/Qwen3-0.6B)
    out_dir  destination                 (default: models/<name>-attn/onnx)

  LAYERS=0,13,27 python onnx_attn.py     # subset layers to shrink the output
"""
import os
import sys
import warnings

warnings.filterwarnings("ignore")
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

model_id = sys.argv[1] if len(sys.argv) > 1 else "Qwen/Qwen3-0.6B"
name = os.path.basename(model_id.rstrip("/")).lower()
out = sys.argv[2] if len(sys.argv) > 2 else f"models/{name}-attn/onnx"
od = os.path.join(out, "onnx")
os.makedirs(od, exist_ok=True)

# Optional layer subset (attentions are O(layers * heads * seq^2) — big for long
# prompts). Empty => all layers.
sel = os.environ.get("LAYERS", "").strip()
layers = [int(x) for x in sel.split(",")] if sel else None

print(f"▸ loading {model_id} (eager attention)")
tok = AutoTokenizer.from_pretrained(model_id)
model = AutoModelForCausalLM.from_pretrained(
    model_id,
    attn_implementation="eager",  # REQUIRED — sdpa/flash give no weights
    torch_dtype=torch.float32,
)
model.eval()
cfg = model.config
print(f"  {cfg.num_hidden_layers} layers, {cfg.num_attention_heads} heads")


class WithAttn(torch.nn.Module):
    def __init__(self, m, keep):
        super().__init__()
        self.m = m
        self.keep = keep

    def forward(self, input_ids, attention_mask):
        # Build the additive 4D causal mask ourselves with plain ops. transformers
        # 4.57's mask builder uses torch.vmap (torch>=2.5), which the ONNX tracer
        # can't follow; but create_causal_mask returns an already-4D mask as-is,
        # so we sidestep vmap entirely.
        b, q = input_ids.shape
        minv = torch.finfo(torch.float32).min
        idx = torch.arange(q, device=input_ids.device)
        causal = (idx.unsqueeze(0) <= idx.unsqueeze(1))  # [q,q] True where key<=query
        keep = attention_mask.to(torch.bool)[:, None, None, :]  # [b,1,1,q] pad mask
        allowed = causal[None, None] & keep  # [b,1,q,q]
        mask4d = (1.0 - allowed.to(torch.float32)) * minv  # 0 where allowed, min else
        o = self.m(
            input_ids=input_ids,
            attention_mask=mask4d,
            output_attentions=True,
            use_cache=False,
        )
        atts = o.attentions  # tuple(L) of [b, heads, q, kv]
        if self.keep is not None:
            atts = [atts[i] for i in self.keep]
        # [b, layers, heads, seq, seq]
        return o.logits, torch.stack(atts, dim=1)


wrapper = WithAttn(model, layers)

# Trace inputs: a short real prompt so the causal mask path is exercised.
enc = tok("Attention is all you need.", return_tensors="pt")
sample = (enc["input_ids"], enc["attention_mask"])

dst = os.path.join(od, "model.onnx")
print(f"▸ exporting -> {dst}")
with torch.no_grad():
    torch.onnx.export(
        wrapper,
        sample,
        dst,
        input_names=["input_ids", "attention_mask"],
        output_names=["logits", "attentions"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "seq"},
            "attention_mask": {0: "batch", 1: "seq"},
            "logits": {0: "batch", 1: "seq"},
            "attentions": {0: "batch", 3: "seq", 4: "seq"},
        },
        opset_version=17,
        do_constant_folding=True,
        dynamo=False,  # stable TorchScript exporter; dynamo path is flakier here
    )

# torch scatters weights into one external file PER tensor (~200 files). Reload
# and rewrite as a single model.onnx + model.onnx_data — clean for upload + tj.
print("▸ consolidating external weights -> model.onnx_data")
import glob

import onnx

m = onnx.load(dst)  # pulls all scattered external data into memory
for f in glob.glob(os.path.join(od, "*")):
    os.remove(f)
onnx.save(
    m,
    dst,
    save_as_external_data=True,
    all_tensors_to_one_file=True,
    location="model.onnx_data",
    size_threshold=1024,
)

# transformers.js layout: config + tokenizer on top, weights under onnx/.
top = out
cfg.save_pretrained(top)
tok.save_pretrained(top)

n_layers = len(layers) if layers else cfg.num_hidden_layers
sz = os.path.getsize(dst) / 1e6
print(f"✓ fp32 at {dst}  ({sz:.0f} MB)")
print(f"  attentions output shape: [batch, {n_layers}, {cfg.num_attention_heads}, seq, seq]")
print("  quantize/ship variants:  python mkonnx.py", top)
print("  heads-up: attentions are fp32 [L*H*seq*seq] — keep prompts short or use LAYERS=")
