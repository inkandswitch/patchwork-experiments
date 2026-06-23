#!/usr/bin/env python3
"""Export a *prefill-only* causal-LM to ONNX that ALSO outputs the final hidden
state — the post-final-norm activation that feeds lm_head — for training a LoRA
adapter ON the head in the browser (choochoo rung 0).

Sibling of onnx_attn.py. Same trick: force a hand-built 4D causal mask so the
ONNX tracer doesn't choke on transformers' vmap mask builder; run use_cache=False
for clean [batch, seq, *] shapes. The only difference is the extra output:

    logits             [batch, seq, vocab]   = lm_head(last_hidden_state)
    last_hidden_state  [batch, seq, hidden]   = model.norm(...)   ← LoRA trains here

So in the browser, one forward gives both `h` (last_hidden_state) and the base
logits per position; the LoRA-on-head adapter is logits = base + (a/r)*B*(A*h).

Outputs in transformers.js layout: config + tokenizer on top, weights under
onnx/ — so mkonnx.py / `./and upload` work on it unchanged.

Usage:
  python onnx_hidden.py [model] [out_dir]
    model    HF id or local merged dir   (default: HuggingFaceTB/SmolLM2-135M-Instruct)
    out_dir  destination                 (default: models/<name>-hidden)
"""
import os
import sys
import warnings

warnings.filterwarnings("ignore")
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

model_id = sys.argv[1] if len(sys.argv) > 1 else "HuggingFaceTB/SmolLM2-135M-Instruct"
name = os.path.basename(model_id.rstrip("/")).lower()
out = sys.argv[2] if len(sys.argv) > 2 else f"models/{name}-hidden"
od = os.path.join(out, "onnx")
os.makedirs(od, exist_ok=True)

print(f"▸ loading {model_id} (eager attention)")
tok = AutoTokenizer.from_pretrained(model_id)
model = AutoModelForCausalLM.from_pretrained(
    model_id,
    attn_implementation="eager",
    torch_dtype=torch.float32,
)
model.eval()
cfg = model.config
print(f"  {cfg.num_hidden_layers} layers, hidden_size {cfg.hidden_size}, vocab {cfg.vocab_size}")


class WithHidden(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, input_ids, attention_mask):
        # Hand-built additive 4D causal mask (sidesteps transformers' vmap mask
        # builder, which the ONNX tracer can't follow). 0 where allowed, min else.
        b, q = input_ids.shape
        minv = torch.finfo(torch.float32).min
        idx = torch.arange(q, device=input_ids.device)
        causal = idx.unsqueeze(0) <= idx.unsqueeze(1)  # [q,q] key<=query
        keep = attention_mask.to(torch.bool)[:, None, None, :]  # [b,1,1,q]
        allowed = causal[None, None] & keep  # [b,1,q,q]
        mask4d = (1.0 - allowed.to(torch.float32)) * minv
        o = self.m(
            input_ids=input_ids,
            attention_mask=mask4d,
            output_hidden_states=True,
            use_cache=False,
        )
        # hidden_states[-1] is post-final-norm = the input to lm_head.
        return o.logits, o.hidden_states[-1]


wrapper = WithHidden(model)

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
        output_names=["logits", "last_hidden_state"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "seq"},
            "attention_mask": {0: "batch", 1: "seq"},
            "logits": {0: "batch", 1: "seq"},
            "last_hidden_state": {0: "batch", 1: "seq"},
        },
        opset_version=17,
        do_constant_folding=True,
        dynamo=False,
    )

# Consolidate torch's per-tensor external files into one model.onnx_data.
print("▸ consolidating external weights -> model.onnx_data")
import glob

import onnx

m = onnx.load(dst)
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
cfg.save_pretrained(out)
tok.save_pretrained(out)

sz = os.path.getsize(dst) / 1e6
print(f"✓ fp32 at {dst}  ({sz:.0f} MB)")
print(f"  outputs: logits [batch, seq, {cfg.vocab_size}], last_hidden_state [batch, seq, {cfg.hidden_size}]")
print("  quantize/ship variants:  python mkonnx.py", out)
