import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, emptyBoard, clearFullRows, findBatches, settleColumns, cellsFor, COLS, ROWS } from '../game-engine.js';

function seeded(seed = 41) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }
function game() { const instance = new GameEngine(seeded()); instance.start(); return instance; }
const pill = (type = 0, id) => ({ type, ...(id ? { id } : {}) });
function count(board) { return board.flat().filter(Boolean).length; }
function square(board, x, y, size, type = 0) { for(let dy=0;dy<size;dy++)for(let dx=0;dx<size;dx++)board[y+dy][x+dx]=pill(type); }

test('single row preserves both stacked pills and their identities', () => {
  const board = emptyBoard(); board[19].fill(pill()); board[17][0]=pill(1,'A'); board[18][0]=pill(2,'B');
  const result = clearFullRows(board);
  assert.equal(result.count,1); assert.equal(count(result.board),2);
  assert.equal(result.board[18][0].id,'A'); assert.equal(result.board[19][0].id,'B');
  assert.equal(board[17][0].id,'A', 'the input is not mutated');
});
test('adjacent double clear removes both rows and lowers the marker twice', () => {
  const board=emptyBoard();board[18].fill(pill());board[19].fill(pill());board[17][4]=pill(2,'marker');
  const result=clearFullRows(board);
  assert.equal(result.count,2);assert.equal(count(result.board),1);assert.equal(result.board[19][4].id,'marker');
});
test('nonadjacent row clears keep all survivor order', () => {
  const board=emptyBoard();board[16].fill(pill());board[19].fill(pill());board[15][1]=pill(0,'top');board[17][1]=pill(1,'middle');board[18][1]=pill(2,'bottom');
  const result=clearFullRows(board);
  assert.equal(result.board[17][1].id,'top');assert.equal(result.board[18][1].id,'middle');assert.equal(result.board[19][1].id,'bottom');
});
test('row clear conservation holds across 100 varied boards', () => {
  const random=seeded(9);
  for(let i=0;i<100;i++) {
    const board=emptyBoard();
    for(let y=0;y<20;y++){const full=random()<.2;for(let x=0;x<10;x++)if(full||random()<.4)board[y][x]=pill(Math.floor(random()*3),`${y}:${x}`);}
    const originalIDs=board.filter(row=>!row.every(Boolean)).flat().filter(Boolean).map(p=>p.id).sort();
    const result=clearFullRows(board);
    assert.equal(count(board)-count(result.board),result.count*10);
    assert.deepEqual(result.board.flat().filter(Boolean).map(p=>p.id).sort(),originalIDs);
    assert.equal(result.board.length,20);
  }
});
test('occupied held-piece spawn ends the shift without overwriting the board', () => {
  const g=game();g.current={shape:0,type:0,rotation:0,x:0,y:10};g.held={shape:4,type:1};g.board[0][4]=pill(2,'original');
  g.hold();assert.equal(g.status,'over');assert.equal(g.board[0][4].id,'original');
  const snapshot=JSON.stringify(g.board);g.hardDrop();assert.equal(JSON.stringify(g.board),snapshot);
});
test('empty hold also validates the incoming queue piece', () => {
  const g=game();g.current={shape:0,type:0,rotation:0,x:0,y:10};g.queue[0]={shape:4,type:1};g.board[0][4]=pill(2);
  g.hold();assert.equal(g.status,'over');
});
test('hold is once per piece and becomes available after locking', () => {
  const g=game();assert.equal(g.hold(),true);assert.equal(g.hold(),false);g.hardDrop();assert.equal(g.holdUsed,false);assert.equal(g.hold(),true);
});
test('piece statistics count completed placements, ignore holds, and reset with a new game', () => {
  const g=game();assert.deepEqual(g.pieceCounts,Array(7).fill(0));
  g.hold();assert.equal(g.pieceCounts.reduce((sum,n)=>sum+n,0),0);
  const shape=g.current.shape;g.hardDrop();assert.equal(g.pieceCounts[shape],1);
  assert.equal(g.pieceCounts.reduce((sum,n)=>sum+n,0),1);
  g.start();assert.deepEqual(g.pieceCounts,Array(7).fill(0));
});
test('defensive lock refuses an invalid piece', () => {
  const g=game();g.current={shape:4,type:0,rotation:0,x:4,y:0};g.board[0][4]=pill(2,'sentinel');g.lock();
  assert.equal(g.status,'over');assert.equal(g.board[0][4].id,'sentinel');assert.equal(count(g.board),1);
});
test('a normal O piece stays on the tray, enabling larger batches', () => {
  const g=game();g.current={shape:4,type:0,rotation:0,x:0,y:18};g.hardDrop();
  assert.equal(count(g.board),4);assert.equal(g.score,0);assert.equal(g.bottles,0);
});
test('deliberate 2x2 bottling awards exactly 80 points once', () => {
  const g=game();g.current={shape:4,type:0,rotation:0,x:0,y:18};g.hardDrop(true);
  assert.equal(count(g.board),0);assert.equal(g.score,80);assert.equal(g.bottles,1);
});
test('4x4 construction survives small batches and collects as one large batch', () => {
  const g=game();square(g.board,0,16,4);g.board[16][2]=g.board[16][3]=g.board[17][2]=g.board[17][3]=null;
  g.current={shape:4,type:0,rotation:0,x:2,y:0};assert.equal(g.previewBatches()[0].size,4);
  g.hardDrop(true);assert.equal(g.bottles,1);assert.equal(g.score,600+32);assert.equal(count(g.board),0);
});
test('mixed types do not bottle and overlapping regions never double count', () => {
  const board=emptyBoard();square(board,0,16,4);let batches=findBatches(board);assert.equal(batches.length,1);assert.equal(batches[0].size,4);
  const mixed=emptyBoard();square(mixed,0,18,2);mixed[19][1]=pill(1);assert.equal(findBatches(mixed).length,0);
  square(board,5,18,2,2);batches=findBatches(board);assert.deepEqual(batches.map(b=>b.size),[4,2]);
});
test('bottling collapse preserves the vertical order and identity of loose pills', () => {
  const board=emptyBoard();board[2][0]=pill(0,'A');board[10][0]=pill(1,'B');board[17][0]=pill(2,'C');
  const result=settleColumns(board);assert.equal(count(result),3);assert.deepEqual(result.slice(17).map(row=>row[0].id),['A','B','C']);
});
test('four-line clear awards 800 and resets the next-piece gravity timer', () => {
  const g=game();for(let y=16;y<20;y++)for(let x=0;x<9;x++)g.board[y][x]=pill(x%3);
  g.current={shape:0,type:0,rotation:1,x:7,y:16};g.fallElapsed=699;g.hardDrop();
  assert.equal(g.lines,4);assert.equal(g.score,800);assert.equal(count(g.board),0);assert.equal(g.fallElapsed,0);
  const y=g.current.y;g.update(1);assert.equal(g.current.y,y);
});
test('level changes at ten rows and bottle points scale once by level', () => {
  const g=game();g.lines=9;g.board[19].fill(pill());g.board[19][8]=g.board[19][9]=null;g.current={shape:4,type:0,rotation:0,x:8,y:18};
  g.hardDrop();assert.equal(g.level,2);assert.equal(g.lines,10);assert.equal(g.score,100);
  g.board=emptyBoard();g.score=0;g.current={shape:4,type:2,rotation:0,x:0,y:18};g.hardDrop(true);assert.equal(g.score,160);
});
test('a prescription advances and awards its bonus only once', () => {
  const g=game();for(let i=0;i<2;i++){g.current={shape:4,type:0,rotation:0,x:0,y:18};g.hardDrop(true);}
  assert.equal(g.orders,1);assert.equal(g.score,360);assert.equal(g.order.kind,'lines');assert.equal(g.orderProgress,0);
  g.advanceOrder([],0);assert.equal(g.orders,1);assert.equal(g.score,360);
});
test('seven-piece bags have no missing or repeated shapes within a bag', () => {
  const g=game();g.bag=[];
  for(let bag=0;bag<10;bag++){const shapes=Array.from({length:7},()=>g.makePiece().shape);assert.equal(new Set(shapes).size,7);}
});
test('wall kicks permit rotating a vertical I at the left wall', () => {
  const g=game();g.current={shape:0,type:0,rotation:1,x:-2,y:5};assert.equal(g.valid(g.current),true);
  assert.equal(g.rotate(),true);assert.equal(g.valid(g.current),true);assert.ok(cellsFor(g.current).every(([x])=>x>=0));
});
test('grounded pieces have a lock delay and cannot reset it forever', () => {
  const g=game();g.current={shape:4,type:0,rotation:0,x:4,y:18};
  for(let i=0;i<4;i++)g.update(100);assert.equal(count(g.board),0);g.update(50);assert.equal(count(g.board),4);
  g.current={shape:4,type:0,rotation:0,x:0,y:18};g.lockResets=15;g.groundedMs=400;g.move(1);assert.equal(g.groundedMs,400);
});
test('landing only spends the portion of the frame actually touching the stack', () => {
  const g=game();g.current={shape:4,type:0,rotation:0,x:4,y:17};g.softDropActive=true;
  g.update(100,true);
  assert.equal(g.current.y,18);assert.equal(g.groundedMs,60);
  for(let i=0;i<3;i++)g.update(100,true);
  g.update(89,true);assert.equal(count(g.board),0);
  g.update(1,true);assert.equal(count(g.board),4);
  assert.equal(g.current.y,0,'the next piece does not inherit elapsed time');
});
test('lock timing is consistent across different frame sizes', () => {
  const run = durations => {
    const g=game();g.current={shape:4,type:0,rotation:0,x:4,y:16};g.softDropActive=true;
    for(const dt of durations)g.update(dt,true);
    return {y:g.current.y,grounded:g.groundedMs,score:g.score,board:g.board};
  };
  assert.deepEqual(run([100,100,100]),run(Array(30).fill(10)));
});
test('paused and finished games ignore gameplay input and elapsed time', () => {
  const g=game();g.pause();const snapshot=JSON.stringify([g.current,g.score,g.board]);
  g.update(10000,true);g.move(1);g.rotate();g.hold();g.hardDrop();assert.equal(JSON.stringify([g.current,g.score,g.board]),snapshot);
  g.finish();g.hardDrop();g.move(-1);assert.equal(g.status,'over');
});
test('switching soft-drop modes cannot spend accumulated normal-gravity time', () => {
  const g=game();g.fallElapsed=650;const y=g.current.y;
  g.update(16,true);assert.equal(g.current.y,y);assert.equal(g.fallElapsed,16);
  g.update(24,true);assert.equal(g.current.y,y+1);assert.equal(g.score,1);
  g.fallElapsed=39;g.update(16,false);assert.equal(g.fallElapsed,16);
});
test('large bottle cascades have finite scoring even above four rows', () => {
  const g=game();
  // Eight full rows plus a collectable batch force a multi-row collapse.
  for(let y=12;y<20;y++)for(let x=0;x<10;x++)g.board[y][x]=pill((x+y)%3);
  square(g.board,0,8,2);g.current={shape:4,type:2,rotation:0,x:6,y:0};g.hardDrop(true);
  assert.ok(g.lines>4);assert.ok(Number.isFinite(g.score));assert.equal(g.status,'playing');
});
test('randomized play maintains board bounds, finite scores, and valid active pieces', () => {
  const random=seeded(20),g=new GameEngine(random);g.start();
  for(let i=0;i<3000;i++){
    if(g.status==='over')g.start();
    const action=Math.floor(random()*7);
    if(action===0)g.move(-1);else if(action===1)g.move(1);else if(action===2)g.rotate();else if(action===3)g.hold();else if(action===4)g.hardDrop();else if(action===5)g.hardDrop(true);else g.update(100,true);
    assert.equal(g.board.length,ROWS);assert.ok(g.board.every(row=>row.length===COLS));assert.ok(Number.isFinite(g.score));
    if(g.status==='playing')assert.equal(g.valid(g.current),true);
    g.events=[];
  }
});
