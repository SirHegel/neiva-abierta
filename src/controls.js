export const WALK_SPEED = 2;
export const RUN_SPEED = 5.4;

export function normalizeSensitivity(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(.5, Math.min(2, number)) : 1;
}

/** O(1) per input event. Only an explicit request may acquire the mouse.
 * Late grants are released when gameplay is paused; Escape never reacquires it.
 * Both event-only and Promise-returning requestPointerLock implementations work.
 */
export function createLookController({ canvas, isActive, isTouch, onLook, onPause, onMode, doc = document }) {
  let wanted = false, pending = false, accepted = false, releasing = false, queued = false;
  let mode = 'idle', requestId = 0, touch = null, mouse = null, lastError = null;
  const setMode = next => { if (mode !== next) { mode = next; onMode(next); } };
  const locked = () => doc.pointerLockElement === canvas;
  const reset = () => { touch = null; mouse = null; };

  function fail(id, error) {
    if (id !== requestId) return;
    if (error) lastError = { name:error.name, message:error.message };
    if (!pending) return;
    pending = false;
    if (!locked()) setMode(wanted && isActive() ? 'free' : 'idle');
  }
  function request() {
    if (!isActive()) return;
    reset();
    if (isTouch()) { wanted = false; setMode('touch'); return; }
    wanted = true;
    if (releasing) { queued = true; setMode('pending'); return; }
    if (locked()) { accepted = true; setMode('locked'); return; }
    if (pending) return;
    if (typeof canvas.requestPointerLock !== 'function') { setMode('free'); return; }
    pending = true;
    lastError = null;
    const id = ++requestId;
    setMode('pending');
    try {
      const result = canvas.requestPointerLock();
      if (result?.catch) result.catch(error => fail(id,error));
    } catch (error) { fail(id,error); }
  }
  function release() {
    wanted = false; queued = false; accepted = false; reset(); setMode('idle');
    if (locked()) { releasing = true; doc.exitPointerLock(); }
  }
  doc.addEventListener('pointerlockchange', () => {
    reset();
    if (locked()) {
      pending = false;
      if (!wanted || !isActive()) { accepted = false; releasing = true; doc.exitPointerLock(); return; }
      releasing = false; accepted = true; setMode('locked');
      return;
    }
    // A grant can be cancelled before its change event is delivered. The
    // resulting unlocked event must settle that request as well.
    pending = false;
    const escaped = accepted && wanted && isActive();
    accepted = false; releasing = false;
    if (escaped) { wanted = false; queued = false; setMode('idle'); onPause(); return; }
    if (queued && wanted && isActive()) { queued = false; pending = false; request(); return; }
    setMode(wanted && isActive() ? 'free' : 'idle');
  });
  doc.addEventListener('pointerlockerror', () => fail(requestId));
  doc.addEventListener('mousemove', event => {
    if (isActive() && locked() && wanted) onLook(event.movementX || 0, event.movementY || 0);
  });
  canvas.addEventListener('pointerdown', event => {
    if (!isActive() || event.pointerType === 'mouse') return;
    touch = { id:event.pointerId, x:event.clientX, y:event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!isActive() || locked()) return;
    if (event.pointerType === 'mouse') {
      if (mode === 'free' && mouse) onLook(event.clientX - mouse.x, event.clientY - mouse.y);
      mouse = { x:event.clientX, y:event.clientY };
    } else if (touch?.id === event.pointerId) {
      onLook(event.clientX - touch.x, event.clientY - touch.y);
      touch.x = event.clientX; touch.y = event.clientY;
    }
  });
  canvas.addEventListener('pointerleave', () => { mouse = null; });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, event => {
    if (touch?.id === event.pointerId) touch = null;
  });
  canvas.addEventListener('click', event => {
    if (isActive() && !isTouch() && !locked() && event.pointerType !== 'touch') request();
  });
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  return { request, release, reset, snapshot:() => ({ mode, locked:locked(), pending, error:lastError }) };
}
