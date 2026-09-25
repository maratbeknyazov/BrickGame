/* =========================================================================
   Pure falling-block puzzle engine — no DOM, no React, fully testable.
   ========================================================================= */

export const COLS = 10;
export const ROWS = 18;

export const SHAPES = {
  I: [[1, 1, 1, 1]],
  O: [
    [1, 1],
    [1, 1],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
  ],
};

export const PIECE_KEYS = Object.keys(SHAPES);

/* --- 7-bag randomizer -----------------------------------------------------
   `createBagFactory` returns a stateful factory so each mounted game owns
   its own bag (a module-level singleton would be shared across instances). */
export function shuffledBag(rng = Math.random) {
  const bag = [...PIECE_KEYS];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

export function createBagFactory(rng = Math.random) {
  let bag = [];
  return function nextPiece() {
    if (bag.length === 0) bag = shuffledBag(rng);
    const key = bag.shift();
    return { key, shape: SHAPES[key] };
  };
}

/* --- board helpers -------------------------------------------------------- */

export function emptyBoard(rows = ROWS, cols = COLS) {
  return Array.from({ length: rows }, () => Array(cols).fill(0));
}

export function cloneBoard(board) {
  return board.map((row) => row.slice());
}

export function collides(board, shape, pos, rows = ROWS, cols = COLS) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const x = pos.x + c;
      const y = pos.y + r;
      if (x < 0 || x >= cols || y >= rows) return true;
      if (y >= 0 && board[y][x]) return true;
    }
  }
  return false;
}

/* Merge the piece into a copy of the board. Cells above the top edge
   (negative y) are dropped — a piece locked there is the game-over
   condition checked by `isTopOutLock`. */
export function mergePiece(board, shape, pos, rows = ROWS, cols = COLS) {
  const next = cloneBoard(board);
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const x = pos.x + c;
      const y = pos.y + r;
      if (y >= 0 && y < rows && x >= 0 && x < cols) next[y][x] = 1;
    }
  }
  return next;
}

/* True if any part of the piece is locked above the visible field. */
export function isTopOutLock(shape, pos) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (shape[r][c] && pos.y + r < 0) return true;
    }
  }
  return false;
}

/* --- movement ------------------------------------------------------------- */

export function spawnPos(shape, cols = COLS) {
  return { x: Math.floor((cols - shape[0].length) / 2), y: -2 };
}

/* Naive SRS-style wall kicks: try in-place, then slide left/right by 1–2.
   Good enough for a handheld feel and fully deterministic. */
export const ROTATE_KICKS = [0, -1, 1, -2, 2];

export function rotateCW(matrix) {
  const rows = matrix.length;
  const cols = matrix[0].length;
  const out = Array.from({ length: cols }, () => Array(rows).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out[c][rows - 1 - r] = matrix[r][c];
    }
  }
  return out;
}

/* Try to rotate the active piece in place, applying wall kicks. Returns
   `{ piece, pos }` (new objects) or `null` if every kick collides. */
export function tryRotate(board, piece, pos, kicks = ROTATE_KICKS, rows = ROWS, cols = COLS) {
  const rotated = rotateCW(piece.shape);
  for (const k of kicks) {
    const testPos = { x: pos.x + k, y: pos.y };
    if (!collides(board, rotated, testPos, rows, cols)) {
      return { piece: { ...piece, shape: rotated }, pos: testPos };
    }
  }
  return null;
}

/* --- line clears, score, level -------------------------------------------- */

export function clearLines(board, rows = ROWS, cols = COLS) {
  const kept = board.filter((row) => row.some((cell) => !cell));
  const cleared = rows - kept.length;
  const fresh = Array.from({ length: cleared }, () => Array(cols).fill(0));
  return { board: [...fresh, ...kept], cleared };
}

/* Classic Nintendo scoring table for 1–4 simultaneous lines. */
export const LINE_POINTS = [0, 40, 100, 300, 1200];

export function scoreFor(cleared, level) {
  if (cleared <= 0 || cleared >= LINE_POINTS.length) return 0;
  return LINE_POINTS[cleared] * (level + 1);
}

export const LINES_PER_LEVEL = 10;

/* Level is driven by total lines cleared: one level per 10 lines. */
export function levelFor(totalLines) {
  return Math.floor(totalLines / LINES_PER_LEVEL);
}

export function updateProgress(score, level, totalLines, cleared) {
  const nextLines = totalLines + cleared;
  return {
    score: score + scoreFor(cleared, level),
    totalLines: nextLines,
    level: levelFor(nextLines),
  };
}

/* --- gravity and drop ------------------------------------------------------ */

/* Speed setting shown on the LCD: 1..9, one tick per level. */
export function speedFor(level) {
  return Math.min(9, 1 + level);
}

/* Soft-drop speed multiplier shown on the LCD. */
export function softDropSpeedPercentFor(level) {
  return Math.min(400, 100 + level * 20);
}

/* Gravity interval in ms: starts at 800 ms and shrinks 60 ms per level,
   clamped to a playable floor of 90 ms. */
export function dropIntervalFor(level) {
  return Math.max(90, 800 - level * 60);
}

/* Where a hard drop from `pos` would land. */
export function ghostDropY(board, shape, pos, rows = ROWS, cols = COLS) {
  let y = pos.y;
  while (!collides(board, shape, { x: pos.x, y: y + 1 }, rows, cols)) y++;
  return y;
}

export function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
