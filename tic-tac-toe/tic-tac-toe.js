/**
 * Tic Tac Toe - Bundleless Patchwork Tool
 *
 * @typedef {Object} TicTacToeDoc
 * @property {string} title
 * @property {Array<string|null>} board - 9 cells, null = empty, 'X' or 'O'
 * @property {'X'|'O'} currentPlayer
 * @property {'playing'|'won'|'draw'} status
 * @property {string|null} winner
 */

// ============================================================================
// Datatype
// ============================================================================

export const TicTacToeDatatype = {
  init(doc) {
    doc.title = "Tic Tac Toe";
    doc.board = [null, null, null, null, null, null, null, null, null];
    doc.currentPlayer = "X";
    doc.status = "playing";
    doc.winner = null;
  },

  getTitle(doc) {
    return doc.title || "Tic Tac Toe";
  },

  setTitle(doc, title) {
    doc.title = title;
  },

  markCopy(doc) {
    doc.title = "Copy of " + this.getTitle(doc);
  },
};

// ============================================================================
// Tool
// ============================================================================

const WINNING_COMBINATIONS = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function checkWinner(board) {
  for (const [a, b, c] of WINNING_COMBINATIONS) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return null;
}

function isBoardFull(board) {
  return board.every((cell) => cell !== null);
}

function createStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .ttt-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      font-family: system-ui, -apple-system, sans-serif;
      padding: 20px;
      box-sizing: border-box;
    }
    .ttt-title {
      font-size: 24px;
      font-weight: bold;
      margin-bottom: 16px;
    }
    .ttt-status {
      font-size: 18px;
      margin-bottom: 16px;
      color: #666;
    }
    .ttt-status.winner {
      color: #22c55e;
      font-weight: bold;
    }
    .ttt-status.draw {
      color: #f59e0b;
      font-weight: bold;
    }
    .ttt-board {
      display: grid;
      grid-template-columns: repeat(3, 80px);
      grid-template-rows: repeat(3, 80px);
      gap: 4px;
      background: #333;
      padding: 4px;
      border-radius: 8px;
    }
    .ttt-cell {
      width: 80px;
      height: 80px;
      background: #fff;
      border: none;
      font-size: 36px;
      font-weight: bold;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background-color 0.15s;
    }
    .ttt-cell:hover:not(:disabled) {
      background: #f0f0f0;
    }
    .ttt-cell:disabled {
      cursor: default;
    }
    .ttt-cell.x {
      color: #3b82f6;
    }
    .ttt-cell.o {
      color: #ef4444;
    }
    .ttt-reset {
      margin-top: 20px;
      padding: 10px 24px;
      font-size: 16px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: background-color 0.15s;
    }
    .ttt-reset:hover {
      background: #2563eb;
    }
  `;
  return style;
}

export function Tool(handle, element) {
  const style = createStyles();
  element.appendChild(style);

  const container = document.createElement("div");
  container.className = "ttt-container";
  element.appendChild(container);

  function render() {
    const doc = handle.doc();
    if (!doc) return;

    container.innerHTML = "";

    const title = document.createElement("div");
    title.className = "ttt-title";
    title.textContent = doc.title || "Tic Tac Toe";
    container.appendChild(title);

    const status = document.createElement("div");
    status.className = "ttt-status";
    if (doc.status === "won") {
      status.classList.add("winner");
      status.textContent = `🎉 Player ${doc.winner} wins!`;
    } else if (doc.status === "draw") {
      status.classList.add("draw");
      status.textContent = "It's a draw!";
    } else {
      status.textContent = `Player ${doc.currentPlayer}'s turn`;
    }
    container.appendChild(status);

    const board = document.createElement("div");
    board.className = "ttt-board";

    for (let i = 0; i < 9; i++) {
      const cell = document.createElement("button");
      cell.className = "ttt-cell";
      cell.disabled = doc.status !== "playing" || doc.board[i] !== null;

      if (doc.board[i]) {
        cell.textContent = doc.board[i];
        cell.classList.add(doc.board[i].toLowerCase());
      }

      cell.addEventListener("click", () => {
        handle.change((d) => {
          if (d.board[i] !== null || d.status !== "playing") return;

          d.board[i] = d.currentPlayer;

          const winner = checkWinner(d.board);
          if (winner) {
            d.status = "won";
            d.winner = winner;
          } else if (isBoardFull(d.board)) {
            d.status = "draw";
          } else {
            d.currentPlayer = d.currentPlayer === "X" ? "O" : "X";
          }
        });
      });

      board.appendChild(cell);
    }
    container.appendChild(board);

    const resetBtn = document.createElement("button");
    resetBtn.className = "ttt-reset";
    resetBtn.textContent = "New Game";
    resetBtn.addEventListener("click", () => {
      handle.change((d) => {
        d.board = [null, null, null, null, null, null, null, null, null];
        d.currentPlayer = "X";
        d.status = "playing";
        d.winner = null;
      });
    });
    container.appendChild(resetBtn);
  }

  render();
  handle.on("change", render);

  return () => {
    handle.off("change", render);
    container.remove();
    style.remove();
  };
}

// ============================================================================
// Plugin Exports
// ============================================================================

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "tic-tac-toe",
    name: "Tic Tac Toe",
    icon: "Grid3x3",
    async load() {
      return TicTacToeDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "tic-tac-toe",
    name: "Tic Tac Toe",
    icon: "Grid3x3",
    supportedDatatypes: ["tic-tac-toe"],
    async load() {
      return Tool;
    },
  },
];
