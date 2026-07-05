#!/usr/bin/env python3
"""Export a causal-LM to ONNX that ALSO outputs the **cut hidden state** x1 —
the residual stream just before the LAST block's MLP (i.e. the input to its
post_attention_layernorm). For rung 2: a LoRA adapter on the last block's MLP,
trained on cached features, with attention frozen and baked into x1.

In the browser, one forward gives x1 per position; the JS engine then runs
post_attention_layernorm → SwiGLU MLP (+LoRA) → residual → final norm → head.
Those frozen weights ship alongside (block_weights_fp32.npz here → browser blob).

Sibling of onnx_hidden.py (same hand-built 4D mask trick).

Usage: python onnx_block.py [model] [out_dir]
"""
import glob
import json
import os
import sys
import warnings

warnings.filterwarnings("ignore")
import numpy as np
import onnx
import onnxruntime as ort
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

model_id = sys.argv[1] if len(sys.argv) > 1 else "HuggingFaceTB/SmolLM2-135M-Instruct"
name = os.path.basename(model_id.rstrip("/")).lower()
out = sys.argv[2] if len(sys.argv) > 2 else f"models/{name}-block"
od = os.path.join(out, "onnx")
os.makedirs(od, exist_ok=True)

print(f"▸ loading {model_id} (eager attention)")
tok = AutoTokenizer.from_pretrained(model_id)
model = AutoModelForCausalLM.from_pretrained(model_id, attn_implementation="eager", torch_dtype=torch.float32).eval()
cfg = model.config
last = model.model.layers[-1]
print(f"  {cfg.num_hidden_layers} layers, d {cfg.hidden_size}, dm {cfg.intermediate_size}, V {cfg.vocab_size}")


class WithCut(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m
        self._x1 = None
        # capture the input to the last block's post_attention_layernorm = x1
        last.post_attention_layernorm.register_forward_pre_hook(lambda mod, inp: setattr(self, "_x1", inp[0]))

    def forward(self, input_ids, attention_mask):
        b, q = input_ids.shape
        minv = torch.finfo(torch.float32).min
        idx = torch.arange(q, device=input_ids.device)
        causal = idx.unsqueeze(0) <= idx.unsqueeze(1)
        keep = attention_mask.to(torch.bool)[:, None, None, :]
        mask4d = (1.0 - (causal[None, None] & keep).to(torch.float32)) * minv
        o = self.m(input_ids=input_ids, attention_mask=mask4d, use_cache=False)
        return o.logits, self._x1


wrapper = WithCut(model)
enc = tok("def greet(name):", return_tensors="pt")
sample = (enc["input_ids"], enc["attention_mask"])
dst = os.path.join(od, "model.onnx")
print(f"▸ exporting -> {dst}")
with torch.no_grad():
    torch.onnx.export(
        wrapper, sample, dst,
        input_names=["input_ids", "attention_mask"],
        output_names=["logits", "cut_hidden"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "seq"}, "attention_mask": {0: "batch", 1: "seq"},
            "logits": {0: "batch", 1: "seq"}, "cut_hidden": {0: "batch", 1: "seq"},
        },
        opset_version=17, do_constant_folding=True, dynamo=False,
    )

print("▸ consolidating external weights")
m = onnx.load(dst)
for f in glob.glob(os.path.join(od, "*")):
    os.remove(f)
onnx.save(m, dst, save_as_external_data=True, all_tensors_to_one_file=True, location="model.onnx_data", size_threshold=1024)
cfg.save_pretrained(out)
tok.save_pretrained(out)

# frozen weights the browser needs for the rung-2 forward
W = {
    "n2w": last.post_attention_layernorm.weight.detach().float().numpy(),
    "Wgate": last.mlp.gate_proj.weight.detach().float().numpy(),
    "Wup": last.mlp.up_proj.weight.detach().float().numpy(),
    "Wdown": last.mlp.down_proj.weight.detach().float().numpy(),
    "nfw": model.model.norm.weight.detach().float().numpy(),
    "Wlm": model.lm_head.weight.detach().float().numpy(),
}
np.savez(os.path.join(out, "block_weights_fp32.npz"), **W)
print("static weight shapes:", {k: list(v.shape) for k, v in W.items()})

# verify: the ONNX really emits cut_hidden, and reconstructing logits from it +
# the frozen weights matches the ONNX's own logits (proves the export is usable).
sess = ort.InferenceSession(dst, providers=["CPUExecutionProvider"])
ol, x1 = sess.run(["logits", "cut_hidden"], {"input_ids": enc["input_ids"].numpy(), "attention_mask": enc["attention_mask"].numpy()})
ol, x1 = ol[0], x1[0]
eps = cfg.rms_norm_eps
rms = lambda x, w: x / np.sqrt((x * x).mean(-1, keepdims=True) + eps) * w
silu = lambda x: x / (1 + np.exp(-x))
xn = rms(x1, W["n2w"])
recon = rms(x1 + (silu(xn @ W["Wgate"].T) * (xn @ W["Wup"].T)) @ W["Wdown"].T, W["nfw"]) @ W["Wlm"].T
print(f"cut_hidden shape {list(x1.shape)} | max|recon - onnx logits| = {float(np.abs(recon - ol).max()):.2e}")
