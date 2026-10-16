import test from 'node:test';
import assert from 'node:assert/strict';
import { HorizontalInput } from '../game-input.js';

test('horizontal movement has a deliberate delay and repeat cadence', () => {
  const input=new HorizontalInput();input.press('ArrowLeft',-1,0);
  assert.equal(input.next(169),0);assert.equal(input.next(170),-1);
  assert.equal(input.next(234),0);assert.equal(input.next(235),-1);
});
test('releasing the latest direction resumes the other held key', () => {
  const input=new HorizontalInput();input.press('KeyA',-1,0);input.press('ArrowRight',1,30);
  assert.equal(input.next(200),1);input.release('ArrowRight',210);
  assert.equal(input.next(274),0);assert.equal(input.next(275),-1);
  input.release('KeyA',280);assert.equal(input.next(1000),0);
});
test('releasing an older control does not cancel the current direction', () => {
  const input=new HorizontalInput();input.press('ArrowLeft',-1,0);input.press('KeyD',1,10);
  input.release('ArrowLeft',20);assert.equal(input.next(180),1);
});
test('touch and keyboard can hand movement back to each other', () => {
  const input=new HorizontalInput();input.press('ArrowLeft',-1,0);input.press('pointer:7',1,10);
  input.release('pointer:7',20);assert.equal(input.next(85),-1);
});
test('pausing or losing focus clears all held controls', () => {
  const input=new HorizontalInput();input.press('ArrowLeft',-1,0);input.press('pointer:8',1,10);
  input.clear();assert.equal(input.next(1000),0);
  input.release('pointer:8',1010);assert.equal(input.next(2000),0);
});
