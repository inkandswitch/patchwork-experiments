import {
  DEFAULT_FACTS,
  DEFAULT_RULES,
  DEFAULT_CONSTRAINTS,
  DEFAULT_PROGRAM_TEXT,
} from './defaults.js';

export const schema = {
  init() {
    return {
      x: 0,
      y: 0,
      toolUrl: new URL('./shape.js', import.meta.url).href,
      width: 800,
      height: 500,
      facts: DEFAULT_FACTS,
      rules: DEFAULT_RULES,
      constraints: DEFAULT_CONSTRAINTS,
      draftText: DEFAULT_PROGRAM_TEXT,
    };
  },
  parse(value) {
    if (!value) return schema.init();
    return {
      ...schema.init(),
      ...value,
    };
  },
  toJSONSchema() {
    const atom = {
      type: 'object',
      properties: {
        pred: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
      },
      required: ['pred', 'args'],
      additionalProperties: false,
    };
    return {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        toolUrl: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
        facts: { type: 'array', items: atom },
        rules: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              head: atom,
              body: { type: 'array', items: atom },
            },
            required: ['head', 'body'],
            additionalProperties: false,
          },
        },
        constraints: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              body: { type: 'array', items: atom },
            },
            required: ['body'],
            additionalProperties: false,
          },
        },
        draftText: { type: 'string' },
      },
      required: ['x', 'y', 'toolUrl', 'width', 'height', 'facts', 'rules', 'constraints', 'draftText'],
      additionalProperties: false,
    };
  },
};
