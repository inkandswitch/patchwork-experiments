# Fine-tuning the RLM widget model

The stock `Qwen2.5-Coder-1.5B` base model doesn't know the `<widget>` format —
it degenerates on odd prompts. This kit teaches it the format + house style with
a LoRA, then exports a q4 ONNX you can load straight back into the tool.

The pipeline (from the project brief): **synthesize → verify → LoRA → export ONNX
→ load**. Steps 1–2 can happen in the browser (the tool's data factory); 3–5 run
here on your Mac.

```
data factory (browser) ─┐
hand-authored seeds  ───┼─► prepare.py ─► LoRA (mlx OR peft) ─► merged HF model
strong-model batches ───┘                                          │
                                                                   ▼
                                          transformers.js convert ─► q4 ONNX ─► tool
```

Everything is local. Target machine: Apple M4 Max.

## Which model do I fine-tune? (and can I fine-tune ONNX directly?)

- **Only the WIDGET model is fine-tuned.** The PLANNER is an off-the-shelf
  *instruct* model (decomposition is what instruct models are good at zero-shot —
  no training needed). So this kit trains the small widget coder.
- **You cannot fine-tune an ONNX file directly.** ONNX is a frozen inference
  graph. You fine-tune the PyTorch/safetensors base, merge, then **re-export** to
  ONNX. (ONNX Runtime has on-device training APIs, but that's niche and not how
  you'd LoRA — ignore it.)
- **Widget base options** (`--model`):
  - `Qwen/Qwen2.5-Coder-1.5B` — base coder, ungated, the default.
  - `Qwen/Qwen2.5-Coder-0.5B` — smaller/faster coder base.
  - `google/gemma-3-270m` — tiniest (270M), **gated** → run
    `huggingface-cli login` and accept the license first; mlx-lm/PEFT support
    `gemma3`. Great for the "how small can we go" experiment.

  Whichever you pick, the flow is identical — **train → merge → re-export to ONNX
  → load**:

  ```bash
  # train + merge (produces ./out/gemma-merged, a normal HF model dir)
  huggingface-cli login   # gemma is gated; accept its license first
  mlx_lm.lora --model google/gemma-3-270m --train --data ./data \
    --iters 2000 --batch-size 4 --learning-rate 1e-4 --adapter-path ./adapters-gemma
  mlx_lm.fuse --model google/gemma-3-270m --adapter-path ./adapters-gemma \
    --save-path ./out/gemma-merged

  # RE-EXPORT to ONNX (this is "step 3" run on the merged dir):
  pip install "optimum-onnx[onnxruntime]"
  optimum-cli export onnx --model ./out/gemma-merged \
    --task text-generation-with-past onnx_out/
  #   (gemma3 export is supported — onnx-community/gemma-3-270m-ONNX exists.)
  #   ...then arrange into the onnx/ layout + quantize, OR push ./out/gemma-merged
  #   to the Hub and run the convert-to-onnx Space (Path A in step 3) which does
  #   the q4f16 + layout in one go.
  ```

  Then set the tool's **Widget** model to your ONNX repo/id (step 4).

---

## 0. Get training data

You need pairs of `{req, code}` (a prose request → the widget JS that answers it).
Three sources, all merge-able:

- **Gold seeds** — 12 hand-authored, idiomatic examples are baked into
  `prepare.py`. They're the smoke test.
- **Data factory (in the tool)** — open RLM, hit **factory**, **GENERATE**, then
  **export jsonl**. That downloads `rlm-dataset.jsonl` (`{req, code}` lines, only
  widgets that actually rendered). Drop it in `./exports/`.
  - ⚠️ Until the model is decent, the factory (which uses the *same* weak model)
    won't produce much that verifies. Early on, lean on seeds + strong-model
    synthesis; use the factory more once a v1 LoRA exists (and later as the RL
    reward signal).
- **Strong-model synthesis** — have a strong model write widget programs for a
  big list of requests in the same `{req, code}` JSONL shape. This is what
  actually moves the needle; aim for a few hundred+ diverse, verified pairs.

> Keep the data honest: only include widgets you've **verified render** (no error,
> non-empty DOM). The factory does this automatically; verify strong-model batches
> the same way (run them through the tool's executor / harness).

## 1. Prepare the dataset

```bash
cd glomper-tuning
python prepare.py                 # gold seeds only
python prepare.py exports/*.jsonl # seeds + your factory / synthesized pairs
```

Writes `data/train.jsonl` and `data/valid.jsonl` as **`{text}`** — one raw
continuation string per example: the tool's exact WIDGET prompt + `<req>…</req>`
followed by `<widget>…</widget>` (the prompt is read live from `../rlm/prompts.js`
so it never drifts). Same as inference ⇒ no train/serve skew.

> **Why `text`, not `{prompt, completion}`:** base models (Qwen-Coder base,
> gemma-3-270m) have no chat template, and the tool does **plain continuation**
> at inference (no `<|im_start|>` markers). mlx-lm's prompt/completion format
> applies the chat template and throws *"chat_template is not set"* on a base
> model — `text` format tokenizes raw, which is both correct and error-free.
> (`train_peft.py` still masks the prompt portion; mlx-lm trains the full text.)

## 2. Pick a training path

### Path A — mlx-lm (fast iteration, Apple-native)

```bash
pip install mlx-lm
mlx_lm.lora \
  --model Qwen/Qwen2.5-Coder-1.5B \
  --train --data ./data \
  --iters 800 --batch-size 1 --num-layers 16 \
  --adapter-path ./adapters
# sanity check:
mlx_lm.generate --model Qwen/Qwen2.5-Coder-1.5B --adapter-path ./adapters \
  --prompt "$(python -c "import prepare;print(prepare.SYSTEM_PROMPT)")
<req>a table of the first 5 fibonacci numbers</req>
"
# fuse adapter into a standalone HF model (for ONNX export):
mlx_lm.fuse --model Qwen/Qwen2.5-Coder-1.5B --adapter-path ./adapters \
  --save-path ./out/merged
```

Fastest loop for "is the format sticking?". Iterate here, then do a keeper run /
export via the merged model.

### Path B — PEFT / Transformers (cleanest ONNX export)

```bash
pip install "torch" "transformers>=4.44" "peft>=0.12" "datasets" "accelerate"
python train_peft.py        # -> ./out/adapter and ./out/merged
```

`train_peft.py` does the LoRA (rank 16) on MPS/CUDA/CPU and writes a merged
standalone model to `./out/merged`. Flags: `python train_peft.py -h`.

## 3. Export to ONNX for transformers.js

transformers.js needs an `onnx/` layout (config + tokenizer at the top, weights
under `onnx/`, e.g. `onnx/model_q4f16.onnx`). NOTE: transformers.js no longer
ships a `scripts/convert.py` — that was removed in v3. There are two real paths:

### A. The convert-to-ONNX Space (easiest, produces the q4f16 layout)

This is the same pipeline that built `onnx-community/Qwen2.5-Coder-1.5B` (our
base), so it emits exactly the layout + quantized variants the tool loads.

1. Push the merged model to the Hub first:
   ```bash
   pip install -U huggingface_hub
   huggingface-cli upload <you>/qwen-rlm-coder ./out/merged
   ```
2. Open <https://huggingface.co/spaces/onnx-community/convert-to-onnx>, enter
   `<you>/qwen-rlm-coder`, and run it. It creates an ONNX repo (e.g.
   `<you>/qwen-rlm-coder-ONNX`) with `onnx/model.onnx` + quantized variants
   (`model_fp16.onnx`, `model_q8.onnx`, `model_q4f16.onnx`, …).

### B. Optimum CLI (offline / scriptable)

The official transformers.js docs recommend [Optimum](https://github.com/huggingface/optimum-onnx):
```bash
pip install "optimum-onnx[onnxruntime]"
optimum-cli export onnx --model ./out/merged --task text-generation-with-past onnx_out/
```
This emits fp32 ONNX. Arrange the files into the `onnx/` layout (move `*.onnx`
into an `onnx/` subdir, keep config + tokenizer alongside). For a smaller q4f16
you then quantize with onnxruntime's MatMul 4-bit quantizer — or just skip
quantization and load the fp32/fp16 build (see dtype below). Path A avoids all of
this.

## 4. Load it in the tool

Set the tool's **models** panel → **root** (and **sub**) id to your ONNX repo
(`<you>/qwen-rlm-coder-ONNX`), and **dtype** to whichever variant you produced:
`q4f16` (smallest, ~1 GB) if you used Path A; otherwise `fp16` or `q8` or `fp32`.
Save → it reloads on the next run, fetching `…/resolve/main/onnx/model_<dtype>.onnx`.

(The workers set `env.allowLocalModels=false` and use the default HF host, so
loading from a Hub repo is by far the least fiddly. Self-hosting would require
editing the worker's `env.remoteHost`.)

Then run a prompt. If the format sticks (starts with the mechanical `dm.print`
restatement, emits a clean `<widget>`), you're tuning. If not, grow the dataset
and repeat from step 1.

## 5. Later: RL with the verifier

The data factory's "renders without error + non-empty DOM" check is exactly an RL
reward. Once SFT gives a model that's *usually* right, you can close the loop
(alexzhang13/rlm has a harness). SFT first.

---

### Notes
- `Qwen/Qwen2.5-Coder-1.5B` is the **base** coder (no chat template) — matches the
  tool's default and the no-chat-template prompt path. Don't train the `-Instruct`.
- There's still no ONNX build of any Qwen3 *base* model; if/when you export one,
  this same kit retargets by changing `--model`.
- Start small to validate the toolchain end-to-end (12 seeds → tiny LoRA → ONNX →
  load), *then* invest in dataset size. A LoRA only memorizes format from enough
  examples — a dozen won't make it reliable, but it proves the pipeline.
