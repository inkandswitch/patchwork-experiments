
import { from, render, html, createSignal } from '../solid.js';
import { schema } from './schema.js';

export { schema };

const WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
  [0, 4, 8], [2, 4, 6],             // diagonals
];

function checkWinner(board) {
  for (const [a, b, c] of WINNING_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line: [a, b, c] };
    }
  }
  if (board.every(cell => cell !== '')) return { winner: 'draw', line: null };
  return null;
}

export default function mount(element) {
  const ref = element.ref.as(schema);
  const data = from(ref);

  function handleClick(index) {
    const d = data();
    if (!d || d.gameOver) return;
    if (d.board[index] !== '') return;

    ref.change((doc) => {
      doc.board[index] = doc.currentPlayer;
      const result = checkWinner([...doc.board]);
      if (result) {
        doc.winner = result.winner;
        doc.gameOver = true;
      } else {
        doc.currentPlayer = doc.currentPlayer === 'X' ? 'O' : 'X';
      }
    });
  }

  function resetGame() {
    ref.change((doc) => {
      for (let i = 0; i < 9; i++) doc.board[i] = '';
      doc.currentPlayer = 'X';
      doc.winner = '';
      doc.gameOver = false;
    });
  }

  function getWinningLine() {
    const d = data();
    if (!d || !d.gameOver || d.winner === 'draw') return null;
    const board = d.board;
    for (const [a, b, c] of WINNING_LINES) {
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        return [a, b, c];
      }
    }
    return null;
  }

  return render(() => {
    const board = () => data()?.board ?? ['','','','','','','','',''];
    const currentPlayer = () => data()?.currentPlayer ?? 'X';
    const winner = () => data()?.winner ?? '';
    const gameOver = () => data()?.gameOver ?? false;
    const winLine = () => getWinningLine();

    const statusText = () => {
      const w = winner();
      if (w === 'draw') return "It's a draw!";
      if (w) return `${w} wins! 🎉`;
      return `${currentPlayer()}'s turn`;
    };

    const cellStyle = (i) => {
      const wl = winLine();
      const isWinCell = wl && wl.includes(i);
      return {
        width: '76px',
        height: '76px',
        border: '2px solid #c4b5fd',
        background: isWinCell ? '#ede9fe' : (board()[i] ? '#faf5ff' : '#fff'),
        'border-radius': '10px',
        cursor: (!gameOver() && !board()[i]) ? 'pointer' : 'default',
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        'font-size': '32px',
        'font-weight': 'bold',
        color: board()[i] === 'X' ? '#7c3aed' : '#ec4899',
        transition: 'all 0.15s ease',
        'box-shadow': isWinCell ? '0 0 12px rgba(139, 92, 246, 0.4)' : 'none',
      };
    };

    return html`<div
      style=${{
        width: '100%',
        height: '100%',
        background: 'linear-gradient(135deg, #faf5ff 0%, #f0e7fe 50%, #ede9fe 100%)',
        'border-radius': '16px',
        padding: '16px',
        'box-sizing': 'border-box',
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'center',
        gap: '12px',
        'font-family': 'system-ui, -apple-system, sans-serif',
        'box-shadow': '0 4px 20px rgba(139, 92, 246, 0.15)',
        border: '1px solid #ddd6fe',
      }}
      onPointerDown=${(e) => e.stopPropagation()}
    >
      <!-- Title -->
      <div style=${{
        'font-size': '18px',
        'font-weight': '700',
        color: '#6d28d9',
        'letter-spacing': '0.5px',
      }}>✨ Tic Tac Toe ✨</div>

      <!-- Status -->
      <div style=${{
        'font-size': '15px',
        'font-weight': '600',
        color: () => winner() ? '#7c3aed' : '#8b5cf6',
        background: '#f5f3ff',
        padding: '6px 16px',
        'border-radius': '20px',
        border: '1px solid #ddd6fe',
      }}>${statusText}</div>

      <!-- Board -->
      <div style=${{
        display: 'grid',
        'grid-template-columns': 'repeat(3, 76px)',
        gap: '6px',
      }}>
        ${() => [0,1,2,3,4,5,6,7,8].map(i =>
          html`<div
            style=${() => cellStyle(i)}
            onClick=${() => handleClick(i)}
            onMouseEnter=${(e) => {
              if (!gameOver() && !board()[i]) {
                e.target.style.background = '#f5f3ff';
                e.target.style.transform = 'scale(1.05)';
              }
            }}
            onMouseLeave=${(e) => {
              const wl = winLine();
              const isWin = wl && wl.includes(i);
              e.target.style.background = isWin ? '#ede9fe' : (board()[i] ? '#faf5ff' : '#fff');
              e.target.style.transform = 'scale(1)';
            }}
          >${() => board()[i]}</div>`
        )}
      </div>

      <!-- Reset button -->
      <button
        onClick=${resetGame}
        style=${{
          padding: '8px 24px',
          background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
          color: 'white',
          border: 'none',
          'border-radius': '20px',
          'font-size': '13px',
          'font-weight': '600',
          cursor: 'pointer',
          'box-shadow': '0 2px 8px rgba(124, 58, 237, 0.3)',
          transition: 'all 0.15s ease',
        }}
        onMouseEnter=${(e) => {
          e.target.style.transform = 'scale(1.05)';
          e.target.style.boxShadow = '0 4px 12px rgba(124, 58, 237, 0.4)';
        }}
        onMouseLeave=${(e) => {
          e.target.style.transform = 'scale(1)';
          e.target.style.boxShadow = '0 2px 8px rgba(124, 58, 237, 0.3)';
        }}
      >New Game</button>
    </div>`;
  }, element);
}
