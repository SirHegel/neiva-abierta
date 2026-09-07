import { WALK_SPEED, RUN_SPEED } from './controls.js';

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const axis = value => clamp(finite(value), -1, 1);
const duration = dt => Math.max(0, finite(dt));
const approach = (value, target, change) => value + clamp(target - value, -change, change);
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const validPoint = point => Number.isFinite(point?.x) && Number.isFinite(point?.z);

export const WALK_TUNING = Object.freeze({ walkSpeed:WALK_SPEED, runSpeed:RUN_SPEED, acceleration:12, braking:18, turnBraking:22 });
export const VEHICLE_TUNING = Object.freeze({ forwardLimit:20, reverseLimit:4.5, acceleration:6, reverseAcceleration:3, braking:10, rollingResistance:.65, drag:.003, wheelbase:2.55, steeringLimit:.62, steeringRate:2.8, lateralAcceleration:6 });

/** Fixed simulation clock. O(min(backlog / step, maxSteps)) time, O(1) space.
 * Elapsed time is never clamped/discarded: overload remains visible as debt.
 * Reset on pause/visibility loss; hidden time must not enter the simulation.
 */
export function createFixedStepper({ step = 1 / 60, maxSteps = 120 } = {}) {
  if (!(Number.isFinite(step) && step > 0) || !Number.isInteger(maxSteps) || maxSteps < 1) throw new RangeError('Invalid fixed-step configuration');
  let accumulator = 0, ticks = 0, elapsedSeconds = 0;
  const snapshot = () => ({ step, ticks, elapsedSeconds, simulatedSeconds:ticks * step, pendingSeconds:accumulator, alpha:Math.min(1, accumulator / step) });
  return {
    advance(elapsed, tick) {
      elapsed = duration(elapsed); accumulator += elapsed; elapsedSeconds += elapsed;
      let steps = 0;
      while (accumulator + step * 1e-8 >= step && steps < maxSteps) {
        tick(step, ticks * step);
        accumulator = Math.max(0, accumulator - step); ticks++; steps++;
      }
      return { ...snapshot(), steps };
    },
    reset() { accumulator = 0; ticks = 0; elapsedSeconds = 0; },
    snapshot,
  };
}

/** Camera-relative walking. O(1) time/space; speed never exceeds the configured
 * target when starting within its limit. Integrate at a fixed dt, in SI units.
 */
export function stepWalk(state = {}, input = {}, dt = 0, tuning = WALK_TUNING) {
  dt = duration(dt);
  const forward = axis(input.forward), sideways = axis(input.sideways), yaw = finite(input.yaw);
  const length = Math.max(1, Math.hypot(forward, sideways)), top = input.sprint ? tuning.runSpeed : tuning.walkSpeed;
  const tx = (-Math.sin(yaw) * forward + Math.cos(yaw) * sideways) / length * top;
  const tz = (-Math.cos(yaw) * forward - Math.sin(yaw) * sideways) / length * top;
  const oldX = finite(state.vx), oldZ = finite(state.vz), difference = Math.hypot(tx - oldX, tz - oldZ);
  const acceleration = !forward && !sideways ? tuning.braking : oldX * tx + oldZ * tz < 0 ? tuning.turnBraking : tuning.acceleration;
  const blend = difference ? Math.min(1, acceleration * dt / difference) : 0;
  const vx = oldX + (tx - oldX) * blend, vz = oldZ + (tz - oldZ) * blend;
  return { vx, vz, dx:(oldX + vx) * .5 * dt, dz:(oldZ + vz) * .5 * dt, speed:Math.hypot(vx, vz) };
}

/** Collision handoff after moveWithCollision. O(1). Free axes retain terminal
 * velocity; blocked axes lose stored velocity, preventing a release impulse.
 */
export function settleWalkMotion(motion, actualDx, actualDz, dt) {
  dt = duration(dt); actualDx = finite(actualDx); actualDz = finite(actualDz);
  const clippedX = Math.abs(actualDx - motion.dx) > 1e-7, clippedZ = Math.abs(actualDz - motion.dz) > 1e-7;
  const vx = clippedX ? 0 : motion.vx, vz = clippedZ ? 0 : motion.vz;
  return { ...motion, vx, vz, dx:actualDx, dz:actualDz, speed:Math.hypot(vx, vz), movingSpeed:dt ? Math.hypot(actualDx, actualDz) / dt : 0, collided:clippedX || clippedZ };
}

/** Kinematic bicycle, O(1) time/space. Angle 0 faces +Z; positive steer turns
 * right as in the existing controls (decreasing angle). Opposing throttle
 * brakes to zero before reverse propulsion; a brake never changes speed sign.
 */
export function stepVehicle(state = {}, input = {}, dt = 0, tuning = VEHICLE_TUNING) {
  dt = duration(dt);
  const oldSpeed = clamp(finite(state.speed), -tuning.reverseLimit, tuning.forwardLimit), throttle = axis(input.throttle);
  let speed = oldSpeed, mode = 'stopped';
  if (input.brake || throttle && oldSpeed * throttle < 0) {
    speed = approach(oldSpeed, 0, tuning.braking * dt); mode = speed ? 'braking' : 'stopped';
  } else if (throttle) {
    const limit = throttle > 0 ? tuning.forwardLimit : -tuning.reverseLimit;
    const acceleration = throttle > 0 ? tuning.acceleration : tuning.reverseAcceleration;
    speed = approach(oldSpeed, limit, Math.abs(throttle) * acceleration * dt);
    mode = speed < 0 ? 'reversing' : 'accelerating';
  } else {
    speed = approach(oldSpeed, 0, (tuning.rollingResistance + tuning.drag * oldSpeed * oldSpeed) * dt);
    mode = speed ? 'coasting' : 'stopped';
  }
  const averageSpeed = (oldSpeed + speed) * .5;
  const turnSpeed = Math.max(Math.abs(oldSpeed), Math.abs(speed));
  const maximumSteer = Math.min(tuning.steeringLimit, Math.atan(tuning.lateralAcceleration * tuning.wheelbase / Math.max(1, turnSpeed * turnSpeed)));
  // Use the fastest endpoint to preserve the lateral budget throughout an
  // accelerating or braking tick. Returned steering matches physical steering.
  const steerAngle = clamp(approach(finite(state.steerAngle), axis(input.steer) * maximumSteer, tuning.steeringRate * dt), -maximumSteer, maximumSteer);
  const yawRate = -averageSpeed / tuning.wheelbase * Math.tan(steerAngle);
  const oldAngle = finite(state.angle), angle = wrap(oldAngle + yawRate * dt), midAngle = oldAngle + yawRate * dt * .5;
  return { speed, angle, steerAngle, yawRate, mode, dx:Math.sin(midAngle) * averageSpeed * dt, dz:Math.cos(midAngle) * averageSpeed * dt };
}

/** O(1) collision handoff. A collision cannot add energy. The retained scalar
 * speed follows forward progress along the requested trajectory, not wall slide.
 */
export function settleVehicleMotion(motion, actualDx, actualDz, dt) {
  dt = duration(dt); actualDx = finite(actualDx); actualDz = finite(actualDz);
  const squared = motion.dx * motion.dx + motion.dz * motion.dz;
  const clipped = Math.hypot(actualDx - motion.dx, actualDz - motion.dz) > 1e-7;
  const fraction = squared > 1e-14 ? clamp((actualDx * motion.dx + actualDz * motion.dz) / squared, 0, 1) : 1;
  const speed = clipped ? motion.speed * fraction : motion.speed;
  return { ...motion, speed, dx:actualDx, dz:actualDz, movingSpeed:dt ? Math.hypot(actualDx, actualDz) / dt : 0, collided:clipped, mode:Math.abs(speed) < .001 ? 'stopped' : motion.mode };
}

const DIRECTIONS = ['ahead','ahead-right','right','behind-right','behind','behind-left','left','ahead-left'];
const DIRECTION_LABELS = ['adelante','adelante a la derecha','a la derecha','detrás a la derecha','detrás','detrás a la izquierda','a la izquierda','adelante a la izquierda'];
const COMPASS = ['N','NE','E','SE','S','SO','O','NO'];

/** O(1), straight-line guidance to an accessible observation point. Positive
 * relativeAngle means screen/player right; heading uses atan2(x, z), like actors.
 * Distance/remaining are metres, never a claim about a routed walking distance.
 */
export function guideToDestination(position, destination, heading = 0) {
  const point = destination?.point || destination;
  if (!validPoint(position) || !validPoint(point)) return null;
  const dx = point.x - position.x, dz = point.z - position.z, distance = Math.hypot(dx, dz);
  const radius = Math.max(0, finite(destination.interactionRadius, 18));
  const targetHeading = distance > 1e-8 ? Math.atan2(dx, dz) : finite(heading);
  const relativeAngle = wrap(finite(heading) - targetHeading);
  const sector = (Math.round(relativeAngle / (Math.PI / 4)) + 8) % 8;
  const bearingDegrees = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
  return { id:destination.id ?? null, distance, remaining:Math.max(0, distance - radius), arrived:distance <= radius, relativeAngle, targetHeading, bearingDegrees:distance ? bearingDegrees : null, compass:distance ? COMPASS[Math.round(bearingDegrees / 45) % 8] : null, direction:DIRECTIONS[sector], directionLabel:DIRECTION_LABELS[sector], distanceLabel:distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1).replace('.', ',')} km`, measurement:'straight-line' };
}

const OBSERVATIONS = {
  'way/313286677': { text:'Mira los portales apuntados, el reloj y la aguja roja de la Catedral. La recreación del exterior se apoya en su huella cartográfica y en una fotografía de la Diócesis.', focus:'Portales, reloj y aguja central', additionalReference:{ id:'diocese-cathedral', title:'Diócesis de Neiva: Catedral Inmaculada Concepción', url:'https://diocesisdeneiva.org/directorio/parroquias/Inmaculada-Concepcion---Catedral' } },
  'way/312876443': { text:'El Palacio de Justicia se identifica en la dirección Carrera 4 No. 6-99. Observa el frente bajo, sus franjas de ventanas y el espacio de acceso representados junto a la calle.', focus:'Ventanas y acceso desde Carrera 4' },
  'way/313286678': { text:'El Hotel Neiva Plaza publica su dirección en Calle 7 No. 4-62. Su fotografía oficial orienta esta interpretación de los balcones, terrazas y volúmenes del frente.', focus:'Balcones y terrazas hacia Calle 7' },
  'way/313286683': { text:'Observa el campanario lateral con reloj, el portal y la cubierta de teja del Templo Colonial. Las fichas del inventario turístico del Huila sirven de referencia para estos rasgos.', focus:'Campanario lateral y portal' },
  'way/39365299': { text:'Recorre a pie el Parque Santander y observa la fuente y el arbolado. La referencia municipal documenta la recuperación de la fuente; su forma y la distribución del parque se interpretan en esta escena.', focus:'Fuente y espacio público' },
};

/** Build original cards, O(D·F + S + R) time and O(D + S + R) space.
 * D = destinations, F = survey feature/place/override records, S = sources,
 * R = source memberships joined across destinations. No city geometry scans.
 * resolveAccess must return a collision-checked {x,z}; centres are never used
 * silently. Studio remains its existing explicit contact interaction.
 */
export function createObservationStops(destinations, { survey = {}, resolveAccess } = {}) {
  const sourceById = new Map((survey.sources || []).map(source => [source.id, source]));
  const features = Object.values(survey.features || {});
  return destinations.flatMap(destination => {
    if (!destination?.id || destination.id === 'studio') return [];
    const point = resolveAccess ? resolveAccess(destination) : destination.point;
    if (!validPoint(point)) return [];
    const records = [destination, ...features.filter(record => record.id === destination.id), ...(survey.places || []).filter(record => record.id === destination.id), ...(survey.buildingOverrides || []).filter(record => record.id === destination.id)];
    const sourceIds = [...new Set(records.flatMap(record => record.sourceIds || []))];
    const references = sourceIds.flatMap(id => {
      const source = sourceById.get(id);
      return source ? [{ id, title:source.title, url:/^https?:\/\//.test(source.url || '') ? source.url : null }] : [];
    });
    const card = OBSERVATIONS[destination.id] || { text:'Observa este lugar desde su acceso. Puedes registrar la parada y seguir el recorrido a pie o en carro.', focus:destination.name };
    if (card.additionalReference) references.push({ ...card.additionalReference });
    if (!references.length && /^(way|node|relation)\/\d+$/.test(destination.id)) references.push({ id:'osm-place', title:'Ubicación en OpenStreetMap', url:`https://www.openstreetmap.org/${destination.id}` });
    return [{ id:destination.id, name:destination.name, point:{ x:point.x, z:point.z }, interactionRadius:18, text:card.text, focus:card.focus, sourceIds, references, limitation:'Exterior interpretado: las proporciones y las superficies ocultas no constituyen un levantamiento medido.' }];
  });
}

/** O(L) creation/progress/nearby/observation, O(1) selection; add the caller's
 * optional visibility query. No storage/DOM side effects. Proximity and route
 * guidance never award progress: only an explicit observe call can do so.
 */
export function createObservationTour(landmarks, visitedIds = []) {
  const stops = new Map();
  for (const stop of landmarks) {
    if (typeof stop.id !== 'string' || !validPoint(stop.point)) throw new TypeError('Observation stop requires an id and an explicit accessible point');
    if (!stops.has(stop.id)) stops.set(stop.id, Object.freeze({ ...stop, point:Object.freeze({ ...stop.point }), interactionRadius:Math.max(0, finite(stop.interactionRadius, 18)) }));
  }
  const visited = new Set([...visitedIds].filter(id => stops.has(id)));
  let selectedId = null;
  const progress = () => ({ completed:visited.size, total:stops.size, ids:[...visited] });
  const next = () => [...stops.values()].find(stop => !visited.has(stop.id)) || null;
  const selected = () => stops.get(selectedId) || null;
  const visible = (position, stop, options) => !options.canObserve || options.canObserve(position, stop.point);
  return {
    select(id) { if (id === null) { selectedId = null; return true; } if (!stops.has(id)) return false; selectedId = id; return true; },
    selected, next, progress,
    guide(position, heading) { const stop = selected() || next(), guidance = stop && guideToDestination(position, stop, heading); return guidance ? { ...guidance, stop } : null; },
    nearby(position, options = {}) {
      if (options.onFoot === false || !validPoint(position)) return null;
      let closest = null;
      for (const stop of stops.values()) {
        const distance = Math.hypot(stop.point.x - position.x, stop.point.z - position.z);
        if (distance <= stop.interactionRadius && (!closest || distance < closest.distance) && visible(position, stop, options)) closest = { stop, distance, observed:visited.has(stop.id) };
      }
      return closest;
    },
    observe(id, position, options = {}) {
      const stop = stops.get(id);
      if (!stop) return { ok:false, reason:'unknown' };
      if (options.onFoot === false) return { ok:false, reason:'vehicle' };
      if (!validPoint(position) || Math.hypot(stop.point.x - position.x, stop.point.z - position.z) > stop.interactionRadius) return { ok:false, reason:'out-of-range' };
      if (!visible(position, stop, options)) return { ok:false, reason:'occluded' };
      const firstVisit = !visited.has(id); visited.add(id);
      return { ok:true, firstVisit, stop, progress:progress() };
    },
  };
}
