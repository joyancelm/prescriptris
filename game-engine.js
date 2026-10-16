export const COLS = 10;
export const ROWS = 20;
export const BOTTLE_POINTS = { 2: 80, 3: 240, 4: 600 };
export const PILL_NAMES = ['Red/cream capsule', 'White tablet', 'Blue caplet'];
export const SHAPES = [
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
  [[0,1,0],[1,1,1],[0,0,0]],
  [[0,1,1],[1,1,0],[0,0,0]],
  [[1,1,0],[0,1,1],[0,0,0]],
  [[1,1],[1,1]],
  [[1,0,0],[1,1,1],[0,0,0]],
  [[0,0,1],[1,1,1],[0,0,0]],
];

export const emptyBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));
export function matrixFor(piece) {
  let matrix = SHAPES[piece.shape];
  for (let r = 0; r < (piece.rotation || 0); r++) {
    matrix = matrix[0].map((_, x) => matrix.map(row => row[x]).reverse());
  }
  return matrix;
}
export function cellsFor(piece) {
  const cells = [];
  matrixFor(piece).forEach((row, y) => row.forEach((filled, x) => {
    if (filled) cells.push([piece.x + x, piece.y + y]);
  }));
  return cells;
}

// Build a new board once: no in-place overwrites or stale row indices.
export function clearFullRows(board) {
  const remaining = board.filter(row => !row.every(cell => cell !== null));
  const count = ROWS - remaining.length;
  return { count, board: [...Array.from({ length: count }, () => Array(COLS).fill(null)), ...remaining.map(row => row.slice())] };
}

export function findBatches(board) {
  const claimed = new Set();
  const batches = [];
  for (let size = 4; size >= 2; size--) {
    for (let y = 0; y <= ROWS - size; y++) {
      for (let x = 0; x <= COLS - size; x++) {
        const type = board[y][x]?.type;
        if (type === undefined) continue;
        const keys = [];
        for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
          if (board[y + dy][x + dx]?.type === type && !claimed.has(`${x + dx},${y + dy}`)) keys.push(`${x + dx},${y + dy}`);
        }
        if (keys.length === size * size) {
          keys.forEach(key => claimed.add(key));
          batches.push({ x, y, size, type });
        }
      }
    }
  }
  return batches;
}

export function settleColumns(board) {
  const settled = emptyBoard();
  for (let x = 0; x < COLS; x++) {
    const column = board.map(row => row[x]).filter(cell => cell !== null);
    column.forEach((cell, i) => { settled[ROWS - column.length + i][x] = cell; });
  }
  return settled;
}

const ORDERS = [
  { kind: 'bottles', target: 2, title: 'The first refill', text: 'Bottle 2 matching batches.', unit: 'batches' },
  { kind: 'lines', target: 3, title: 'A tidy dispensary', text: 'Clear 3 full rows.', unit: 'rows' },
  { kind: 'tablets', target: 2, title: 'A classic refill', text: 'Bottle 2 white tablet batches.', unit: 'tablet batches' },
  { kind: 'cells', target: 20, title: 'The evening collection', text: 'Bottle 20 pill tiles.', unit: 'tiles' },
];

export class GameEngine {
  constructor(random = Math.random) {
    this.random = random;
    this.status = 'ready';
    this.board = emptyBoard();
    this.current = null;
    this.queue = [];
    this.held = null;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.bottles = 0;
    this.orders = 0;
    this.revision = 0;
    this.events = [];
    this.orderProgress = 0;
    this.pieceCounts = Array(7).fill(0);
  }
  get fallSpeed() { return Math.max(90, Math.round(700 * 0.84 ** (this.level - 1))); }
  get order() { return ORDERS[this.orders % ORDERS.length]; }
  get orderTarget() { return this.order.target + Math.floor(this.orders / ORDERS.length); }
  start() {
    this.board = emptyBoard();
    this.queue = [];
    this.bag = [];
    this.held = null;
    this.holdUsed = false;
    this.score = this.lines = this.bottles = this.orders = this.orderProgress = 0;
    this.pieceCounts = Array(7).fill(0);
    this.level = 1;
    this.status = 'playing';
    this.events = [];
    this.fillQueue();
    this.spawn(this.queue.shift());
    this.fillQueue();
    this.events.push({ type: 'start' });
  }
  makePiece() {
    if (!this.bag.length) {
      this.bag = [0,1,2,3,4,5,6];
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    return { shape: this.bag.pop(), type: Math.floor(this.random() * 3) };
  }
  fillQueue() { while (this.queue.length < 3) this.queue.push(this.makePiece()); }
  valid(piece) {
    return cellsFor(piece).every(([x, y]) => x >= 0 && x < COLS && y < ROWS && (y < 0 || this.board[y][x] === null));
  }
  spawn(piece, resetHold = true) {
    const width = SHAPES[piece.shape].length;
    this.current = { shape: piece.shape, type: piece.type, rotation: 0, x: Math.floor((COLS - width) / 2), y: 0 };
    this.fallElapsed = this.groundedMs = this.lockResets = 0;
    this.softDropActive = false;
    if (resetHold) this.holdUsed = false;
    if (!this.valid(this.current)) this.finish();
    this.revision++;
  }
  finish() {
    this.status = 'over';
    this.events.push({ type: 'over' });
    this.revision++;
  }
  pause() {
    if (this.status !== 'playing' && this.status !== 'paused') return;
    this.status = this.status === 'playing' ? 'paused' : 'playing';
    this.revision++;
  }
  get grounded() { return this.current && !this.valid({ ...this.current, y: this.current.y + 1 }); }
  resetLock(wasGrounded) {
    if (wasGrounded && this.lockResets < 15) {
      this.groundedMs = 0;
      this.lockResets++;
    }
  }
  move(direction) {
    if (this.status !== 'playing') return false;
    const candidate = { ...this.current, x: this.current.x + direction };
    if (!this.valid(candidate)) return false;
    const wasGrounded = this.grounded;
    this.current = candidate;
    this.resetLock(wasGrounded);
    this.revision++;
    this.events.push({ type: 'move' });
    return true;
  }
  rotate(direction = 1) {
    if (this.status !== 'playing') return false;
    if (this.current.shape === 4) return false;
    const rotation = (this.current.rotation + direction + 4) % 4;
    const wasGrounded = this.grounded;
    // Small, bounded wall/floor kicks; intentionally not presented as full SRS.
    for (const [dx, dy] of [[0,0],[-1,0],[1,0],[-2,0],[2,0],[0,-1],[-1,-1],[1,-1],[0,-2]]) {
      const candidate = { ...this.current, rotation, x: this.current.x + dx, y: this.current.y + dy };
      if (!this.valid(candidate)) continue;
      this.current = candidate;
      this.resetLock(wasGrounded);
      this.events.push({ type: 'rotate' });
      this.revision++;
      return true;
    }
    return false;
  }
  hold() {
    if (this.status !== 'playing' || this.holdUsed) return false;
    const incoming = this.held || this.queue.shift();
    this.held = { shape: this.current.shape, type: this.current.type };
    this.fillQueue();
    this.spawn(incoming, false); // Both an empty hold and a swap validate here.
    this.holdUsed = true;
    this.events.push({ type: 'hold' });
    return true;
  }
  stepDown(soft = false) {
    if (this.status !== 'playing') return false;
    const candidate = { ...this.current, y: this.current.y + 1 };
    if (!this.valid(candidate)) return false;
    this.current = candidate;
    if (soft) this.score++;
    this.groundedMs = 0;
    this.revision++;
    return true;
  }
  ghost() {
    if (!this.current) return null;
    const piece = { ...this.current };
    while (this.valid({ ...piece, y: piece.y + 1 })) piece.y++;
    return piece;
  }
  previewBatches() {
    if (this.status !== 'playing' || !this.current || !this.valid(this.current)) return [];
    const board = this.board.map(row => row.slice());
    for (const [x, y] of cellsFor(this.ghost())) if (y >= 0) board[y][x] = { type: this.current.type };
    return findBatches(board);
  }
  hardDrop(bottle = false) {
    if (this.status !== 'playing') return false;
    const ghost = this.ghost();
    this.score += (ghost.y - this.current.y) * 2;
    this.current = ghost;
    this.lock(bottle);
    return true;
  }
  advanceOrder(batches, rows) {
    const kind = this.order.kind;
    const earned = kind === 'lines' ? rows : kind === 'tablets' ? batches.filter(b => b.type === 1).length : kind === 'cells' ? batches.reduce((sum, b) => sum + b.size ** 2, 0) : batches.length;
    this.orderProgress += earned;
    if (this.orderProgress >= this.orderTarget) {
      const bonus = 200 * this.level;
      this.score += bonus;
      this.orders++;
      this.orderProgress = 0;
      this.events.push({ type: 'order', points: bonus });
    }
  }
  lock(bottle = false) {
    if (this.status !== 'playing') return;
    const cells = cellsFor(this.current);
    if (!this.valid(this.current) || cells.some(([, y]) => y < 0)) { this.finish(); return; }
    cells.forEach(([x, y]) => { this.board[y][x] = { type: this.current.type }; });
    this.pieceCounts[this.current.shape]++;
    let batches = [];
    if (bottle) {
      batches = findBatches(this.board);
      for (const batch of batches) {
        for (let dy = 0; dy < batch.size; dy++) for (let dx = 0; dx < batch.size; dx++) this.board[batch.y + dy][batch.x + dx] = null;
        this.score += BOTTLE_POINTS[batch.size] * this.level;
      }
      if (batches.length) {
        this.bottles += batches.length;
        this.board = settleColumns(this.board);
        this.events.push({ type: 'bottle', batches, points: batches.reduce((sum, b) => sum + BOTTLE_POINTS[b.size] * this.level, 0) });
      }
    }
    const cleared = clearFullRows(this.board);
    this.board = cleared.board;
    if (cleared.count) {
      // A bottle collapse can clear more than four rows in one operation.
      const points = (Math.floor(cleared.count / 4) * 800 + [0,100,300,500][cleared.count % 4]) * this.level;
      this.score += points;
      this.lines += cleared.count;
      this.events.push({ type: 'clear', count: cleared.count, points });
    }
    this.advanceOrder(batches, cleared.count);
    this.level = Math.floor(this.lines / 10) + 1;
    this.events.push({ type: 'lock' });
    this.spawn(this.queue.shift());
    this.fillQueue();
  }
  update(milliseconds, softDrop = false) {
    if (this.status !== 'playing') return;
    const dt = Math.min(Math.max(milliseconds, 0), 100);
    if (softDrop !== this.softDropActive) {
      this.fallElapsed = 0;
      this.softDropActive = softDrop;
    }
    const interval = softDrop ? 40 : this.fallSpeed;
    let remaining = dt;
    // Split at gravity steps so airborne time cannot consume the landing delay.
    while (remaining > 0) {
      if (this.grounded) {
        this.fallElapsed = 0;
        this.groundedMs += remaining;
        if (this.groundedMs >= 450) this.lock();
        return; // A new piece always starts with fresh timers.
      }
      this.groundedMs = 0;
      const elapsed = Math.min(remaining, interval - this.fallElapsed);
      this.fallElapsed += elapsed;
      remaining -= elapsed;
      if (this.fallElapsed >= interval) {
        this.fallElapsed = 0;
        this.stepDown(softDrop);
      }
    }
  }
}
