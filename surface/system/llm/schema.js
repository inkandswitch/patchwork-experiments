import { z } from 'https://esm.sh/zod@4.3';

const OutputBlockSchema = z.union([
  z.object({ type: z.literal('text'), content: z.string() }),
  z.object({
    type: z.literal('script'),
    code: z.string(),
    description: z.string().optional(),
    output: z.string().optional(),
    error: z.string().optional(),
  }),
]);

const RunSchema = z.object({
  prompt: z.string(),
  output: z.array(OutputBlockSchema),
  done: z.boolean().optional(),
});

const LlmContentSchema = z.object({
  config: z.object({
    apiUrl: z.string(),
    model: z.string(),
  }),
  runs: z.array(RunSchema),
});

export default {
  init() {
    return {
      config: {
        apiUrl: 'https://openrouter.ai/api/v1',
        model: 'anthropic/claude-opus-4.6',
      },
      runs: [],
    };
  },
  parse(value) {
    return LlmContentSchema.parse(value);
  },
  toJSONSchema() {
    return z.toJSONSchema(LlmContentSchema);
  },
};
