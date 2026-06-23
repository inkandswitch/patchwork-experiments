#!/usr/bin/env python3
"""
Print the EXACT inference prompt (system prompt + <req>…</req>) for a request,
so you can sanity-test the fine-tuned model with the same prompt shape it was
trained on. Usage:

  mlx_lm.generate --model Qwen/Qwen2.5-Coder-1.5B --adapter-path ./adapters \\
    --ignore-chat-template --max-tokens 400 \\
    --prompt "$(python3 testprompt.py 'a table of the first 5 fibonacci numbers')"
"""
import sys
import prepare

req = sys.argv[1] if len(sys.argv) > 1 else "a table of the first 5 fibonacci numbers"
# the exact inference prompt for the WIDGET model (plain continuation, no chat template)
print(f"{prepare.SYSTEM_PROMPT}\n\n<req>{req}</req>\n\n", end="")
