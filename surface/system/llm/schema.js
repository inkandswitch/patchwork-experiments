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

export const schema = {
  init() {
    return {
      config: {
        apiUrl: 'https://openrouter.ai/api/v1',
        model: 'openai/gpt-4o-mini',
      },
      runs: [],
    };
  },
  parse(value) {
    const v =
      typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
    return LlmContentSchema.parse({
      config: {
        apiUrl: typeof v.config?.apiUrl === 'string' ? v.config.apiUrl : 'https://openrouter.ai/api/v1',
        model: typeof v.config?.model === 'string' ? v.config.model : 'openai/gpt-4o-mini',
      },
      runs: Array.isArray(v.runs) ? v.runs : [],
    });
  },
  toJSONSchema() {
    return z.toJSONSchema(LlmContentSchema);
  },
};
