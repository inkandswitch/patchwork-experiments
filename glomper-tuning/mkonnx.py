#!/usr/bin/env python3
"""Produce transformers.js dtype variants from <dir>/onnx/model.onnx and KEEP
only the ones that actually load (so a model whose fp16 export is broken — e.g.
gemma3's RMSNorm Cast quirk — simply doesn't ship a broken q4f16).

Usage: mkonnx.py <onnx_dir>   (the dir holding config.json + onnx/model.onnx)
"""
import os
import sys
import warnings

warnings.filterwarnings("ignore")
import onnx
import onnxruntime as ort

d = sys.argv[1]
od = os.path.join(d, "onnx")
base = os.path.join(od, "model.onnx")
if not os.path.exists(base):
    sys.exit(f"no {base} — run the optimum export first")


def can_load(p):
    try:
        ort.InferenceSession(p, providers=["CPUExecutionProvider"])
        return True
    except Exception as e:
        print("  ✗", os.path.basename(p), "—", str(e)[:90])
        return False


def mb(p):
    return os.path.getsize(p) / 1e6


made = []
if can_load(base):
    made.append(("fp32", "model.onnx"))

# q8 — dynamic int8 (smallest reliable; quantizes the big embedding too)
from onnxruntime.quantization import QuantType, quantize_dynamic

q8 = os.path.join(od, "model_quantized.onnx")
print("building q8 …")
quantize_dynamic(base, q8, weight_type=QuantType.QInt8)
if can_load(q8):
    made.append(("q8", "model_quantized.onnx"))

# q4 — int4 matmuls, fp32 elsewhere (no fp16 → robust)
from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer

print("building q4 …")
q = MatMulNBitsQuantizer(onnx.load(base), bits=4, block_size=32, is_symmetric=True)
q.process()
q4 = os.path.join(od, "model_q4.onnx")
q.model.save_model_to_file(q4, use_external_data_format=False)
if can_load(q4):
    made.append(("q4", "model_q4.onnx"))

# q4f16 — fp16 base + int4 matmuls (smallest, webgpu-friendly). Best effort:
# keep RMSNorm math in fp32 to dodge the common Cast-type mismatch; if the
# result still won't load (some archs, incl. gemma3, are finicky), drop it.
print("building q4f16 (best effort) …")
try:
    from onnxconverter_common import float16

    m16 = float16.convert_float_to_float16(
        onnx.load(base),
        keep_io_types=True,
        op_block_list=["Pow", "ReduceMean", "Sqrt", "Div", "Add", "Mul"],
    )
    q = MatMulNBitsQuantizer(m16, bits=4, block_size=32, is_symmetric=True)
    q.process()
    q4f16 = os.path.join(od, "model_q4f16.onnx")
    q.model.save_model_to_file(q4f16, use_external_data_format=False)
    if can_load(q4f16):
        made.append(("q4f16", "model_q4f16.onnx"))
    else:
        os.remove(q4f16)
        print("  q4f16 unavailable — built but won't load on this arch; use q8.")
except Exception:
    # onnxconverter-common's fp16 pass crashes on some graphs (e.g. gemma3's
    # fp32 RMSNorm), and gemma3 fp16 wouldn't load anyway. Not fatal — q8/q4
    # are the browser-ready outputs.
    print("  q4f16 unavailable — fp16 conversion unsupported for this model; use q8.")

print("\navailable dtypes (set the tool's widget dtype to one of these):")
for dt, fn in made:
    print(f"  {dt:7s} {fn:26s} {mb(os.path.join(od, fn)):7.0f} MB")
