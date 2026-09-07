/** Freeze known static scenery after its transforms have been calculated once. */
export function freezeStaticScene(scene, dynamicRoots) {
  const dynamic = new Set(dynamicRoots);
  scene.updateMatrixWorld(true);
  let count = 0;
  const visit = node => {
    if (dynamic.has(node)) return;
    node.matrixAutoUpdate = false;
    node.matrixWorldAutoUpdate = false;
    count++;
    for (const child of node.children) visit(child);
  };
  for (const child of scene.children) visit(child);
  return count;
}

/** Real wall-clock frame samples, with slow resolution changes and hysteresis. */
export function adaptiveResolution({ mobile, setPixelRatio }) {
  let quality = 0, ratio = 1, lastTime = 0, windowStart = 0, frameTotal = 0, count = 0;
  let fastWindows = 0;
  const maximum = () => Math.min(devicePixelRatio, mobile ? 1.15 : 1.3);
  const stats = { quality: 0, pixelRatio: 1, measuredFrameMs: 0, sampleCount: 0, adjustments: 0 };
  function apply(next) {
    if (Math.abs(next - ratio) < .005) return;
    ratio = next; stats.pixelRatio = next; setPixelRatio(next); stats.adjustments++;
  }
  return {
    stats,
    pause() { lastTime = windowStart = frameTotal = count = fastWindows = 0; },
    setQuality(value) {
      quality = value; stats.quality = value; windowStart = lastTime = 0; count = frameTotal = fastWindows = 0;
      apply(value === 2 ? Math.min(devicePixelRatio,1.7) : value === 1 ? Math.min(devicePixelRatio,.8) : maximum());
    },
    sample(time) {
      const interval = time - lastTime; lastTime = time;
      if (!windowStart) windowStart = time;
      if (interval > 0 && interval < 250) { frameTotal += interval; count++; }
      if (time - windowStart < 1800 || count < 15) return;
      const mean = frameTotal / count;
      stats.measuredFrameMs = mean; stats.sampleCount = count;
      if (quality === 0) {
        if (mean > 31) { apply(Math.max(mobile ? .65 : .7, ratio - .1)); fastWindows = 0; }
        else if (mean < 19 && ++fastWindows >= 3) { apply(Math.min(maximum(),ratio + .05)); fastWindows = 0; }
        else if (mean >= 19) fastWindows = 0;
      }
      windowStart = time; count = frameTotal = 0;
    },
  };
}
