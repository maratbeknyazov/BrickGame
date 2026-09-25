import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  COLS,
  ROWS,
  SHAPES,
  PIECE_KEYS,
  createBagFactory,
  shuffledBag,
  emptyBoard,
  cloneBoard,
  collides,
  mergePiece,
  isTopOutLock,
  spawnPos,
  rotateCW,
  tryRotate,
  clearLines,
  LINE_POINTS,
  scoreFor,
  LINES_PER_LEVEL,
  levelFor,
  updateProgress,
  speedFor,
  softDropSpeedPercentFor,
  dropIntervalFor,
  ghostDropY,
  formatTime,
} from "./logic.js";

describe("shuffledBag / createBagFactory", () => {
  it("returns exactly one of each of the 7 pieces", () => {
    const bag = shuffledBag(() => 0);
    expect(bag).toHaveLength(PIECE_KEYS.length);
    expect(new Set(bag)).toEqual(new Set(PIECE_KEYS));
  });

  it("factory hands out full bags without repeats within a bag", () => {
    const next = createBagFactory(() => 0);
    const drawn = Array.from({ length: 7 }, () => next().key);
    expect(new Set(drawn).size).toBe(7);
  });

  it("each factory instance is independent", () => {
    const a = createBagFactory(() => 0);
    const b = createBagFactory(() => 0);
    // same deterministic rng => identical streams, consumed independently
    const firstA = a().key;
    const firstB = b().key;
    expect(firstA).toBe(firstB);
    expect(a().key).toBe(b().key);
  });

  it("respects a custom rng", () => {
    // rng returning 0 always picks the last element during Fisher-Yates
    const next = createBagFactory(() => 0);
    const piece = next();
    expect(SHAPES[piece.key]).toBeDefined();
    expect(piece.shape).toBe(SHAPES[piece.key]);
  });
});

describe("board helpers", () => {
  it("emptyBoard creates ROWS x COLS of zeros", () => {
    const board = emptyBoard();
    expect(board).toHaveLength(ROWS);
    board.forEach((row) => expect(row).toHaveLength(COLS));
    board.forEach((row) => row.forEach((cell) => expect(cell).toBe(0)));
  });

  it("cloneBoard returns a deep copy", () => {
    const board = emptyBoard();
    const clone = cloneBoard(board);
    clone[0][0] = 1;
    expect(board[0][0]).toBe(0);
  });
});

describe("collides", () => {
  it("detects walls", () => {
    const board = emptyBoard();
    expect(collides(board, SHAPES.I, { x: -1, y: 5 })).toBe(true);
    expect(collides(board, SHAPES.I, { x: COLS - 3, y: 5 })).toBe(true); // 4 wide
    expect(collides(board, SHAPES.I, { x: 0, y: 5 })).toBe(false);
  });

  it("detects the floor", () => {
    const board = emptyBoard();
    expect(collides(board, SHAPES.O, { x: 4, y: ROWS - 1 })).toBe(true);
    expect(collides(board, SHAPES.O, { x: 4, y: ROWS - 2 })).toBe(false);
  });

  it("allows cells above the top edge (negative y)", () => {
    const board = emptyBoard();
    expect(collides(board, SHAPES.I, { x: 3, y: -1 })).toBe(false);
  });

  it("detects occupied cells", () => {
    const board = emptyBoard();
    board[10][5] = 1;
    expect(collides(board, SHAPES.O, { x: 5, y: 10 })).toBe(true);
    expect(collides(board, SHAPES.O, { x: 6, y: 10 })).toBe(false);
  });
});

describe("spawnPos", () => {
  it("centers the piece horizontally", () => {
    expect(spawnPos(SHAPES.I)).toEqual({ x: 3, y: -2 });
    expect(spawnPos(SHAPES.O)).toEqual({ x: 4, y: -2 });
  });
});

describe("mergePiece", () => {
  it("merges into a copy without mutating the input", () => {
    const board = emptyBoard();
    const merged = mergePiece(board, SHAPES.O, { x: 4, y: 5 });
    expect(merged[5][4]).toBe(1);
    expect(merged[6][5]).toBe(1);
    expect(board[5][4]).toBe(0);
  });

  it("drops cells above the visible field", () => {
    const board = emptyBoard();
    // T at y=-1: its top row (r=0) falls above the field and is lost,
    // its bottom row (r=1) lands on row 0
    const merged = mergePiece(board, SHAPES.T, { x: 4, y: -1 });
    expect(merged[0][4]).toBe(1);
    expect(merged[0][5]).toBe(1);
    expect(merged[0][6]).toBe(1);
  });
});

describe("isTopOutLock", () => {
  it("detects locks above the field", () => {
    expect(isTopOutLock(SHAPES.I, { x: 3, y: -1 })).toBe(true);
    expect(isTopOutLock(SHAPES.I, { x: 3, y: 0 })).toBe(false);
  });
});

describe("rotateCW", () => {
  it("rotates a 2x2 matrix", () => {
    const m = [
      [1, 0],
      [1, 1],
    ];
    expect(rotateCW(m)).toEqual([
      [1, 1],
      [1, 0],
    ]);
  });

  it("rotates a wide I piece into a tall column", () => {
    const rotated = rotateCW(SHAPES.I);
    expect(rotated).toHaveLength(4); // 4 rows
    expect(rotated[0]).toHaveLength(1); // 1 col
    expect(rotated.every((row) => row[0] === 1)).toBe(true);
  });

  it("returns a new matrix without mutating the input", () => {
    const m = [
      [1, 0],
      [1, 1],
    ];
    const snapshot = JSON.stringify(m);
    rotateCW(m);
    expect(JSON.stringify(m)).toBe(snapshot);
  });
});

describe("tryRotate", () => {
  it("rotates in place when there is room", () => {
    const board = emptyBoard();
    const result = tryRotate(board, { key: "T", shape: SHAPES.T }, { x: 4, y: 5 });
    expect(result).not.toBeNull();
    expect(result.piece.shape).toEqual([
      [1, 0],
      [1, 1],
      [1, 0],
    ]);
  });

  it("applies a wall kick when in-place rotation is blocked", () => {
    const board = emptyBoard();
    // T at x=4,y=5 rotates into cells (4,5),(4,6),(5,6),(4,7).
    // Block (5,6) and (4,6) so kicks 0, -1 and +1 all collide;
    // kick -2 is the first free placement => x = 4 - 2 = 2.
    board[6][4] = 1;
    board[6][5] = 1;
    const result = tryRotate(board, { key: "T", shape: SHAPES.T }, { x: 4, y: 5 });
    expect(result).not.toBeNull();
    expect(result.pos.x).toBe(2);
  });

  it("returns null when every kick collides", () => {
    const board = emptyBoard();
    // fill the whole board
    for (let r = 0; r < ROWS; r++) board[r].fill(1);
    const result = tryRotate(board, { key: "T", shape: SHAPES.T }, { x: 4, y: 5 });
    expect(result).toBeNull();
  });
});

describe("clearLines", () => {
  it("clears full rows and shifts the rest down", () => {
    const board = emptyBoard();
    board[ROWS - 1].fill(1);
    board[ROWS - 2][0] = 1;
    const { board: next, cleared } = clearLines(board);
    expect(cleared).toBe(1);
    expect(next[ROWS - 1][0]).toBe(1); // the half-full row moved down
    expect(next[ROWS - 1].some((c) => c === 0)).toBe(true);
    expect(next[0].every((c) => c === 0)).toBe(true);
  });

  it("clears multiple rows at once", () => {
    const board = emptyBoard();
    board[ROWS - 1].fill(1);
    board[ROWS - 2].fill(1);
    const { cleared } = clearLines(board);
    expect(cleared).toBe(2);
  });
});

describe("scoring and levels", () => {
  it("follows the Nintendo table", () => {
    expect(LINE_POINTS).toEqual([0, 40, 100, 300, 1200]);
    expect(scoreFor(1, 0)).toBe(40);
    expect(scoreFor(4, 0)).toBe(1200);
    expect(scoreFor(2, 2)).toBe(300); // 100 * (2+1)
    expect(scoreFor(0, 5)).toBe(0);
  });

  it("one level per 10 lines", () => {
    expect(LINES_PER_LEVEL).toBe(10);
    expect(levelFor(0)).toBe(0);
    expect(levelFor(9)).toBe(0);
    expect(levelFor(10)).toBe(1);
    expect(levelFor(25)).toBe(2);
  });

  it("updateProgress accumulates lines and recomputes the level", () => {
    const a = updateProgress(0, 0, 0, 1);
    expect(a).toEqual({ score: 40, totalLines: 1, level: 0 });
    const b = updateProgress(a.score, a.level, a.totalLines, 4);
    expect(b.score).toBe(40 + 1200);
    expect(b.totalLines).toBe(5);
    expect(b.level).toBe(0);
    // crossing the 10-line boundary bumps the level
    const c = updateProgress(b.score, b.level, b.totalLines, 5);
    expect(c.totalLines).toBe(10);
    expect(c.level).toBe(1);
  });
});

describe("speed table", () => {
  it("speed display is 1..9", () => {
    expect(speedFor(0)).toBe(1);
    expect(speedFor(8)).toBe(9);
    expect(speedFor(20)).toBe(9);
  });

  it("soft-drop percent caps at 400", () => {
    expect(softDropSpeedPercentFor(0)).toBe(100);
    expect(softDropSpeedPercentFor(5)).toBe(200);
    expect(softDropSpeedPercentFor(99)).toBe(400);
  });

  it("gravity shrinks with level and floors at 90ms", () => {
    expect(dropIntervalFor(0)).toBe(800);
    expect(dropIntervalFor(1)).toBe(740);
    expect(dropIntervalFor(12)).toBe(90);
    expect(dropIntervalFor(20)).toBe(90);
  });
});

describe("ghostDropY", () => {
  it("drops to the floor on an empty board", () => {
    const board = emptyBoard();
    const y = ghostDropY(board, SHAPES.O, { x: 4, y: 0 });
    expect(y).toBe(ROWS - 2);
  });

  it("stacks on top of settled cells", () => {
    const board = emptyBoard();
    board[ROWS - 1][4] = 1;
    board[ROWS - 1][5] = 1;
    const y = ghostDropY(board, SHAPES.O, { x: 4, y: 0 });
    expect(y).toBe(ROWS - 3);
  });

  it("returns the current position when already resting", () => {
    const board = emptyBoard();
    board[ROWS - 1][4] = 1;
    board[ROWS - 1][5] = 1;
    const pos = { x: 4, y: ROWS - 3 };
    expect(ghostDropY(board, SHAPES.O, pos)).toBe(pos.y);
  });
});

describe("formatTime", () => {
  it("formats mm:ss", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(600)).toBe("10:00");
  });
});

describe("integration: lock-in sequence", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("merge -> clear -> progress produces a consistent state", () => {
    const board = emptyBoard();
    // build 9 filled cells in the bottom row, then drop an O to complete it
    for (let c = 0; c < COLS; c++) {
      if (c !== 4 && c !== 5) board[ROWS - 1][c] = 1;
    }
    // another block above so the O lands at ROWS-2
    board[ROWS - 2][4] = 1;
    board[ROWS - 2][5] = 1;

    const landed = { x: 4, y: ROWS - 4 };
    const merged = mergePiece(board, SHAPES.O, landed);
    // move the O down manually until it rests (simulating gravity)
    let y = landed.y;
    while (!collides(merged, SHAPES.O, { x: 4, y: y + 1 })) y++;
    const settled = mergePiece(merged, SHAPES.O, { x: 4, y });
    expect(settled[ROWS - 3][4]).toBe(1);
    expect(settled[ROWS - 3][5]).toBe(1);
  });
});
