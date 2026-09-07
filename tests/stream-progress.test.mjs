import test from 'node:test';
import assert from 'node:assert/strict';
import {decodedBetween, inputReadiness} from '../scripts/stream-progress.mjs';

const snapshot = (frames, bytes, extra = {}) => ({connection: 'connected', width: 1280,
  height: 720, incoming: [{id: 'video-1', framesDecoded: frames, bytesReceived: bytes}], ...extra});

test('the native single-frame freeze is insufficient for sending input', () => {
  const first = snapshot(1, 32967);
  assert.deepEqual(inputReadiness(first, snapshot(1, 32967)),
    {ready: false, newFrames: 0, newBytes: 0});
  assert.equal(inputReadiness(first, snapshot(3, 34000)).ready, false);
  assert.deepEqual(inputReadiness(first, snapshot(4, 35000)),
    {ready: true, newFrames: 3, newBytes: 2033});
});

test('counter resets or replacement streams cannot masquerade as progress', () => {
  const first = snapshot(50, 50000);
  assert.equal(inputReadiness(first, snapshot(3, 1000)).ready, false);
  assert.deepEqual(decodedBetween(first, snapshot(60, 60000, {
    incoming: [{id: 'replacement', framesDecoded: 60, bytesReceived: 60000}],
  })), []);
});

test('frames need new bytes and a connected, nonempty video', () => {
  const first = snapshot(1, 1000);
  assert.equal(inputReadiness(first, snapshot(8, 1000)).ready, false);
  assert.equal(inputReadiness(first, snapshot(8, 2000, {connection: 'disconnected'})).ready, false);
  assert.equal(inputReadiness(first, snapshot(8, 2000, {width: 0})).ready, false);
});
