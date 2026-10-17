import { GameEngine, COLS, ROWS, cellsFor, BOTTLE_POINTS, PILL_NAMES } from './game-engine.js';
import { HorizontalInput } from './game-input.js';

const $ = id => document.getElementById(id);
const engine = new GameEngine();
const canvas = $('gameCanvas');
const ctx = canvas.getContext('2d');
const holdCanvas = $('hold-canvas');
const nextCanvas = $('next-canvas');
const statisticsCanvas = $('statistics-canvas');
const pharmCanvas = $('pharmacist-canvas');
const colors = ['#eb8975', '#eee7d8', '#78bce6'];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let effects = !reducedMotion.matches;
let sound = false;
let audio = null;
let best = 0;
let savedBest = 0;
let lastRevision = -1;
let lastStatus = '';
let automaticPause = false;
let previousTime = 0;
let lastDraw = 0;
let boardDirty = true;
let celebratingUntil = 0;
let toastUntil = 0;
let stampUntil = 0;
let particles = [];
let bottleFlashes = [];
const horizontalInput = new HorizontalInput();
let readyBatches = [];
let pharmacistFrame = -1;
let pillFrames = [];
let pillFrame = 0;
let spinElapsed = 0;
const PILL_SPIN_FRAMES = 12;
const PILL_SPIN_FRAME_MS = 150;
const heldKeys = new Set();
const touchDownPointers = new Set();
const assets = { pills: null, atlas: null, pharmacist: null };

function readPreference(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writePreference(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* Private browsing must not interrupt a shift. */ }
}
const oldBest = Number(readPreference('prescriptris_high', '0'));
best = savedBest = Number.isFinite(oldBest) && oldBest >= 0 ? Math.floor(oldBest) : 0;
sound = readPreference('prescriptris_sound', 'false') === 'true';
effects = readPreference('prescriptris_effects', String(effects)) === 'true' && !reducedMotion.matches;

function persistBest() {
  // Another open shift may have saved a newer record since this tab loaded.
  const stored = Number(readPreference('prescriptris_high', '0'));
  best = Math.max(best, engine.score, Number.isFinite(stored) && stored >= 0 ? Math.floor(stored) : 0);
  if (best > savedBest) { writePreference('prescriptris_high', best); savedBest = best; }
}

function loadImage(src) {
  return new Promise(resolve => {
    const image = new Image();
    let completed = false;
    const finish = result => { if (!completed) { completed = true; clearTimeout(timer); resolve(result); } };
    const timer = setTimeout(() => finish(null), 6000);
    image.onload = () => finish(image);
    image.onerror = () => finish(null);
    image.src = src;
  });
}
Promise.all([
  loadImage('assets/v2/medication-pills.png'),
  loadImage('assets/v2/pill-bottle-atlas.png'),
  loadImage('assets/v2/pharmacist.png'),
  loadImage('assets/v2/pharmacy.png'),
]).then(([pills, atlas, pharmacist, backdrop]) => {
  assets.pills = pills; assets.atlas = atlas; assets.pharmacist = pharmacist;
  buildPillFrames();
  $('asset-notice').hidden = Boolean(pills && atlas && pharmacist && backdrop);
  boardDirty = true;
  drawPreviews(); drawStatistics(); drawPharmacist();
});

function initializeAudio() {
  if (!sound) return;
  try {
    const AudioClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioClass) return;
    audio ||= new AudioClass();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
  } catch { audio = null; }
}
function playSound(type) {
  if (!sound || !audio || audio.state !== 'running') return;
  try {
    const now = audio.currentTime;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const pitches = { move: [180,120,.035], rotate: [330,440,.06], hold: [260,390,.08], lock: [130,70,.07], clear: [440,880,.16], bottle: [660,1320,.24], order: [880,1760,.3], over: [220,70,.3] };
    const [from,to,duration] = pitches[type] || pitches.lock;
    oscillator.type = ['move','lock'].includes(type) ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(to, now + duration);
    gain.gain.setValueAtTime(.035, now);
    gain.gain.exponentialRampToValueAtTime(.001, now + duration);
    oscillator.connect(gain); gain.connect(audio.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(now); oscillator.stop(now + duration);
  } catch { /* Audio is optional. */ }
}

function updateOptions() {
  document.body.classList.toggle('effects-off', !effects);
  $('sound-toggle').textContent = sound ? 'Sound on' : 'Sound off';
  $('sound-toggle').setAttribute('aria-pressed', String(sound));
  $('effects-toggle').textContent = effects ? 'CRT on' : 'CRT off';
  $('effects-toggle').setAttribute('aria-pressed', String(effects));
  $('effects-toggle').disabled = reducedMotion.matches;
  $('effects-toggle').title = reducedMotion.matches ? 'Motion effects disabled by your system reduced-motion preference' : 'Toggle CRT and motion effects';
}
function toggleSound() {
  sound = !sound; writePreference('prescriptris_sound', sound);
  initializeAudio(); updateOptions();
}
$('sound-toggle').addEventListener('click', toggleSound);
$('effects-toggle').addEventListener('click', () => {
  effects = !effects && !reducedMotion.matches; writePreference('prescriptris_effects', effects);
  if (!effects) { particles = []; bottleFlashes = []; }
  updateOptions(); boardDirty = true;
});
reducedMotion.addEventListener('change', event => {
  if (event.matches) { effects = false; particles = []; bottleFlashes = []; }
  updateOptions(); boardDirty = true;
});

function resizeBoard() {
  const rectangle = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rectangle.width * ratio));
  const height = Math.max(1, Math.round(rectangle.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width; canvas.height = height;
    ctx.imageSmoothingEnabled = false;
    boardDirty = true;
  }
}
new ResizeObserver(resizeBoard).observe(canvas);
window.addEventListener('resize', resizeBoard);

// Source bounds preserve the distinct medication silhouettes.
const pillSourceRects = [
  [.018,.285,.30,.405], [.391,.17,.215,.63], [.69,.15,.285,.68],
];
function buildPillFrames() {
  // Bake rotations once, then fit their actual alpha bounds into each cell.
  // Using a rotated rectangle's bounds would make the round tablet shrink at 45°.
  const frameSize = 144, baseExtent = 96;
  pillFrames = pillSourceRects.map(([sx,sy,sw,sh], type) => {
    return Array.from({ length:PILL_SPIN_FRAMES }, (_, index) => {
      const image = document.createElement('canvas');
      image.width = image.height = frameSize;
      const context = image.getContext('2d', { willReadFrequently:true });
      context.imageSmoothingEnabled = false;
      context.save();
      context.translate(frameSize / 2, frameSize / 2);
      context.rotate(index * Math.PI * 2 / PILL_SPIN_FRAMES);
      if (assets.pills) {
        const sourceWidth = sw * assets.pills.width, sourceHeight = sh * assets.pills.height;
        const scale = baseExtent / Math.max(sourceWidth,sourceHeight);
        const width = sourceWidth * scale, height = sourceHeight * scale;
        context.drawImage(assets.pills, sx * assets.pills.width, sy * assets.pills.height, sourceWidth, sourceHeight, -width / 2, -height / 2, width, height);
      } else fallbackPill(context,type,-baseExtent / 2,-baseExtent / 2,baseExtent);
      context.restore();
      const pixels = context.getImageData(0,0,frameSize,frameSize).data;
      let left = frameSize, top = frameSize, right = -1, bottom = -1;
      for (let y = 0; y < frameSize; y++) for (let x = 0; x < frameSize; x++) {
        if (pixels[(y * frameSize + x) * 4 + 3] < 8) continue;
        left = Math.min(left,x); top = Math.min(top,y);
        right = Math.max(right,x); bottom = Math.max(bottom,y);
      }
      return right < left ? null : { image, x:left, y:top, width:right - left + 1, height:bottom - top + 1 };
    });
  });
}
function pillSprite(context, type, x, y, size, frameIndex = pillFrame) {
  const frame = pillFrames[type]?.[frameIndex];
  if (!frame) return false;
  const extent = size * .98;
  const scale = extent / Math.max(frame.width,frame.height);
  const width = frame.width * scale, height = frame.height * scale;
  context.drawImage(frame.image, frame.x, frame.y, frame.width, frame.height, x + (size - width) / 2, y + (size - height) / 2, width, height);
  return true;
}
function bottleSprite(context, x, y, width, height) {
  if (!assets.atlas) return false;
  // Retain the bottle from the original v2 atlas; its capsule tiles are unused.
  const [sx,sy,sw,sh] = [.80,.08,.175,.82];
  const sourceWidth = sw * assets.atlas.width, sourceHeight = sh * assets.atlas.height;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawnWidth = sourceWidth * scale, drawnHeight = sourceHeight * scale;
  context.drawImage(assets.atlas, sx * assets.atlas.width, sy * assets.atlas.height, sourceWidth, sourceHeight, x + (width - drawnWidth) / 2, y + (height - drawnHeight) / 2, drawnWidth, drawnHeight);
  return true;
}
function fallbackPill(context, type, x, y, size) {
  context.save();
  context.translate(x + size / 2, y + size / 2);
  context.scale(size, size);
  context.strokeStyle = '#0b2021'; context.lineWidth = .045;
  if (type === 1) {
    context.fillStyle = colors[type]; context.beginPath(); context.arc(0,0,.33,0,Math.PI * 2); context.fill(); context.stroke();
    context.strokeStyle = '#9b9b90'; context.lineWidth = .04;
    context.beginPath(); context.moveTo(-.21,-.21); context.lineTo(.21,.21); context.stroke();
  } else {
    if (type === 2) context.rotate(-Math.PI / 5);
    context.beginPath(); context.moveTo(-.22,-.18); context.lineTo(.22,-.18);
    context.arc(.22,0,.18,-Math.PI / 2,Math.PI / 2);
    context.lineTo(-.22,.18); context.arc(-.22,0,.18,Math.PI / 2,Math.PI * 1.5); context.closePath();
    context.fillStyle = type === 0 ? '#f2e7c9' : colors[type]; context.fill(); context.stroke();
    context.save(); context.clip();
    if (type === 0) { context.fillStyle = colors[0]; context.fillRect(-.45,-.2,.45,.4); }
    context.restore();
    context.strokeStyle = type === 0 ? '#7b5144' : '#3376a3';
    context.beginPath(); context.moveTo(0,-.18); context.lineTo(0,.18); context.stroke();
  }
  context.restore();
}
function tile(context, type, x, y, size, ghost = false, frameIndex = pillFrame) {
  context.save();
  context.imageSmoothingEnabled = false;
  if (ghost) {
    context.strokeStyle = colors[type]; context.globalAlpha = .65;
    context.lineWidth = Math.max(1, size / 18);
    context.strokeRect(x + 3, y + 3, size - 6, size - 6);
    context.globalAlpha = .24;
    if (!pillSprite(context,type,x + .5,y + .5,size - 1,frameIndex)) fallbackPill(context,type,x + .5,y + .5,size - 1);
  } else {
    // A quiet tray-cell backing preserves block readability without masking pill shapes.
    context.fillStyle = '#101928';
    context.fillRect(x + 1, y + 1, size - 2, size - 2);
    context.strokeStyle = '#3c4c65'; context.lineWidth = Math.max(1, size / 32);
    context.strokeRect(x + 1,y + 1,size - 2,size - 2);
    if (!pillSprite(context,type,x + .5,y + .5,size - 1,frameIndex)) fallbackPill(context,type,x + .5,y + .5,size - 1);
  }
  context.restore();
}

function drawBoard(dt = 0, now = performance.now()) {
  const size = canvas.width / COLS;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#02050b'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#bccced09'; ctx.lineWidth = 1;
  for (let x = 1; x < COLS; x++) { ctx.beginPath(); ctx.moveTo(Math.round(x * size) + .5, 0); ctx.lineTo(Math.round(x * size) + .5, canvas.height); ctx.stroke(); }
  for (let y = 1; y < ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, Math.round(y * size) + .5); ctx.lineTo(canvas.width, Math.round(y * size) + .5); ctx.stroke(); }
  engine.board.forEach((row, y) => row.forEach((cell, x) => { if (cell) tile(ctx, cell.type, x * size, y * size, size); }));
  if (engine.current && engine.status !== 'over') {
    const ghost = engine.ghost();
    for (const [x,y] of cellsFor(ghost)) if (y >= 0) tile(ctx, ghost.type, x * size, y * size, size, true);
    for (const [x,y] of cellsFor(engine.current)) if (y >= 0) {
      tile(ctx, engine.current.type, x * size, y * size, size);
      ctx.strokeStyle = '#fff2d4b8'; ctx.lineWidth = 1;
      ctx.strokeRect(x * size + 1, y * size + 1, size - 2, size - 2);
    }
  }
  if (engine.status === 'playing') {
    ctx.strokeStyle = '#e8c881'; ctx.lineWidth = Math.max(1, size / 15);
    ctx.setLineDash([size / 5, size / 6]);
    for (const batch of readyBatches) ctx.strokeRect(batch.x * size + 2, batch.y * size + 2, batch.size * size - 4, batch.size * size - 4);
    ctx.setLineDash([]);
  }
  if (effects) {
    bottleFlashes = bottleFlashes.filter(flash => flash.until > now);
    for (const flash of bottleFlashes) {
      ctx.save(); ctx.globalAlpha = Math.min(1, (flash.until - now) / 300);
      const width = size * flash.size * .65;
      bottleSprite(ctx, (flash.x + flash.size / 2) * size - width / 2, (flash.y + flash.size / 2) * size - width / 2, width, width);
      ctx.restore();
    }
    const seconds = Math.min(dt, 50) / 1000;
    particles = particles.filter(particle => particle.life > 0);
    for (const particle of particles) {
      particle.x += particle.vx * seconds; particle.y += particle.vy * seconds;
      particle.vy += 2 * seconds; particle.life -= seconds;
      ctx.globalAlpha = Math.max(0, particle.life);
      ctx.fillStyle = particle.color;
      ctx.fillRect(particle.x * size, particle.y * size, size / 10, size / 10);
    }
    ctx.globalAlpha = 1;
  }
  boardDirty = false;
}

function drawMini(context, piece, centerX, centerY, maxSize = 22, frameIndex = pillFrame) {
  if (!piece) return;
  const cells = cellsFor({ ...piece, x:0, y:0, rotation:0 });
  const xs = cells.map(([x]) => x), ys = cells.map(([,y]) => y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const width = Math.max(...xs) - minX + 1, height = Math.max(...ys) - minY + 1;
  const size = Math.min(maxSize, 112 / width);
  for (const [x,y] of cells) tile(context, piece.type, centerX - width * size / 2 + (x - minX) * size, centerY - height * size / 2 + (y - minY) * size, size, false, frameIndex);
}
const shapeNames = ['I','T','S','Z','O','J','L'];
function pieceLabel(piece) { return `${PILL_NAMES[piece.type]} ${shapeNames[piece.shape]} piece`; }
function drawPreviews(updateLabels = true) {
  const holdContext = holdCanvas.getContext('2d');
  holdContext.clearRect(0, 0, holdCanvas.width, holdCanvas.height);
  holdContext.globalAlpha = engine.holdUsed ? .45 : 1;
  drawMini(holdContext, engine.held, 64, 32, 23);
  holdContext.globalAlpha = 1;
  if (!engine.held) { holdContext.font = '8px "Arcade Pixel",monospace'; holdContext.textAlign = 'center'; holdContext.fillStyle = '#8c9eb8'; holdContext.fillText('EMPTY',64,36); }
  if (updateLabels) holdCanvas.setAttribute('aria-label', engine.held ? `On hold: ${pieceLabel(engine.held)}${engine.holdUsed ? ', available after placing this piece' : ''}` : 'Hold slot empty');
  const nextContext = nextCanvas.getContext('2d');
  nextContext.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  engine.queue.forEach((piece, i) => drawMini(nextContext, piece, 64, [38,102,144][i], i === 0 ? 26 : 16));
  if (updateLabels) nextCanvas.setAttribute('aria-label', `Up next: ${engine.queue.map(pieceLabel).join(', ') || 'start a shift to see pieces'}`);
}
function drawStatistics() {
  const context = statisticsCanvas.getContext('2d');
  context.clearRect(0,0,statisticsCanvas.width,statisticsCanvas.height);
  shapeNames.forEach((name,shape) => {
    const y = shape * 22 + 11;
    context.fillStyle = '#aebed5'; context.font = '6px "Arcade Pixel",monospace'; context.textAlign = 'left';
    context.fillText(name,2,y+3);
    drawMini(context,{shape,type:shape % 3},43,y,9,0);
    context.fillStyle = engine.pieceCounts[shape] ? '#edf1e8' : '#70839e';
    context.font = '8px "Arcade Pixel",monospace'; context.textAlign = 'right';
    context.fillText(String(engine.pieceCounts[shape]).padStart(3,'0'),124,y+4);
  });
  statisticsCanvas.setAttribute('aria-label', `Pieces placed: ${shapeNames.map((name,index) => `${name} ${engine.pieceCounts[index]}`).join(', ')}`);
}
function drawPharmacist(now = performance.now()) {
  const desiredFrame = assets.pharmacist ? (now < celebratingUntil && effects ? 1 : 0) : -2;
  if (pharmacistFrame === desiredFrame) return;
  pharmacistFrame = desiredFrame;
  const context = pharmCanvas.getContext('2d');
  context.clearRect(0, 0, pharmCanvas.width, pharmCanvas.height);
  context.imageSmoothingEnabled = false;
  if (assets.pharmacist) {
    const frame = desiredFrame;
    const frameWidth = assets.pharmacist.width / 2;
    const scale = Math.min(pharmCanvas.width / frameWidth, pharmCanvas.height / assets.pharmacist.height);
    const width = frameWidth * scale, height = assets.pharmacist.height * scale;
    context.drawImage(assets.pharmacist, frame * frameWidth, 0, frameWidth, assets.pharmacist.height, (pharmCanvas.width - width) / 2, (pharmCanvas.height - height) / 2, width, height);
  } else {
    context.fillStyle = '#a1d5b7'; context.font = '60px monospace'; context.textAlign = 'center'; context.fillText('℞',96,110);
  }
}

function announce(message) { $('announcer').textContent = message; }
function toast(message, now) {
  $('board-toast').textContent = message; $('board-toast').classList.add('show'); toastUntil = now + 1300;
  announce(message);
}
function processEvents(now) {
  const events = engine.events.splice(0);
  for (const event of events) {
    playSound(event.type);
    if (event.type === 'start') trackGameEvent('game_start', { game_name:'Prescriptris' });
    if (event.type === 'over') trackGameEvent('game_end', { game_name:'Prescriptris', score:engine.score, level:engine.level, lines:engine.lines, bottles:engine.bottles });
    if (event.type === 'lock' || event.type === 'over') persistBest();
    if (event.type === 'clear') {
      celebratingUntil = now + 1000;
      toast(`${event.count} ROW${event.count === 1 ? '' : 'S'} · +${event.points}`, now);
      $('pharmacist-message').textContent = 'A tidy tray. Nicely done.';
    }
    if (event.type === 'bottle') {
      celebratingUntil = now + 1300;
      toast(`BOTTLED · +${event.points}`, now);
      $('pharmacist-message').textContent = 'Counted, bottled, and ready to go.';
      if (effects) for (const batch of event.batches) {
        bottleFlashes.push({ ...batch, until: now + 600 });
        for (let i=0; i<12; i++) particles.push({ x: batch.x + batch.size / 2, y: batch.y + batch.size / 2, vx:(Math.random() - .5) * 5, vy:-Math.random() * 4 - 1, life:.9, color:colors[batch.type] });
      }
    }
    if (event.type === 'order') {
      celebratingUntil = now + 1800; stampUntil = now + 1500;
      $('filled-stamp').classList.add('show');
      toast(`PRESCRIPTION FILLED · +${event.points}`, now);
      $('pharmacist-message').textContent = 'Another prescription filled. Thank you!';
    }
  }
}
function trackGameEvent(name, parameters) {
  try { if (typeof window.gtag === 'function') window.gtag('event', name, parameters); } catch { /* Analytics must never interrupt play. */ }
}

function updateInterface() {
  best = Math.max(best, engine.score);
  $('score').textContent = String(engine.score).padStart(6,'0');
  $('best').textContent = String(best).padStart(6,'0');
  $('level').textContent = String(engine.level).padStart(2,'0');
  $('tray-lines').textContent = String(engine.lines).padStart(3,'0');
  document.documentElement.style.setProperty('--level-accent',['#9ebce8','#8ecab5','#baa1d7','#e0b477'][(engine.level - 1) % 4]);
  $('bottles').textContent = String(engine.bottles).padStart(2,'0');
  const playing = engine.status === 'playing';
  document.body.classList.toggle('has-started',engine.status !== 'ready');
  $('hold-button').disabled = !playing || engine.holdUsed;
  $('hold-status').textContent = engine.holdUsed ? 'Used this turn' : 'Once per piece';
  $('bottle-button').disabled = !playing;
  $('pause-button').disabled = !['playing','paused'].includes(engine.status);
  $('pause-button').textContent = engine.status === 'paused' ? 'Continue ▷' : 'Pause Ⅱ';
  document.querySelectorAll('[data-action]').forEach(button => { button.disabled = !playing; });
  $('shift-status').textContent = { ready:'READY', playing:'PLAYING', paused:'PAUSED', over:'GAME OVER' }[engine.status];
  const batches = engine.previewBatches();
  readyBatches = batches;
  const points = batches.reduce((total, batch) => total + BOTTLE_POINTS[batch.size] * engine.level,0);
  $('bottle-button').classList.toggle('ready', batches.length > 0);
  $('bottle-preview').textContent = batches.length ? `${batches.length} batch${batches.length === 1 ? '' : 'es'} after drop · +${points}` : 'No batch after drop';
  $('order-number').textContent = String(engine.orders + 1).padStart(3,'0');
  $('order-copy').textContent = engine.order.text.replace(String(engine.order.target), String(engine.orderTarget));
  $('order-progress').max = engine.orderTarget;
  $('order-progress').value = engine.orderProgress;
  $('order-count').textContent = `${engine.orderProgress} / ${engine.orderTarget}`;
  $('order-reward').textContent = 200 * engine.level;
  drawPreviews();
  drawStatistics();
  if (engine.status !== lastStatus) {
    updateOverlay(); lastStatus = engine.status;
  }
  if (engine.current) {
    const occupied = engine.board.reduce((sum,row) => sum + row.filter(Boolean).length,0);
    canvas.setAttribute('aria-label', `${engine.status}. ${pieceLabel(engine.current)} at column ${engine.current.x + 1}. ${occupied} locked pills. Score ${engine.score}. Arrow keys move and rotate. Space drops. B bottles and drops. C holds. P pauses.`);
  }
  lastRevision = engine.revision; boardDirty = true;
}
function updateOverlay() {
  const overlay = $('overlay');
  overlay.dataset.state = engine.status;
  overlay.hidden = engine.status === 'playing';
  if (overlay.hidden) return;
  const paused = engine.status === 'paused';
  const over = engine.status === 'over';
  $('overlay-eyebrow').textContent = paused ? 'THE NIGHT SHIFT' : over ? 'MARATHON COMPLETE' : 'PHARMACY MARATHON';
  $('overlay-title').textContent = paused ? 'PAUSED' : over ? 'GAME OVER' : 'READY?';
  $('overlay-copy').textContent = paused ? 'Your tray is right where you left it.' : over ? 'The counter is full. A fresh tray is waiting.' : 'Clear rows. Bottle matching squares.';
  $('final-stats').hidden = !over;
  $('final-stats').textContent = `Score ${engine.score} · Best ${best} · ${engine.lines} rows · ${engine.bottles} bottles`;
  $('start-button').textContent = paused ? 'CONTINUE ▶' : over ? 'PLAY AGAIN ▶' : 'START GAME ▶';
  $('overlay-hint').textContent = paused ? 'ENTER TO CONTINUE' : over ? 'ENTER TO PLAY AGAIN' : 'ENTER TO START · KEYBOARD & TOUCH';
  if (over || paused) { clearInputs(); if (over || !automaticPause) $('start-button').focus({ preventScroll:true }); }
  if (over) announce(`Game over. Score ${engine.score}. ${engine.bottles} bottles. Choose Play again for a new game.`);
}
function clearInputs() { heldKeys.clear(); touchDownPointers.clear(); horizontalInput.clear(); }
function focusBoard() {
  canvas.focus({ preventScroll:true });
  const rectangle = canvas.getBoundingClientRect();
  if (rectangle.bottom <= 0 || rectangle.top >= window.innerHeight) canvas.scrollIntoView({ block:'start', behavior:'instant' });
}
function startOrResume() {
  const starting = engine.status !== 'paused';
  initializeAudio(); clearInputs();
  if (engine.status !== 'paused') { spinElapsed = 0; pillFrame = 0; }
  if (engine.status === 'paused') engine.pause();
  else { persistBest(); engine.start(); particles = []; bottleFlashes = []; toastUntil = stampUntil = celebratingUntil = 0; $('board-toast').classList.remove('show'); $('filled-stamp').classList.remove('show'); $('pharmacist-message').textContent = 'One pill at a time. You have this.'; }
  previousTime = performance.now();
  updateInterface();
  // Compacting the marquee must not leave a freshly started tray above the view.
  if (starting) window.scrollTo({ top:0, behavior:'instant' });
  focusBoard();
}
function pause() {
  if (!['playing','paused'].includes(engine.status)) return;
  clearInputs(); engine.pause(); previousTime = performance.now(); updateInterface();
  if (engine.status === 'playing') focusBoard();
}
$('start-button').addEventListener('click', startOrResume);
$('pause-button').addEventListener('click', pause);
function gameplayButton(name) {
  action(name);
  // Return shortcuts to the playfield: Space should drop after a button action.
  if (engine.status === 'playing') canvas.focus({ preventScroll:true });
}
$('hold-button').addEventListener('click', () => gameplayButton('hold'));
$('bottle-button').addEventListener('click', () => gameplayButton('bottle'));

function action(name) {
  initializeAudio();
  if (engine.status !== 'playing') return;
  if (name === 'left') engine.move(-1);
  else if (name === 'right') engine.move(1);
  else if (name === 'rotate') engine.rotate();
  else if (name === 'reverse') engine.rotate(-1);
  else if (name === 'down') engine.stepDown(true);
  else if (name === 'drop') engine.hardDrop();
  else if (name === 'bottle') engine.hardDrop(true);
  else if (name === 'hold') engine.hold();
  updateInterface();
}
const keyActions = { ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowDown:'down',KeyS:'down',ArrowUp:'rotate',KeyX:'rotate',KeyZ:'reverse',Space:'drop',KeyB:'bottle',KeyC:'hold',ShiftLeft:'hold',ShiftRight:'hold' };
document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.altKey || event.metaKey || event.target.matches('input,textarea,select')) return;
  if (event.repeat && ['Space','Enter'].includes(event.code) && event.target.closest('button')) {
    event.preventDefault(); return;
  }
  // Preserve native button/summary activation for keyboard and assistive users.
  if (['Space','Enter'].includes(event.code) && event.target.closest('button,summary,a')) return;
  if (event.code === 'Enter' && engine.status !== 'playing') {
    event.preventDefault(); if (!event.repeat) startOrResume(); return;
  }
  if (event.code === 'KeyM') { event.preventDefault(); if (!event.repeat) toggleSound(); return; }
  if (event.code === 'KeyP' || event.code === 'Escape') { event.preventDefault(); if (!event.repeat) pause(); return; }
  const name = keyActions[event.code];
  if (!name || engine.status !== 'playing') return;
  event.preventDefault();
  if (event.repeat || heldKeys.has(event.code)) return;
  heldKeys.add(event.code);
  action(name);
  if (name === 'left' || name === 'right') horizontalInput.press(event.code, name === 'left' ? -1 : 1, performance.now());
});
document.addEventListener('keyup', event => {
  heldKeys.delete(event.code);
  horizontalInput.release(event.code, performance.now());
});
document.querySelectorAll('[data-action]').forEach(button => {
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0 || engine.status !== 'playing') return;
    event.preventDefault(); button.setPointerCapture(event.pointerId);
    const name = button.dataset.action;
    action(name);
    if (name === 'left' || name === 'right') horizontalInput.press(`pointer:${event.pointerId}`, name === 'left' ? -1 : 1, performance.now());
    if (name === 'down') { touchDownPointers.add(event.pointerId); heldKeys.add('touch-down'); }
  });
  // Keyboard/assistive activation uses click; pointer actions already ran above.
  button.addEventListener('click', event => { if (event.detail === 0) gameplayButton(button.dataset.action); });
});
function releasePointer(event) {
  horizontalInput.release(`pointer:${event.pointerId}`, performance.now());
  touchDownPointers.delete(event.pointerId);
  if (!touchDownPointers.size) heldKeys.delete('touch-down');
}
window.addEventListener('pointerup',releasePointer);
window.addEventListener('pointercancel',releasePointer);
window.addEventListener('lostpointercapture',releasePointer);
function autoPause() {
  clearInputs();
  if (engine.status === 'playing') {
    automaticPause = true;
    try { pause(); } finally { automaticPause = false; }
  }
  persistBest();
}
window.addEventListener('blur', autoPause);
document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
if (window.IntersectionObserver) new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) autoPause(); }).observe(canvas);
document.querySelectorAll('[data-game-help]').forEach(link => link.addEventListener('click', autoPause));
$('quick-help')?.addEventListener('toggle', () => { if ($('quick-help').open) autoPause(); });
window.addEventListener('pagehide', persistBest);
window.addEventListener('storage', event => {
  if (event.key !== 'prescriptris_high' && event.key !== null) return;
  persistBest(); updateInterface();
});

function frame(now) {
  const dt = previousTime ? Math.min(now - previousTime,100) : 0;
  previousTime = now;
  if (effects && !reducedMotion.matches && engine.status === 'playing') spinElapsed += dt;
  const nextPillFrame = effects && !reducedMotion.matches ? Math.floor(spinElapsed / PILL_SPIN_FRAME_MS) % PILL_SPIN_FRAMES : 0;
  if (nextPillFrame !== pillFrame) {
    pillFrame = nextPillFrame;
    boardDirty = true;
    drawPreviews(false);
  }
  const direction = engine.status === 'playing' ? horizontalInput.next(now) : 0;
  if (direction) engine.move(direction);
  engine.update(dt, heldKeys.has('ArrowDown') || heldKeys.has('KeyS') || heldKeys.has('touch-down'));
  processEvents(now);
  if (engine.revision !== lastRevision) updateInterface();
  if (toastUntil && now >= toastUntil) { $('board-toast').classList.remove('show'); toastUntil = 0; }
  if (stampUntil && now >= stampUntil) { $('filled-stamp').classList.remove('show'); stampUntil = 0; }
  const animating = effects && (particles.length > 0 || bottleFlashes.length > 0);
  if (boardDirty || animating) { drawBoard(now - lastDraw,now); lastDraw = now; }
  drawPharmacist(now);
  requestAnimationFrame(frame);
}
buildPillFrames();
updateOptions(); resizeBoard(); updateInterface(); drawBoard();
document.fonts.ready.then(() => { drawPreviews(); drawStatistics(); });
requestAnimationFrame(frame);
