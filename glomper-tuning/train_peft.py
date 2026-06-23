#!/usr/bin/env python3
"""
LoRA fine-tune Qwen2.5-Coder-1.5B (base) on the RLM widget dataset, then merge
the adapter into a standalone HF model ready for ONNX export.

This is the "keeper run" path from the brief — PEFT/Transformers exports to ONNX
cleanly (transformers.js needs ONNX). For fast iteration, see the mlx-lm path in
README.md instead.

  pip install "torch" "transformers>=4.44" "peft>=0.12" "datasets" "accelerate"
  python prepare.py
  python train_peft.py
  # -> ./out/adapter (LoRA) and ./out/merged (standalone model for ONNX export)

Runs on Apple-silicon MPS, CUDA, or CPU (slow). Override the base model or
hyperparameters with flags; run with -h to see them.
"""
import argparse
import json
from pathlib import Path

import torch
from datasets import load_dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    DataCollatorForLanguageModeling,
    Trainer,
    TrainingArguments,
)
from peft import LoraConfig, get_peft_model

HERE = Path(__file__).parent


def pick_device():
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen2.5-Coder-1.5B")
    ap.add_argument("--data", default=str(HERE / "data"))
    ap.add_argument("--out", default=str(HERE / "out"))
    ap.add_argument("--epochs", type=float, default=4.0)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--alpha", type=int, default=32)
    ap.add_argument("--max-len", type=int, default=2048)
    ap.add_argument("--grad-accum", type=int, default=8)
    args = ap.parse_args()

    device = pick_device()
    print(f"device: {device}")

    tok = AutoTokenizer.from_pretrained(args.model)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        torch_dtype=torch.float32 if device == "mps" else torch.bfloat16,
    )
    model.to(device)
    model.config.use_cache = False

    lora = LoraConfig(
        r=args.rank,
        lora_alpha=args.alpha,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    )
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()

    ds = load_dataset(
        "json",
        data_files={"train": f"{args.data}/train.jsonl", "valid": f"{args.data}/valid.jsonl"},
    )

    eos = tok.eos_token
    WIDGET_OPEN = "<widget>"

    def tokenize(ex):
        # Dataset is `text` format (one raw continuation string). Mask the prompt
        # part (everything up to and including the first "<widget>") so loss lands
        # on the widget; if "<widget>" isn't found, train on the whole text.
        text = ex["text"] + eos
        cut = text.find(WIDGET_OPEN)
        prefix = text[:cut] if cut >= 0 else ""
        ids = tok(text, add_special_tokens=False)["input_ids"][: args.max_len]
        n_prefix = len(tok(prefix, add_special_tokens=False)["input_ids"]) if prefix else 0
        labels = [(-100 if i < n_prefix else t) for i, t in enumerate(ids)]
        return {"input_ids": ids, "labels": labels, "attention_mask": [1] * len(ids)}

    ds = ds.map(tokenize, remove_columns=ds["train"].column_names)

    def collate(batch):
        maxlen = max(len(b["input_ids"]) for b in batch)
        out = {"input_ids": [], "attention_mask": [], "labels": []}
        for b in batch:
            pad = maxlen - len(b["input_ids"])
            out["input_ids"].append(b["input_ids"] + [tok.pad_token_id] * pad)
            out["attention_mask"].append(b["attention_mask"] + [0] * pad)
            out["labels"].append(b["labels"] + [-100] * pad)
        return {k: torch.tensor(v) for k, v in out.items()}

    targs = TrainingArguments(
        output_dir=f"{args.out}/checkpoints",
        num_train_epochs=args.epochs,
        per_device_train_batch_size=1,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        warmup_ratio=0.05,
        logging_steps=5,
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=1,
        bf16=(device == "cuda"),
        report_to=[],
    )

    trainer = Trainer(
        model=model,
        args=targs,
        train_dataset=ds["train"],
        eval_dataset=ds["valid"],
        data_collator=collate,
    )
    trainer.train()

    adapter_dir = f"{args.out}/adapter"
    model.save_pretrained(adapter_dir)
    tok.save_pretrained(adapter_dir)
    print(f"saved adapter -> {adapter_dir}")

    # Merge LoRA into the base weights for a clean ONNX export.
    merged = model.merge_and_unload()
    merged_dir = f"{args.out}/merged"
    merged.save_pretrained(merged_dir)
    tok.save_pretrained(merged_dir)
    print(f"saved merged model -> {merged_dir}")
    print("next: export to ONNX q4 (see README.md, step 4).")


if __name__ == "__main__":
    main()
