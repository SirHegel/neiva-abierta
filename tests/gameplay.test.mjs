import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCollisionIndex, moveWithCollision } from '../src/physics.js';
import { WALK_TUNING, VEHICLE_TUNING, createFixedStepper, stepWalk, settleWalkMotion, stepVehicle, settleVehicleMotion, guideToDestination, createObservationStops, createObservationTour } from '../src/gameplay.js';

const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected} ± ${tolerance}`);
const advanceWalk = (position, state, input, dt, blocked = () => false) => {
  const motion = stepWalk(state, input, dt), before = { ...position };
  moveWithCollision(position, motion.dx, motion.dz, blocked);
  return settleWalkMotion(motion, position.x - before.x, position.z - before.z, dt);
};
const advanceCar = (position, state, input, dt, blocked = () => false) => {
  const motion = stepVehicle(state, input, dt), before = { ...position };
  moveWithCollision(position, motion.dx, motion.dz, blocked, 1.45);
  return settleVehicleMotion(motion, position.x - before.x, position.z - before.z, dt);
};

test('fixed ticks preserve the same walk/run/turn/brake trajectory at 15/30/60/120 FPS', () => {
  const runs = [15,30,60,120].map(fps => {
    const position = { x:0, z:0 }, stepper = createFixedStepper(); let state = {};
    for (let frame = 0; frame < fps * 4; frame++) stepper.advance(1 / fps, (dt, time) => {
      const input = time < 1 ? { forward:1, yaw:-Math.PI / 2 } : time < 2.5 ? { forward:1, sideways:.5, yaw:0, sprint:true } : {};
      state = advanceWalk(position, state, input, dt);
    });
    assert.equal(stepper.snapshot().ticks, 240); close(state.speed, 0);
    return { ...position, distance:Math.hypot(position.x, position.z) };
  });
  assert.ok(runs[0].distance > 5, 'the assertion covers real displacement');
  for (const result of runs) for (const field of ['x','z','distance']) close(result[field], runs[0][field]);
});

test('fixed ticks preserve driving, steering, braking and reverse at 15/30/60/120 FPS', () => {
  const runs = [15,30,60,120].map(fps => {
    const position = { x:0, z:0 }, stepper = createFixedStepper(); let state = {};
    for (let frame = 0; frame < fps * 8; frame++) stepper.advance(1 / fps, (dt, time) => {
      const input = time < 2 ? { throttle:1 } : time < 4 ? { throttle:1, steer:.7 } : time < 5 ? { brake:true } : time < 7 ? { throttle:-1, steer:.4 } : {};
      state = advanceCar(position, state, input, dt);
    });
    assert.equal(stepper.snapshot().ticks, 480);
    return { ...position, speed:state.speed, angle:state.angle };
  });
  assert.ok(Math.hypot(runs[0].x, runs[0].z) > 10);
  for (const result of runs) for (const field of ['x','z','speed','angle']) close(result[field], runs[0][field]);
});

test('fixed clock retains overload instead of discarding time and reset prevents hidden catch-up', () => {
  const stepper = createFixedStepper({ step:.01, maxSteps:20 }); let ticks = 0;
  const first = stepper.advance(1.03, () => ticks++);
  assert.equal(first.steps, 20); close(first.pendingSeconds, .83);
  for (let i = 0; i < 6; i++) stepper.advance(0, () => ticks++);
  assert.equal(ticks, 103); close(stepper.snapshot().simulatedSeconds, 1.03); close(stepper.snapshot().pendingSeconds, 0);
  stepper.advance(.005, () => ticks++); stepper.reset();
  assert.equal(stepper.advance(.005, () => ticks++).steps, 0);
  assert.throws(() => createFixedStepper({ step:0 }), RangeError);
});

test('walking accelerates gradually, caps diagonal speed and brakes without reversing', () => {
  let state = stepWalk({}, { forward:1, sideways:1, sprint:true }, 1 / 60);
  assert.ok(state.speed > 0 && state.speed < WALK_TUNING.runSpeed / 10);
  for (let i = 0; i < 60; i++) state = stepWalk(state, { forward:1, sideways:1, sprint:true }, 1 / 60);
  close(state.speed, WALK_TUNING.runSpeed);
  const before = { ...state };
  state = stepWalk(state, {}, 1 / 60); assert.ok(state.speed < before.speed && state.speed > 0);
  for (let i = 0; i < 60; i++) { const next = stepWalk(state, {}, 1 / 60); assert.ok(next.speed <= state.speed + 1e-9); state = next; }
  close(state.speed, 0); close(state.vx, 0); close(state.vz, 0);
});

test('walking collision handoff blocks thin walls, preserves free sliding and stores no release impulse', () => {
  const blocked = createCollisionIndex([{ points:[[3,-20],[3.1,-20],[3.1,20],[3,20]] }]);
  const position = { x:0, z:0 }; let state = {};
  for (let i = 0; i < 120; i++) state = advanceWalk(position, state, { forward:1, yaw:-Math.PI / 2, sprint:true }, 1 / 60, blocked);
  assert.ok(position.x < 2.551); assert.equal(blocked(position.x, position.z, .45), false); close(state.vx, 0);
  const released = advanceWalk(position, state, { forward:1, yaw:-Math.PI / 2, sprint:true }, 1 / 60);
  assert.ok(released.vx <= WALK_TUNING.acceleration / 60 + 1e-8, 'removing the wall does not restore pre-collision speed');
  const slide = settleWalkMotion({ vx:2, vz:3, dx:.1, dz:.15 }, 0, .15, .05);
  close(slide.vx, 0); close(slide.vz, 3); close(slide.movingSpeed, 3);
});

test('vehicle brake matches constant-deceleration stopping distance and cannot engage reverse', () => {
  let state = { speed:12, angle:0 }, distance = 0;
  for (let i = 0; i < 180; i++) { state = stepVehicle(state, { throttle:-1, brake:true }, 1 / 60); distance += state.dz; assert.ok(state.speed >= 0); }
  close(state.speed, 0); close(distance, 12 * 12 / (2 * VEHICLE_TUNING.braking), 1e-6);
});

test('opposing throttle first stops the car; a later tick can propel reverse', () => {
  const stopping = stepVehicle({ speed:.1, angle:0 }, { throttle:-1 }, 1 / 60);
  assert.equal(stopping.speed, 0); assert.ok(stopping.dz > 0);
  const reversing = stepVehicle(stopping, { throttle:-1 }, 1 / 60);
  assert.ok(reversing.speed < 0 && reversing.dz < 0); assert.equal(reversing.mode, 'reversing');
  let state = reversing;
  for (let i = 0; i < 600; i++) state = stepVehicle(state, { throttle:-1 }, 1 / 60);
  close(state.speed, -VEHICLE_TUNING.reverseLimit);
});

test('coasting removes speed monotonically and steering cannot pivot a stationary car', () => {
  let state = { speed:3, angle:.3 };
  for (let i = 0; i < 600; i++) { const next = stepVehicle(state, {}, 1 / 60); assert.ok(next.speed <= state.speed && next.speed >= 0); state = next; }
  close(state.speed, 0);
  const stationary = stepVehicle(state, { steer:1 }, 1 / 60);
  close(stationary.yawRate, 0); close(stationary.angle, .3);
});

test('high-speed steering respects lateral acceleration and reverses its turn with reverse motion', () => {
  let fast = { speed:7, angle:0 }, slow = { speed:3, angle:0 };
  for (let i = 0; i < 180; i++) {
    fast = stepVehicle(fast, { throttle:1, steer:1 }, 1 / 60);
    slow = stepVehicle({ ...slow, speed:3 }, { steer:1 }, 1 / 60);
    assert.ok(Math.abs(fast.yawRate * fast.speed) <= VEHICLE_TUNING.lateralAcceleration + 1e-8);
  }
  assert.ok(Math.abs(fast.yawRate) < Math.abs(slow.yawRate));
  const reverse = stepVehicle({ speed:-3, steerAngle:.4 }, { throttle:-1, steer:1 }, 1 / 60);
  assert.ok(fast.yawRate < 0 && reverse.yawRate > 0);
});

test('vehicle collision handoff cannot tunnel, gain energy or retain speed against a wall', () => {
  const blocked = createCollisionIndex([{ points:[[3,-20],[3.1,-20],[3.1,20],[3,20]] }]);
  const position = { x:0, z:0 }; let state = { speed:20, angle:Math.PI / 2 };
  for (let i = 0; i < 120; i++) state = advanceCar(position, state, { throttle:1 }, 1 / 60, blocked);
  assert.ok(position.x < 1.551); assert.equal(blocked(position.x, position.z, 1.45), false); close(state.speed, 0);
  const released = advanceCar(position, state, { throttle:1 }, 1 / 60);
  assert.ok(released.speed <= VEHICLE_TUNING.acceleration / 60 + 1e-8);
  const motion = stepVehicle({ speed:8, angle:.4 }, { throttle:1 }, 1 / 60);
  assert.ok(Math.abs(settleVehicleMotion(motion, motion.dx * 3, motion.dz * 3, 1 / 60).speed) <= Math.abs(motion.speed));
});

test('guidance measures accessible points and correctly distinguishes right, left and compass north', () => {
  const position = { x:0, z:0 }, west = { id:'a', point:{ x:-40, z:0 }, interactionRadius:18 };
  const guide = guideToDestination(position, west, 0);
  close(guide.distance, 40); close(guide.remaining, 22); close(guide.relativeAngle, Math.PI / 2); assert.equal(guide.direction, 'right'); assert.equal(guide.compass, 'O');
  assert.equal(guideToDestination(position, { x:40, z:0 }, 0).direction, 'left');
  assert.equal(guideToDestination(position, { x:0, z:-40 }, Math.PI).compass, 'N');
  const at = guideToDestination(west.point, west, 2);
  assert.equal(at.arrived, true); close(at.remaining, 0); close(at.relativeAngle, 0); assert.equal(at.compass, null);
  assert.equal(guideToDestination(null, west), null);
});

const stops = [
  { id:'a', name:'Lugar A', point:{ x:100, z:0 }, interactionRadius:18 },
  { id:'b', name:'Lugar B', point:{ x:200, z:0 }, interactionRadius:18 },
];
test('proximity and guidance never award progress; only explicit nearby on-foot observation does', () => {
  const tour = createObservationTour(stops, ['unknown']);
  for (let i = 0; i < 100; i++) { tour.nearby({ x:100, z:0 }); tour.guide({ x:100, z:0 }, 0); }
  assert.equal(tour.progress().completed, 0);
  assert.deepEqual(tour.observe('a', { x:0, z:0 }), { ok:false, reason:'out-of-range' });
  assert.deepEqual(tour.observe('a', { x:100, z:0 }, { onFoot:false }), { ok:false, reason:'vehicle' });
  assert.deepEqual(tour.observe('a', { x:100, z:0 }, { canObserve:() => false }), { ok:false, reason:'occluded' });
  assert.equal(tour.observe('a', { x:82, z:0 }).firstVisit, true);
  assert.equal(tour.observe('a', { x:82, z:0 }).firstVisit, false);
  assert.deepEqual(tour.progress(), { completed:1, total:2, ids:['a'] });
  assert.equal(tour.next().id, 'b');
});

test('tour selection, visibility, restored IDs and returned points preserve traversal invariants', () => {
  const tour = createObservationTour([...stops, stops[0]], ['a','a',null]);
  assert.equal(tour.progress().total, 2); assert.equal(tour.progress().completed, 1);
  assert.equal(tour.select('missing'), false); assert.equal(tour.select('b'), true);
  assert.equal(tour.guide({ x:0, z:0 }, 0).id, 'b');
  assert.equal(tour.guide(null, 0), null);
  assert.equal(tour.nearby({ x:200, z:0 }, { onFoot:false }), null);
  assert.equal(tour.nearby({ x:200, z:0 }, { canObserve:() => false }), null);
  assert.throws(() => { tour.selected().point.x = 0; }, TypeError);
  assert.equal(tour.select(null), true); assert.equal(tour.selected(), null);
  assert.throws(() => createObservationTour([{ id:'center-only', x:0, z:0 }]), TypeError);
});

test('observation cards use explicit safe accesses and references from the checked survey', () => {
  const survey = JSON.parse(readFileSync(new URL('../public/data/neiva-survey.json', import.meta.url)));
  const destinations = [{ id:'studio', name:'Estudio' }, ...survey.places];
  const cards = createObservationStops(destinations, { survey, resolveAccess:place => ({ x:place.x + 50, z:place.z }) });
  assert.ok(!cards.some(card => card.id === 'studio'));
  const courthouse = cards.find(card => card.id === 'way/312876443');
  assert.ok(courthouse.sourceIds.includes('judiciary-address'));
  assert.ok(courthouse.references.some(source => source.id === 'judiciary-address' && source.url.startsWith('https://')));
  assert.ok(courthouse.references.some(source => source.id === 'user-streetview-2024' && source.url === null));
  close(courthouse.point.x, survey.places.find(place => place.id === courthouse.id).x + 50);
  const cathedral = cards.find(card => card.id === 'way/313286677');
  assert.ok(cathedral.references.some(source => source.id === 'diocese-cathedral'));
  assert.equal(createObservationStops(destinations, { survey }).length, 0, 'centres are not silently accepted as safe observation points');
  const generic = createObservationStops([{ id:'node/123',name:'Lugar del mapa',point:{x:0,z:0} }]);
  assert.equal(generic[0].references[0].url,'https://www.openstreetmap.org/node/123');
});

test('non-finite controls and frame deltas do not contaminate motion or the simulation clock', () => {
  for (const motion of [stepWalk({ vx:NaN }, { forward:Infinity, yaw:NaN }, NaN), stepVehicle({ speed:Infinity }, { steer:NaN }, Infinity)]) {
    for (const value of Object.values(motion)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
    close(motion.dx, 0); close(motion.dz, 0);
  }
  const clock = createFixedStepper(); let calls = 0;
  clock.advance(Infinity, () => calls++); clock.advance(-10, () => calls++);
  assert.equal(calls, 0); close(clock.snapshot().elapsedSeconds, 0);
});
