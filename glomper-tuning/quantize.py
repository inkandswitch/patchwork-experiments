#!/usr/bin/env python3
"""Dynamic int8 quantize an ONNX model. Usage: quantize.py <src.onnx> <dst.onnx>"""
import os
import sys

from onnxruntime.quantization import QuantType, quantize_dynamic

src, dst = sys.argv[1], sys.argv[2]
quantize_dynamic(src, dst, weight_type=QuantType.QInt8)
print(f"q8 -> {dst}  ({os.path.getsize(dst) / 1e6:.1f} MB)")
