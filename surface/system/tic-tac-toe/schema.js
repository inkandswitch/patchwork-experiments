
import { z } from 'https://esm.sh/zod@4.3';
import { getToolUrl } from '../url.js';

const TicTacToeSchema = z.object({
  x: z.number(),
  y: z.number(),
  toolUrl: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  board: z.array(z.string()),
  currentPlayer: z.string(),
  winner: z.string(),
  gameOver: z.boolean(),
});

export const schema = {
  init() {
    return {
      x: 0,
      y: 0,
      toolUrl: getToolUrl('./tool.js', import.meta.url),
      width: 280,
      height: 320,
      board: ['', '', '', '', '', '', '', '', ''],
      currentPlayer: 'X',
      winner: '',
      gameOver: false,
    };
  },
  parse(value) {
    return TicTacToeSchema.parse(value);
  },
};
