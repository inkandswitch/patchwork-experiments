#!/usr/bin/env python3
"""Build a WORKING model_q4f16.onnx (fp16 base + int4 matmuls, WebGPU-friendly)
for the attention-enabled model.

mkonnx.py's q4f16 path uses onnxconverter_common's float16 pass, which fails on
this graph: our torch export already carries RMSNorm precision Casts, and that
library fights them (plus a >2GB serialize wall and an internal cast-cleanup bug).
So instead we let PyTorch emit the fp16 graph directly — it knows its own casts —
and only int4-quantize the matmuls afterwards. No onnxconverter_common involved.

Usage: mkq4f16.py [model] [onnx_dir]
  model     HF id or merged dir   (default Qwen/Qwen3-0.6B)
  onnx_dir  dir holding onnx/model.onnx; writes onnx/model_q4f16.onnx alongside
"""
import glob
import os
import sys
import warnings

warnings.filterwarnings("ignore")
import numpy as np
import onnx
import onnxruntime as ort
import torch
from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
from transformers import AutoModelForCausalLM, AutoTokenizer

model_id = sys.argv[1] if len(sys.argv) > 1 else "Qwen/Qwen3-0.6B"
name = os.path.basename(model_id.rstrip("/")).lower()
out = sys.argv[2] if len(sys.argv) > 2 else f"models/{name}-attn/onnx"
od = os.path.join(out, "onnx")
os.makedirs(od, exist_ok=True)

print(f"▸ loading {model_id} in fp16 (eager attention)")
tok = AutoTokenizer.from_pretrained(model_id)
model = AutoModelForCausalLM.from_pretrained(
    model_id, attn_implementation="eager", dtype=torch.float16
).eval()


class WithAttn(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, input_ids, attention_mask):
        # dtype-aware additive 4D causal mask (fp16 here), built with plain ops so
        # the ONNX tracer never touches transformers' vmap mask builder.
        dtype = next(self.m.parameters()).dtype
        minv = torch.finfo(dtype).min
        b, q = input_ids.shape
        idx = torch.arange(q, device=input_ids.device)
        causal = idx.unsqueeze(0) <= idx.unsqueeze(1)
        keep = attention_mask.to(torch.bool)[:, None, None, :]
        allowed = causal[None, None] & keep
        mask = (1.0 - allowed.to(dtype)) * minv
        o = self.m(
            input_ids=input_ids,
            attention_mask=mask,
            output_attentions=True,
            use_cache=False,
        )
        return o.logits, torch.stack(o.attentions, dim=1)


enc = tok("Attention is all you need.", return_tensors="pt")
sample = (enc["input_ids"], enc["attention_mask"])

tmp = os.path.join(od, "_fp16_tmp.onnx")
print("▸ exporting fp16 graph from torch")
with torch.no_grad():
    torch.onnx.export(
        WithAttn(model),
        sample,
        tmp,
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
        dynamo=False,
    )

print("▸ int4-quantizing matmuls (fp16 base stays fp16)")
q = MatMulNBitsQuantizer(onnx.load(tmp), bits=4, block_size=32, is_symmetric=True)
q.process()
dst = os.path.join(od, "model_q4f16.onnx")
q.model.save_model_to_file(dst, use_external_data_format=False)
for f in glob.glob(tmp + "*"):
    os.remove(f)
print(f"✓ saved {dst}  ({os.path.getsize(dst) / 1e6:.0f} MB)")

# --- self-check: loads + predicts + attention is causal/normalized ---
print("▸ verifying …")
sess = ort.InferenceSession(dst, providers=["CPUExecutionProvider"])
ids = tok("The capital of France is", return_tensors="np")
seq = ids["input_ids"].shape[1]
logits, attn = sess.run(
    ["logits", "attentions"],
    {
        "input_ids": ids["input_ids"].astype(np.int64),
        "attention_mask": ids["attention_mask"].astype(np.int64),
    },
)
a = attn[0, 0, 0].astype(np.float32)
nxt = repr(tok.decode([int(logits[0, -1].argmax())]))
print(f"  attentions {attn.shape}  next={nxt}")
print(
    f"  row sums={np.round(a.sum(-1), 2)}  max-future={float(a[np.triu_indices(seq, 1)].max()):.3g}"
)
