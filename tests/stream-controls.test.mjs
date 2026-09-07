import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeControlsPlan, validateInteractionModes} from '../scripts/stream-controls.mjs';

test('native controls cannot share an input route, target a fixture or overrun the recording budget', () => {
  for (const other of ['drive', 'exercise'])
    assert.throws(() => validateInteractionModes({controls: true, [other]: true}), /mutually exclusive/);
  assert.throws(() => validateInteractionModes({controls: true, fixture: true}), /native game/);
  assert.throws(() => validateInteractionModes({controls: true, record: true, seconds: 21}), /seconds <=20/);
  assert.doesNotThrow(() => validateInteractionModes({controls: true, record: true, seconds: 10}));
  assert.doesNotThrow(() => validateInteractionModes({record: true, seconds: 60}));
});

test('the camera route moves without mouse buttons and reaches the car before changing yaw', () => {
  const plan = nativeControlsPlan();
  assert.deepEqual(plan[0], {type: 'key', key: 'w', milliseconds: 3000, label: 'W:3000ms'});
  assert.ok(plan.filter(step => step.type === 'mouse').every(step => step.buttons === 0));
  assert.ok(plan.every(step => ['key', 'wait', 'mouse', 'native-state'].includes(step.type)));
  assert.ok(plan.filter(step => step.type === 'key').every(step => ['w', 'p', 'e'].includes(step.key)));
  for (const mode of ['foot', 'car']) {
    const before = plan.findIndex(step => step.name === `${mode}-before-look`);
    const motion = plan.findIndex(step => step.name === `${mode}-look-right-no-buttons`);
    const after = plan.findIndex(step => step.name === `${mode}-after-look`);
    assert.ok(before < motion && motion < after);
  }
});

test('each pause has two native checkpoints around blocked movement and a resumed checkpoint', () => {
  const plan = nativeControlsPlan();
  for (const mode of ['foot', 'car']) {
    const names = plan.map(step => step.name ?? step.label);
    const order = [`${mode}:pause-P`, `${mode}-paused`, `${mode}:W-while-paused:700ms`,
      `${mode}-paused-after-input`, `${mode}:resume-P`, `${mode}-resumed`].map(name => names.indexOf(name));
    assert.ok(order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1])));
    const pausedMovement = plan.slice(order[1], order[3]).filter(step => step.type === 'key');
    assert.deepEqual(pausedMovement.map(step => step.key), ['w']);
  }
  assert.equal(plan.at(-1).name, 'foot-after-car-exit');
  assert.equal(plan.filter(step => step.type === 'native-state').length, 11);
});
