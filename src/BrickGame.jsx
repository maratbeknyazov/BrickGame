import { useState, useEffect, useRef, useCallback } from "react";

import {
  COLS,
  ROWS,
  createBagFactory,
  emptyBoard,
  collides,
  mergePiece,
  isTopOutLock,
  spawnPos,
  tryRotate as rotateWithKicks,
  clearLines,
  updateProgress,
  speedFor,
  softDropSpeedPercentFor,
  dropIntervalFor,
  ghostDropY,
  formatTime,
} from "./game/logic.js";

/* =========================================================================
   BRICK — a classic handheld-style falling-block puzzle game.
   Single self-contained React component. No external assets.
   ========================================================================= */

const CELL = 18;
const DEVICE_WIDTH = 430;
const PANEL_WIDTH = 128;

const LS_KEYS = {
  hiScore: "brick_hiscore",
  muted: "brick_muted",
  theme: "brick_theme",
  vibrate: "brick_vibrate",
  gesture: "brick_gesture",
  quickDown: "brick_quickdown",
};

function lsGet(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}
function lsSet(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* storage unavailable, ignore */
  }
}

const THEME_SWATCHES = [
  "#2e8ec4", // classic blue
  "#e0356b", // pink
  "#e08a2e", // orange
  "#2e9e52", // green
  "#9aa62e", // olive
  "#b8342a", // red
  "#6b7680", // grey
  "#1fa898", // teal
  "#7a3fb0", // purple
  "#3d6a86", // steel
];

/* lighten (positive) / darken (negative) a hex color by a 0-100 amount */
function shade(hex, amt) {
  const h = hex.replace("#", "");
  const num = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  const delta = Math.round((amt / 100) * 255);
  let r = (num >> 16) + delta;
  let g = ((num >> 8) & 0x00ff) + delta;
  let b = (num & 0x0000ff) + delta;
  r = Math.min(255, Math.max(0, r));
  g = Math.min(255, Math.max(0, g));
  b = Math.min(255, Math.max(0, b));
  return "#" + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
}

/* Seven-segment style number readout: ghost "8"s for unused digits,
   real digits lit up, matching a classic LCD handheld look. */
function Readout({ value, digits, ghost = true, size = 20 }) {
  const str = String(value);
  const padded = str.length < digits ? str.padStart(digits, "0") : str;
  const firstLit = padded.length - str.length;
  return (
    <span style={{ fontFamily: "'Courier New', monospace", fontWeight: 700, fontSize: size, letterSpacing: 1 }}>
      {ghost &&
        Array.from({ length: digits }).map((_, i) => (
          <span key={i} style={{ color: i < firstLit ? "rgba(58,74,58,0.25)" : "#3a4a3a" }}>
            {i < firstLit ? "8" : padded[i]}
          </span>
        ))}
      {!ghost && str}
    </span>
  );
}

/* filled: part of the settled board. active: the live falling piece
   (rendered in an accent color so it reads clearly against the board).
   ghostCell: translucent outline showing where the piece will land. */
function Cell({ filled, size, active, ghostCell, accent }) {
  if (ghostCell) {
    return (
      <div
        style={{
          width: size,
          height: size,
          boxSizing: "border-box",
          borderRadius: Math.max(2, size * 0.14),
          background: "rgba(58,74,58,0.06)",
          border: `1.5px dashed ${accent || "#3a4a3a"}`,
          opacity: 0.65,
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        boxSizing: "border-box",
        borderRadius: Math.max(2, size * 0.14),
        background: filled ? (active ? accent || "#3a4a3a" : "#3a4a3a") : "rgba(58,74,58,0.10)",
        border: filled ? `2px solid ${active ? shade(accent || "#3a4a3a", -35) : "#212b1f"}` : "1.5px solid rgba(58,74,58,0.32)",
        boxShadow: filled
          ? "inset 0 1px 1px rgba(255,255,255,0.15), inset 0 -1px 1px rgba(0,0,0,0.25)"
          : "inset 0 1px 1px rgba(255,255,255,0.35), inset 0 -1px 1px rgba(58,74,58,0.15)",
      }}
    />
  );
}

function MiniPiece({ shape, cols = 4, rows = 2, size = 15 }) {
  const cells = Array.from({ length: rows }, () => Array(cols).fill(0));
  const h = shape ? shape.length : 0;
  const w = shape ? shape[0].length : 0;
  const offY = Math.floor((rows - h) / 2);
  const offX = Math.floor((cols - w) / 2);
  if (shape) {
    for (let r = 0; r < h; r++)
      for (let c = 0; c < w; c++)
        if (shape[r][c] && r + offY >= 0 && r + offY < rows && c + offX >= 0 && c + offX < cols)
          cells[r + offY][c + offX] = 1;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, ${size}px)`, gridTemplateRows: `repeat(${rows}, ${size}px)`, gap: 2 }}>
      {cells.flat().map((v, i) => (
        <Cell key={i} filled={!!v} size={size} />
      ))}
    </div>
  );
}

/* A round control button with a glossy highlight, a press animation
   and its caption printed underneath — used for every knob on the shell.
   Press-and-hold auto-repeat (DAS) is driven by onHoldStart/onHoldEnd;
   preventDefault on pointerdown stops touch devices from also firing a
   synthetic click on release (which would double the action). */
function Knob({ onClick, onHoldStart, onHoldEnd, size, from, mid, edge, pressed, ariaLabel }) {
  const handleClick = (e) => {
    if (onHoldStart) {
      e.preventDefault(); // pointerup-generated click would duplicate the hold
      return;
    }
    if (onClick) onClick(e);
  };
  return (
    <button
      onClick={handleClick}
      onPointerDown={() => onHoldStart && onHoldStart()}
      onPointerUp={() => onHoldEnd && onHoldEnd()}
      onPointerLeave={() => onHoldEnd && onHoldEnd()}
      onPointerCancel={() => onHoldEnd && onHoldEnd()}
      aria-label={ariaLabel}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        position: "relative",
        border: `2px solid ${edge}`,
        background: `radial-gradient(circle at 34% 28%, ${from}, ${mid} 60%, ${edge} 100%)`,
        boxShadow: pressed ? `0 2px 0 ${edge}, inset 0 3px 6px rgba(0,0,0,0.3)` : `0 5px 0 ${edge}, 0 8px 12px rgba(0,0,0,0.4)`,
        cursor: "pointer",
        userSelect: "none",
        touchAction: "manipulation",
        transform: pressed ? "translateY(3px)" : "translateY(0)",
        transition: "transform 0.09s ease, box-shadow 0.09s ease",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: "10%",
          left: "16%",
          width: "46%",
          height: "30%",
          borderRadius: "50%",
          background: "rgba(255,255,255,0.5)",
          filter: "blur(1.5px)",
          pointerEvents: "none",
        }}
      />
    </button>
  );
}

const labelStyle = {
  fontSize: 10.5,
  fontWeight: 700,
  color: "#0d1a24",
  letterSpacing: 0.3,
  textAlign: "center",
  lineHeight: 1.25,
  textShadow: "0 1px 0 rgba(255,255,255,0.3)",
};

/* Toggle row used in the OPTIONS modal (Sound / Quick down / Vibrate / Gesture). */
function ToggleRow({ icon, label, on, onToggle, last }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 2px",
        borderBottom: last ? "none" : "1px solid rgba(255,255,255,0.12)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 18 }} aria-hidden="true">
          {icon}
        </span>
        <span style={{ fontSize: 14 }} id={`toggle-${label.replace(/\s+/g, "-").toLowerCase()}`}>
          {label}
        </span>
      </div>
      <button
        onClick={onToggle}
        role="switch"
        aria-checked={on}
        aria-labelledby={`toggle-${label.replace(/\s+/g, "-").toLowerCase()}`}
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          border: `2px solid ${on ? "#3fbf3f" : "rgba(255,255,255,0.3)"}`,
          background: on ? "rgba(63,191,63,0.15)" : "transparent",
          color: on ? "#7de87d" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        ✓
      </button>
    </div>
  );
}

export default function BrickGame() {
  const [board, setBoard] = useState(emptyBoard);
  const [piece, setPiece] = useState(null);
  const [pos, setPos] = useState(null);
  const [nextPiece, setNextPiece] = useState(null);
  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);
  const [hiScore, setHiScore] = useState(() => lsGet(LS_KEYS.hiScore, 0));
  const [level, setLevel] = useState(0);
  const [totalLines, setTotalLines] = useState(0);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [muted, setMuted] = useState(() => lsGet(LS_KEYS.muted, false));
  const [vibrateOn, setVibrateOn] = useState(() => lsGet(LS_KEYS.vibrate, true));
  const [gestureOn, setGestureOn] = useState(() => lsGet(LS_KEYS.gesture, false));
  const [quickDown, setQuickDown] = useState(() => lsGet(LS_KEYS.quickDown, false));
  const [seconds, setSeconds] = useState(0);
  const [flash, setFlash] = useState(null); // pressed-button visual feedback
  const [showOptions, setShowOptions] = useState(false);
  const [themeHex, setThemeHex] = useState(() => lsGet(LS_KEYS.theme, "#2e8ec4"));

  const audioCtxRef = useRef(null);
  const boardRef = useRef(board);
  const posRef = useRef(pos);
  const pieceRef = useRef(piece);
  const nextPieceRef = useRef(nextPiece);
  const levelRef = useRef(level);
  const totalLinesRef = useRef(totalLines);
  const runningRef = useRef(running);
  const pausedRef = useRef(paused);
  const gameOverRef = useRef(gameOver);
  const showOptionsRef = useRef(showOptions);
  const quickDownRef = useRef(quickDown);
  const colorInputRef = useRef(null);
  const dasRef = useRef({ timeout: null, interval: null });
  const touchRef = useRef(null);
  const flashTimeoutRef = useRef(null);
  const bagRef = useRef(null);
  const optionsDialogRef = useRef(null);

  scoreRef.current = score;
  boardRef.current = board;
  posRef.current = pos;
  pieceRef.current = piece;
  nextPieceRef.current = nextPiece;
  levelRef.current = level;
  totalLinesRef.current = totalLines;
  runningRef.current = running;
  pausedRef.current = paused;
  gameOverRef.current = gameOver;
  showOptionsRef.current = showOptions;
  quickDownRef.current = quickDown;

  const dropInterval = dropIntervalFor(level);

  // persist settings
  useEffect(() => lsSet(LS_KEYS.hiScore, hiScore), [hiScore]);
  useEffect(() => lsSet(LS_KEYS.muted, muted), [muted]);
  useEffect(() => lsSet(LS_KEYS.theme, themeHex), [themeHex]);
  useEffect(() => lsSet(LS_KEYS.vibrate, vibrateOn), [vibrateOn]);
  useEffect(() => lsSet(LS_KEYS.gesture, gestureOn), [gestureOn]);
  useEffect(() => lsSet(LS_KEYS.quickDown, quickDown), [quickDown]);
  useEffect(() => {
    if (score > hiScore) setHiScore(score);
  }, [score, hiScore]);

  // Keep the per-instance 7-bag factory in a ref: every mounted game gets
  // its own independent shuffle sequence.
  if (!bagRef.current) bagRef.current = createBagFactory();
  const randomPiece = useCallback(() => bagRef.current(), []);

  const getAudioCtx = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        audioCtxRef.current = new Ctx();
      }
      const ctx = audioCtxRef.current;
      // Safari/iOS often start a freshly-created context "suspended" even
      // after a user gesture — explicitly resume it so sound isn't silently
      // dropped on first play.
      if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
      return ctx;
    } catch (e) {
      return null;
    }
  }, []);

  const beep = useCallback(
    (freq = 440, dur = 0.06, type = "square", delay = 0) => {
      if (muted) return;
      const ctx = getAudioCtx();
      if (!ctx) return;
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.value = 0.05;
        osc.connect(gain);
        gain.connect(ctx.destination);
        const t0 = ctx.currentTime + delay;
        osc.start(t0);
        gain.gain.setValueAtTime(0.06, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.stop(t0 + dur);
      } catch (e) {
        /* audio unavailable, ignore */
      }
    },
    [muted, getAudioCtx]
  );

  /* Close the AudioContext on unmount so the browser doesn't keep the
     audio device open for a dead component. */
  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        try {
          audioCtxRef.current.close().catch(() => {});
        } catch (e) {
          /* already closed */
        }
        audioCtxRef.current = null;
      }
    };
  }, []);

  /* A short rising arpeggio played when a line disappears — more
     satisfying than a single flat beep. */
  const playClearSound = useCallback(
    (linesCleared) => {
      const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
      const count = Math.min(notes.length, 2 + linesCleared);
      for (let i = 0; i < count; i++) {
        beep(notes[i], 0.1, "triangle", i * 0.045);
      }
    },
    [beep]
  );

  const doVibrate = useCallback(
    (pattern = 12) => {
      if (!vibrateOn) return;
      try {
        if (navigator.vibrate) navigator.vibrate(pattern);
      } catch (e) {
        /* not supported, ignore */
      }
    },
    [vibrateOn]
  );

  const resetGame = useCallback(() => {
    setBoard(emptyBoard());
    const p = randomPiece();
    const np = randomPiece();
    setPiece(p);
    setPos(spawnPos(p.shape));
    setNextPiece(np);
    setScore(0);
    scoreRef.current = 0;
    setLevel(0);
    setTotalLines(0);
    totalLinesRef.current = 0;
    setSeconds(0);
    setGameOver(false);
    setPaused(false);
    setRunning(true);
  }, [randomPiece]);

  const flashBtn = useCallback(
    (name) => {
      setFlash(name);
      doVibrate(10);
      if (flashTimeoutRef.current) window.clearTimeout(flashTimeoutRef.current);
      flashTimeoutRef.current = window.setTimeout(() => setFlash(null), 140);
    },
    [doVibrate]
  );

  // Clear the pending flash timer on unmount (no setFlash after death).
  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) window.clearTimeout(flashTimeoutRef.current);
    };
  }, []);

  /* Lock the active piece into the board, clear lines, award score and
     spawn the next piece. Lock-out: if any cell locked above the visible
     field OR the next piece cannot spawn, the game ends. */
  const lockPiece = useCallback(() => {
    const merged = mergePiece(boardRef.current, pieceRef.current.shape, posRef.current);
    const topOut = isTopOutLock(pieceRef.current.shape, posRef.current);
    const { board: clearedBoard, cleared } = clearLines(merged);
    if (cleared > 0) {
      playClearSound(cleared);
      doVibrate(cleared >= 4 ? [20, 40, 20] : 18);
      const prog = updateProgress(scoreRef.current, levelRef.current, totalLinesRef.current, cleared);
      scoreRef.current = prog.score;
      totalLinesRef.current = prog.totalLines;
      setScore(prog.score);
      setTotalLines(prog.totalLines);
      setLevel(prog.level);
    }
    setBoard(clearedBoard);

    if (topOut) {
      setGameOver(true);
      setRunning(false);
      beep(120, 0.4, "sawtooth");
      doVibrate([30, 30, 30]);
      return;
    }

    const np = nextPieceRef.current;
    const spawn = spawnPos(np.shape);
    if (collides(clearedBoard, np.shape, spawn)) {
      setGameOver(true);
      setRunning(false);
      beep(120, 0.4, "sawtooth");
      doVibrate([30, 30, 30]);
      return;
    }
    setPiece(np);
    setPos(spawn);
    setNextPiece(randomPiece());
  }, [randomPiece, beep, playClearSound, doVibrate]);

  const tryMove = useCallback(
    (dx, dy) => {
      if (!runningRef.current || pausedRef.current || gameOverRef.current || showOptionsRef.current) return false;
      if (!pieceRef.current) return false;
      const next = { x: posRef.current.x + dx, y: posRef.current.y + dy };
      if (!collides(boardRef.current, pieceRef.current.shape, next)) {
        setPos(next);
        return true;
      }
      if (dy > 0) {
        lockPiece();
      }
      return false;
    },
    [lockPiece]
  );

  const tryRotate = useCallback(() => {
    if (!runningRef.current || pausedRef.current || gameOverRef.current || showOptionsRef.current) return;
    if (!pieceRef.current) return;
    const result = rotateWithKicks(boardRef.current, pieceRef.current, posRef.current);
    if (result) {
      setPiece(result.piece);
      setPos(result.pos);
      beep(660, 0.04);
    }
  }, [beep]);

  /* Hard drop is applied atomically: position and the merged board update
     in the same tick, so lockPiece below always sees the piece at its
     final resting place (fixes the double-lock race from the old version). */
  const hardDrop = useCallback(() => {
    if (!runningRef.current || pausedRef.current || gameOverRef.current || showOptionsRef.current) return;
    if (!pieceRef.current) return;
    const y = ghostDropY(boardRef.current, pieceRef.current.shape, posRef.current);
    const landed = { x: posRef.current.x, y };
    setPos(landed);
    posRef.current = landed;
    const merged = mergePiece(boardRef.current, pieceRef.current.shape, landed);
    boardRef.current = merged;
    setBoard(merged);
    beep(300, 0.05);
    doVibrate(16);
    lockPiece();
  }, [lockPiece, beep, doVibrate]);

  const stopAutoRepeat = useCallback(() => {
    if (dasRef.current.timeout) window.clearTimeout(dasRef.current.timeout);
    if (dasRef.current.interval) window.clearInterval(dasRef.current.interval);
    dasRef.current.timeout = null;
    dasRef.current.interval = null;
  }, []);

  /* Delayed Auto Shift: move immediately, wait ~180ms, then repeat the
     move every ~50ms while the key/button stays held. */
  const startAutoRepeat = useCallback(
    (action) => {
      stopAutoRepeat();
      action();
      dasRef.current.timeout = window.setTimeout(() => {
        dasRef.current.interval = window.setInterval(action, 50);
      }, 180);
    },
    [stopAutoRepeat]
  );

  useEffect(() => stopAutoRepeat, [stopAutoRepeat]);

  // gravity — also stops while OPTIONS is open so the piece can't fall
  // (or lock, or trigger game over) behind the settings modal
  useEffect(() => {
    if (!running || paused || gameOver || showOptions) return;
    const id = window.setInterval(() => tryMove(0, 1), dropInterval);
    return () => window.clearInterval(id);
  }, [running, paused, gameOver, showOptions, dropInterval, tryMove]);

  useEffect(() => {
    if (!running || paused || gameOver || showOptions) return;
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [running, paused, gameOver, showOptions]);

  useEffect(() => {
    const onKey = (e) => {
      // While OPTIONS is open, swallow all gameplay input — Escape (or the
      // O shortcut) closes the modal, everything else is ignored so the
      // player can't move/drop the piece blind.
      if (showOptionsRef.current) {
        if (e.key === "Escape") {
          e.preventDefault();
          setShowOptions(false);
        }
        return;
      }

      if (["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", " "].includes(e.key)) e.preventDefault();
      if (!runningRef.current && (e.key === "Enter" || e.key === " ")) {
        resetGame();
        return;
      }
      switch (e.key) {
        case "ArrowLeft":
          if (!e.repeat) startAutoRepeat(() => tryMove(-1, 0));
          flashBtn("left");
          break;
        case "ArrowRight":
          if (!e.repeat) startAutoRepeat(() => tryMove(1, 0));
          flashBtn("right");
          break;
        case "ArrowDown":
          if (!e.repeat) {
            if (quickDownRef.current) hardDrop();
            else startAutoRepeat(() => tryMove(0, 1));
          }
          flashBtn("down");
          break;
        case "ArrowUp":
        case "x":
        case "X":
          tryRotate();
          flashBtn("rotate");
          break;
        case " ":
          hardDrop();
          flashBtn("up");
          break;
        case "p":
        case "P":
          setPaused((p) => !p);
          flashBtn("pause");
          break;
        case "m":
        case "M":
          setMuted((m) => !m);
          flashBtn("sound");
          break;
        default:
          break;
      }
    };
    const onKeyUp = (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowDown") stopAutoRepeat();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [tryMove, tryRotate, hardDrop, resetGame, startAutoRepeat, stopAutoRepeat, flashBtn]);

  const handlePauseStart = () => {
    flashBtn("pause");
    if (!running || gameOver) resetGame();
    else setPaused((p) => !p);
  };
  const handleReset = () => {
    flashBtn("reset");
    resetGame();
  };
  const handleQuickLevels = () => {
    flashBtn("up");
    if (!running || paused || gameOver || showOptions) return;
    setLevel((lv) => lv + 1);
    beep(990, 0.08);
  };
  const handleLeft = () => {
    flashBtn("left");
    tryMove(-1, 0);
  };
  const handleRight = () => {
    flashBtn("right");
    tryMove(1, 0);
  };
  const handleDown = () => {
    flashBtn("down");
    if (quickDownRef.current) hardDrop();
    else tryMove(0, 1);
  };
  const handleRotate = () => {
    flashBtn("rotate");
    tryRotate();
  };
  const handleSound = () => {
    flashBtn("sound");
    setMuted((m) => !m);
  };
  const handleOptions = () => {
    flashBtn("options");
    setShowOptions((o) => !o);
  };
  const pickTheme = (hex) => {
    setThemeHex(hex);
    beep(520, 0.04);
  };

  // press-and-hold auto-repeat for the on-screen D-pad buttons
  const holdLeft = () => startAutoRepeat(() => tryMove(-1, 0));
  const holdRight = () => startAutoRepeat(() => tryMove(1, 0));
  const holdDown = () => {
    if (quickDownRef.current) return; // quick-down already drops instantly on click
    startAutoRepeat(() => tryMove(0, 1));
  };

  // simple swipe-to-move / tap-to-rotate gesture support on the board,
  // gated behind the Gesture toggle in OPTIONS
  const onBoardTouchStart = (e) => {
    if (!gestureOn) return;
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };
  const onBoardTouchEnd = (e) => {
    if (!gestureOn || !touchRef.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchRef.current.x;
    const dy = t.clientY - touchRef.current.y;
    const dt = Date.now() - touchRef.current.t;
    touchRef.current = null;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absX < 18 && absY < 18 && dt < 300) {
      tryRotate();
      flashBtn("rotate");
      return;
    }
    if (absX > absY) {
      if (dx > 0) {
        handleRight();
      } else {
        handleLeft();
      }
    } else if (dy > 0) {
      if (dy > 60) {
        hardDrop();
        flashBtn("up");
      } else {
        handleDown();
      }
    }
  };

  // OPTIONS dialog focus management: focus the dialog on open, restore
  // focus to the options button on close, trap Tab inside while open.
  const optionsBtnRef = useRef(null);
  useEffect(() => {
    if (!showOptions) return;
    const dialog = optionsDialogRef.current;
    const optionsBtn = optionsBtnRef.current;
    if (dialog) {
      const focusables = dialog.querySelectorAll("button");
      if (focusables.length) focusables[0].focus();
    }
    const onKey = (e) => {
      if (e.key !== "Tab" || !optionsDialogRef.current) return;
      const items = optionsDialogRef.current.querySelectorAll("button");
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (optionsBtn) optionsBtn.focus();
    };
  }, [showOptions]);

  const displayBoard = board.map((row) => row.slice());
  if (piece && pos) {
    for (let r = 0; r < piece.shape.length; r++) {
      for (let c = 0; c < piece.shape[r].length; c++) {
        if (!piece.shape[r][c]) continue;
        const x = pos.x + c;
        const y = pos.y + r;
        if (y >= 0 && y < ROWS && x >= 0 && x < COLS) displayBoard[y][x] = 2;
      }
    }
  }

  // ghost outline: where the piece would land on a hard drop
  const ghostY = running && !paused && !gameOver && piece && pos ? ghostDropY(board, piece.shape, pos) : pos ? pos.y : -2;
  const ghostCells = new Set();
  if (piece && pos && ghostY !== pos.y) {
    for (let r = 0; r < piece.shape.length; r++) {
      for (let c = 0; c < piece.shape[r].length; c++) {
        if (!piece.shape[r][c]) continue;
        const x = pos.x + c;
        const y = ghostY + r;
        if (y >= 0 && y < ROWS && x >= 0 && x < COLS && displayBoard[y][x] === 0) {
          ghostCells.add(y * COLS + x);
        }
      }
    }
  }

  // theme-derived shell / accent colors
  const shellLight = shade(themeHex, 32);
  const shellMid = themeHex;
  const shellDark = shade(themeHex, -22);
  const ledgeColor = shade(themeHex, 22);
  const seamDark = shade(themeHex, -30);
  // the active falling piece is drawn in a brightened version of the
  // shell color so it stands out clearly from the settled board cells
  const activeAccent = shade(themeHex, 30);

  const orangeKnob = { from: "#ffd35c", mid: "#f5a623", edge: "#c77c0c" };
  const redKnob = { from: "#ff9a8c", mid: "#e8483a", edge: "#a11e14" };
  const greenKnob = { from: "#9df29a", mid: "#3fbf3f", edge: "#1c7a1c" };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "20px 12px 60px",
        background: "linear-gradient(180deg,#e7ecef,#d4dbe0)",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <div
        style={{
          width: DEVICE_WIDTH,
          maxWidth: "100%",
          borderRadius: 34,
          background: `linear-gradient(180deg, ${shellLight} 0%, ${shellMid} 45%, ${shellDark} 100%)`,
          boxShadow: `0 18px 40px rgba(0,0,0,0.35), inset 0 3px 0 rgba(255,255,255,0.35)`,
          padding: "24px 20px 30px",
          position: "relative",
        }}
      >
        {/* Title */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, margin: "0 8px 16px" }}>
          <div style={{ flex: 1, height: 0, borderTop: "5px dashed #0d1a24", opacity: 0.85, borderRadius: 3 }} />
          <div
            style={{
              fontSize: 32,
              fontWeight: 900,
              letterSpacing: 1.5,
              color: "#0d1a24",
              fontFamily: "'Arial Rounded MT Bold', 'Arial Black', Arial, sans-serif",
              whiteSpace: "nowrap",
            }}
          >
            BRICK
          </div>
          <div style={{ flex: 1, height: 0, borderTop: "5px dashed #0d1a24", opacity: 0.85, borderRadius: 3 }} />
        </div>

        {/* Screen bezel: thick black frame, olive LCD sits on a themed "ledge" shadow */}
        <div
          style={{
            borderRadius: 20,
            background: "#0e1720",
            padding: 14,
            boxShadow: "0 6px 14px rgba(0,0,0,0.35)",
          }}
        >
          <div
            style={{
              borderRadius: 8,
              background: "#a9b795",
              padding: 10,
              display: "flex",
              gap: 10,
              boxShadow: `inset 0 0 14px rgba(0,0,0,0.4), 6px 6px 0 0 ${ledgeColor}, 6px 6px 16px rgba(0,0,0,0.25)`,
            }}
          >
            {/* Board */}
            <div
              onTouchStart={onBoardTouchStart}
              onTouchEnd={onBoardTouchEnd}
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${COLS}, ${CELL}px)`,
                gridTemplateRows: `repeat(${ROWS}, ${CELL}px)`,
                gap: 2,
                position: "relative",
                flexShrink: 0,
                touchAction: gestureOn ? "none" : "auto",
              }}
            >
              {displayBoard.flat().map((v, i) => (
                <Cell key={i} filled={!!v} size={CELL} active={v === 2} accent={activeAccent} ghostCell={v === 0 && ghostCells.has(i)} />
              ))}

              {(paused || gameOver || !running) && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "rgba(169,183,149,0.94)",
                    textAlign: "center",
                    padding: 10,
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: 18, color: "#2c3a2c", marginBottom: 6 }}>
                    {gameOver ? "GAME OVER" : !running ? "WELCOME" : "PAUSED"}
                  </div>
                  <div style={{ fontSize: 12, color: "#3a4a3a", lineHeight: 1.5 }}>
                    {gameOver
                      ? `Score ${score} — press START`
                      : !running
                      ? "TAP DIRECTION BTNS TO SELECT..."
                      : "Press PAUSE/START to resume"}
                  </div>
                </div>
              )}
            </div>

            {/* Side stats */}
            <div style={{ width: PANEL_WIDTH, flexShrink: 0, display: "flex", flexDirection: "column", gap: 7, paddingTop: 2 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#2c3a2c", whiteSpace: "nowrap" }}>HI-SCORE</div>
                <Readout value={hiScore} digits={6} size={15} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#2c3a2c", whiteSpace: "nowrap" }}>SCORE</div>
                <Readout value={score} digits={6} size={15} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#2c3a2c", whiteSpace: "nowrap" }}>LINES</div>
                <Readout value={totalLines} digits={6} size={15} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#2c3a2c", whiteSpace: "nowrap" }}>LEVELS</div>
                <Readout value={level} digits={2} size={15} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#2c3a2c", whiteSpace: "nowrap" }}>SPEED</div>
                <Readout value={speedFor(level)} digits={1} ghost={false} size={17} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#2c3a2c", marginBottom: 4, whiteSpace: "nowrap" }}>NEXT</div>
                <MiniPiece shape={nextPiece ? nextPiece.shape : null} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#2c3a2c", whiteSpace: "nowrap" }}>SPEED UP</div>
                <Readout value={`${softDropSpeedPercentFor(level)}%`} digits={0} ghost={false} size={16} />
              </div>

              <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#2c3a2c", fontWeight: 700 }}>
                <span style={{ fontSize: 13 }}>{muted ? "\u{1F507}" : "\u{1F50A}"}</span>
                {paused && !gameOver && running && <span style={{ letterSpacing: -1 }}>II</span>}
                <span style={{ fontFamily: "'Courier New', monospace" }}>{formatTime(seconds)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* seam */}
        <div style={{ height: 24, margin: "18px -20px 0", background: `linear-gradient(180deg, ${shellMid}, ${seamDark})`, boxShadow: "inset 0 4px 8px rgba(0,0,0,0.3)" }} />

        {/* Small function buttons row (above the D-pad, like the original) */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 20, marginTop: 16, paddingRight: 2 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
            <Knob onClick={handleReset} size={44} {...redKnob} pressed={flash === "reset"} ariaLabel="Reset" />
            <span style={labelStyle}>RESET</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
            <Knob onClick={handleSound} size={44} {...greenKnob} pressed={flash === "sound"} ariaLabel="Sound" />
            <span style={labelStyle}>SOUND</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
            <Knob onClick={handlePauseStart} size={44} {...greenKnob} pressed={flash === "pause"} ariaLabel="Pause / Start" />
            <span style={labelStyle}>
              PAUSE
              <br />
              START
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
            <div ref={optionsBtnRef} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
              <Knob onClick={handleOptions} size={44} {...greenKnob} pressed={flash === "options"} ariaLabel="Options" />
            </div>
            <span style={labelStyle}>OPTIONS</span>
          </div>
        </div>

        {/* D-pad + Rotate row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: 32, paddingRight: 4 }}>
          {/* D-pad */}
          <div style={{ position: "relative", width: 180, height: 214 }}>
            <div style={{ position: "absolute", top: -20, left: 26, ...labelStyle, whiteSpace: "nowrap", textAlign: "left" }}>QUICK LEVELS+</div>
            <div style={{ position: "absolute", top: 0, left: 53 }}>
              <Knob onClick={handleQuickLevels} size={74} {...orangeKnob} pressed={flash === "up"} ariaLabel="Quick Levels+" />
            </div>
            <div style={{ position: "absolute", top: 53, left: 0 }}>
              <Knob onClick={handleLeft} onHoldStart={holdLeft} onHoldEnd={stopAutoRepeat} size={74} {...orangeKnob} pressed={flash === "left"} ariaLabel="Left / Speed-" />
            </div>
            <div style={{ position: "absolute", top: 53, left: 106 }}>
              <Knob onClick={handleRight} onHoldStart={holdRight} onHoldEnd={stopAutoRepeat} size={74} {...orangeKnob} pressed={flash === "right"} ariaLabel="Right / Speed+" />
            </div>
            <div style={{ position: "absolute", top: 106, left: 53 }}>
              <Knob onClick={handleDown} onHoldStart={holdDown} onHoldEnd={stopAutoRepeat} size={74} {...orangeKnob} pressed={flash === "down"} ariaLabel="Down / Level-" />
            </div>
            <div
              style={{
                position: "absolute",
                top: 73,
                left: 73,
                width: 34,
                height: 34,
                borderRadius: 8,
                background: "#0e1720",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: shade(themeHex, 45),
                fontSize: 17,
                pointerEvents: "none",
              }}
            >
              ✥
            </div>
            <div style={{ position: "absolute", top: 132, left: -14, width: 84, ...labelStyle }}>
              LEFT
              <br />
              SPEED-
            </div>
            <div style={{ position: "absolute", top: 132, left: 110, width: 84, ...labelStyle }}>
              RIGHT
              <br />
              SPEED+
            </div>
            <div style={{ position: "absolute", top: 186, left: 10, width: 90, ...labelStyle }}>
              DOWN
              <br />
              LEVEL-
            </div>
          </div>

          {/* Rotate */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 20 }}>
            <Knob onClick={handleRotate} size={92} {...orangeKnob} pressed={flash === "rotate"} ariaLabel="Rotate" />
            <div style={{ ...labelStyle, marginTop: 9 }}>
              ROTATE
              <br />
              DIRECTION
            </div>
          </div>
        </div>

        {/* Options / settings modal */}
        {showOptions && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Game options"
            ref={optionsDialogRef}
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(6,12,18,0.55)",
              borderRadius: 34,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10,
              padding: 20,
            }}
            onClick={() => setShowOptions(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                maxWidth: 340,
                background: "linear-gradient(180deg,#132632,#0c1a22)",
                borderRadius: 16,
                padding: "16px 18px 20px",
                boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
                color: "#dfe6e0",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: 0.5 }}>OPTIONS</span>
                <button
                  onClick={() => setShowOptions(false)}
                  aria-label="Close"
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    border: "none",
                    background: "rgba(255,255,255,0.1)",
                    color: "#dfe6e0",
                    cursor: "pointer",
                    fontSize: 14,
                  }}
                >
                  ✕
                </button>
              </div>

              <ToggleRow icon={muted ? "\u{1F507}" : "\u{1F50A}"} label="Sound" on={!muted} onToggle={() => setMuted((m) => !m)} />
              <ToggleRow icon="⏬" label="Quick down" on={quickDown} onToggle={() => setQuickDown((v) => !v)} />
              <ToggleRow icon="📳" label="Vibrate" on={vibrateOn} onToggle={() => setVibrateOn((v) => !v)} />
              <ToggleRow icon="👆" label="Gesture" on={gestureOn} onToggle={() => setGestureOn((v) => !v)} last />

              {/* Skins / theme color row */}
              <div style={{ padding: "12px 2px 2px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 16 }} aria-hidden="true">
                    🎨
                  </span>
                  <span style={{ fontSize: 14 }}>Shell color</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {THEME_SWATCHES.map((hex) => (
                    <button
                      key={hex}
                      onClick={() => pickTheme(hex)}
                      aria-label={`Color ${hex}`}
                      aria-pressed={themeHex === hex}
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: "50%",
                        background: hex,
                        border: themeHex === hex ? "2px solid #ffffff" : "2px solid rgba(255,255,255,0.35)",
                        boxShadow: themeHex === hex ? "0 0 0 2px rgba(255,255,255,0.25)" : "none",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        fontSize: 13,
                      }}
                    >
                      {themeHex === hex ? "✓" : ""}
                    </button>
                  ))}
                  {/* custom color picker — native <input type="color"> opens
                      unreliably on iOS Safari, so it's a best-effort extra
                      next to the swatches above rather than the only way
                      to pick a color */}
                  <button
                    onClick={() => colorInputRef.current && colorInputRef.current.click()}
                    aria-label="Custom color"
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: "50%",
                      background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
                      border: "2px solid rgba(255,255,255,0.35)",
                      cursor: "pointer",
                    }}
                  />
                  <input
                    ref={colorInputRef}
                    type="color"
                    value={themeHex}
                    onChange={(e) => setThemeHex(e.target.value)}
                    style={{ width: 0, height: 0, opacity: 0, position: "absolute", pointerEvents: "none" }}
                  />
                </div>
              </div>

              <div style={{ marginTop: 16, fontSize: 11.5, color: "rgba(223,230,224,0.65)", lineHeight: 1.6 }}>
                Arrows: move · X / ↑: rotate · Space: hard drop · P: pause · M: mute · Esc: close
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

