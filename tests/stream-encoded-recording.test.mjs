import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createContext, runInContext} from 'node:vm';
import {createVp8Collector, parseIvf, remuxIvf, finishEncodedRecording, startEncodedRecording,
  encodedRecordingPlan, installEncodedRecording} from '../scripts/stream-encoded-recording.mjs';

function frame(timestamp, {key = false, width = 160, height = 90, show = true, sourceId = 'one'} = {}) {
  const data = new Uint8Array(key ? 10 : 3);
  data[0] = (key ? 0 : 1) | (show ? 0x10 : 0);
  if (key) { data.set([0x9d, 1, 0x2a], 3); data[6] = width & 255; data[7] = width >> 8; data[8] = height & 255; data[9] = height >> 8; }
  return {data: data.buffer, timestamp, type: key ? 'key' : 'delta', mimeType: 'video/VP8', sourceId};
}

test('recording options preserve first-keyframe default and isolate the experimental warmup mode', async () => {
  assert.deepEqual(encodedRecordingPlan({browser: 'firefox'}), {enabled: false, deferStart: false});
  assert.deepEqual(encodedRecordingPlan({browser: 'chrome', 'record-encoded': true}), {enabled: true, deferStart: false});
  assert.deepEqual(encodedRecordingPlan({browser: 'chrome', 'record-encoded': true, 'record-after-warmup': true}),
    {enabled: true, deferStart: true});
  assert.throws(() => encodedRecordingPlan({'record-after-warmup': true}), /requires --record-encoded/);
  for (const invalid of [{browser: 'firefox'}, {browser: 'chrome', record: true},
    {browser: 'chrome', 'profile-after-disconnect': true}])
    assert.throws(() => encodedRecordingPlan({...invalid, 'record-encoded': true}), /requires Chrome/);
  for (const options of [{}, {deferStart: true}]) {
    const context = createContext({window: {}, performance, Blob, setTimeout, clearTimeout});
    await installEncodedRecording({evaluateOnNewDocument: async source => runInContext(source, context)}, options);
    const status = context.window.__neivaEncodedRecording.status();
    assert.equal(status.deferredStart, options.deferStart === true);
    assert.equal(status.armed, options.deferStart !== true);
    assert.equal(status.frames, 0);
  }
});

test('VP8 collector starts at a keyframe and preserves RTP wrap, invisible reference frames and exact ticks', async () => {
  const c = createVp8Collector();
  c.push(frame(100));
  c.push(frame(0xfffffff0, {key: true}));
  c.push(frame(2984, {show: false}));
  c.push(frame(8984));
  c.stop();
  const parsed = parseIvf(Buffer.from(await c.getBlob().arrayBuffer()));
  assert.deepEqual(parsed.frames.map(f => f.pts), [0, 3000, 9000]);
  assert.equal(parsed.frames.length, 3);
  assert.equal(c.status().ignoredBeforeKey, 1);
  assert.equal(c.status().invisibleFrames, 1);
  assert.equal(c.status().rtpWraps, 1);
  assert.equal(c.status().rateFromRtpSpan, 20); // Includes the real 6000-tick gap.
});

test('bounds stop before exceeding bytes, RTP duration, a resolution change or another stream', () => {
  for (const [options, frames, expected] of [
    [{maxBytes: 64}, [frame(0, {key: true}), frame(3000)], 'size-limit'],
    [{maxDurationMs: 1000}, [frame(0, {key: true}), frame(90001)], 'duration-limit'],
    [{}, [frame(0, {key: true}), frame(3000, {key: true, width: 320})], 'resolution-changed'],
    [{}, [frame(0, {key: true}), frame(3000, {sourceId: 'two'})], 'stream-changed'],
  ]) {
    const c = createVp8Collector(options); frames.forEach(f => c.push(f));
    assert.equal(c.status().stopReason, expected);
    assert.equal(c.status().frames, 1);
  }
});

test('invalid clock order, codecs and malformed keyframes fail without fabricating timing', () => {
  for (const bad of [frame(99), {...frame(101), timestamp: -1},
    {...frame(101), mimeType: 'video/H264'}, {...frame(101, {key: true}), data: new Uint8Array(10).buffer}]) {
    const c = createVp8Collector(); c.push(frame(100, {key: true})); c.push(bad);
    assert.equal(c.status().stopReason, 'error'); assert.ok(c.status().error);
    assert.equal(c.status().frames, 1); assert.throws(() => c.getBlob());
  }
  assert.throws(() => createVp8Collector({maxDurationMs: 60001}));
  assert.throws(() => createVp8Collector({maxBytes: 33554433}));
});

test('repeated timestamps preserve every frame at its original instant and diagnostics distinguish backwards time', async () => {
  const c = createVp8Collector();
  c.push(frame(0xfffffff0, {key: true})); c.push(frame(0xfffffff0));
  c.push(frame(2984, {show: false})); c.push(frame(2984)); c.stop();
  const parsed = parseIvf(Buffer.from(await c.getBlob().arrayBuffer()));
  assert.deepEqual(parsed.frames.map(f => f.pts), [0, 0, 3000, 3000]);
  assert.equal(parsed.repeatedTimestamps, 2); assert.equal(c.status().rtpWraps, 1);
  assert.equal(c.status().repeatedRtpTimestamps, 2); assert.equal(c.status().backwardsRtpTimestamps, 0);
  assert.equal(c.status().distinctTimestampRateFromRtpSpan, 30);
  const backwards = createVp8Collector(); backwards.push(frame(100, {key: true})); backwards.push(frame(99));
  assert.equal(backwards.status().backwardsRtpTimestamps, 1);
  assert.deepEqual(backwards.status().timestampDiagnostics, [{kind: 'backwards', frameIndex: 1, previous: 100, current: 99, delta: -1}]);
  const page = {evaluate: async () => ({...backwards.status(), available: true})};
  await assert.rejects(finishEncodedRecording(page, '/unused'), error =>
    error.recordingStatus.backwardsRtpTimestamps === 1 && error.message === 'Backwards RTP timestamp.');
});

test('deferred recording excludes reported startup replay and starts only on a new stable keyframe', async () => {
  const c = createVp8Collector({deferStart: true});
  const replay = [frame(1000, {key: true}), ...Array.from({length: 12}, () => frame(1000)), frame(1300), frame(1200)];
  replay.forEach(value => c.push(value));
  assert.equal(c.status().error, null);
  assert.equal(c.status().frames, 0);
  assert.equal(c.status().discardedConnectionPreroll.backwardsRtpTimestamps, 1);
  assert.equal(c.status().lastTimestampDiscontinuity.delta, -100);
  assert.equal(c.status().lastTimestampDiscontinuity.stage, 'preroll');
  c.arm();
  c.push(frame(1600)); c.push(frame(1900, {key: true})); c.push(frame(2200));
  assert.equal(c.status().frames, 0); // Early keyframe is not a stable boundary.
  assert.equal(c.status().discardedConnectionPreroll.rejectedUnstableKeys, 1);
  c.push(frame(2500, {key: true})); c.push(frame(2600)); c.stop();
  const parsed = parseIvf(Buffer.from(await c.getBlob().arrayBuffer()));
  assert.deepEqual(parsed.frames.map(f => f.pts), [0, 100]);
  assert.equal(c.status().firstRtpTimestamp, 2500);
  assert.equal(c.status().discardedConnectionPreroll.frames, replay.length + 3);
  assert.equal(c.status().repeatedRtpTimestamps, 0); // Preroll counters remain separate.
});

test('wrap during warmup is distinct from reordered old packets and repeated frames cannot establish stability', () => {
  const c = createVp8Collector({deferStart: true});
  c.push(frame(0xfffffff0, {key: true}));
  c.arm();
  for (let i = 0; i < 20; i++) c.push(frame(0xfffffff0, {key: true}));
  assert.equal(c.status().frames, 0);
  assert.equal(c.status().discardedConnectionPreroll.currentForwardAdvances, 0);
  c.push(frame(30)); c.push(frame(60)); c.push(frame(90, {key: true}));
  assert.equal(c.status().discardedConnectionPreroll.rtpWraps, 1);
  assert.equal(c.status().frames, 1);
  for (let i = 0; i < 12; i++) c.push(frame(90));
  c.push(frame(0xfffffff5)); // An old pre-wrap packet is not another wrap forward.
  assert.equal(c.status().error, 'Backwards RTP timestamp.');
  assert.equal(c.status().lastTimestampDiscontinuity.stage, 'recording');
  assert.equal(c.status().lastTimestampDiscontinuity.delta, -101);
  assert.ok(c.status().timestampDiagnostics.some(entry => entry.kind === 'backwards'));
  assert.throws(() => c.getBlob());
});

test('warmup keyframe requests retry a refusal and a preroll reset without accepting the unstable keyframe', async () => {
  const collector = createVp8Collector({deferStart: true});
  let timestamp = 100000, requests = 0;
  [0, 3000, 6000, 9000].forEach(offset => collector.push(frame(timestamp + offset, {key: offset === 0})));
  timestamp += 9000;
  const context = createContext({window: {
    __neivaEncodedRecording: {status: () => ({available: true, ...collector.status()}),
      start: () => collector.arm(), stop: why => collector.stop(why)},
    pixelStreaming: {requestIframe() {
      requests++;
      if (requests === 1) return false; // Player not ready despite decoded warmup.
      if (requests === 2) timestamp -= 9000; // Connection clock resets before the requested keyframe.
      collector.push(frame(timestamp, {key: true}));
      return true;
    }},
  }});
  const page = {evaluate: async (fn, arg) => {
    context.argument = arg; return runInContext(`(${fn.toString()})(argument)`, context);
  }};
  const timer = setInterval(() => { timestamp += 3000; collector.push(frame(timestamp)); }, 20);
  try {
    const result = await startEncodedRecording(page, {timeoutMs: 3500});
    assert.deepEqual(result.keyframeRequests.map(request => request.accepted), [false, true, true]);
    assert.ok(result.frames >= 1);
    assert.equal(result.backwardsRtpTimestamps, 0);
    assert.equal(result.discardedConnectionPreroll.backwardsRtpTimestamps, 1);
    assert.equal(result.discardedConnectionPreroll.rejectedUnstableKeys, 1);
  } finally { clearInterval(timer); collector.stop(); }
});

test('a nonadvancing startup clock times out with its diagnostic status and without requesting a keyframe', async () => {
  const collector = createVp8Collector({deferStart: true});
  collector.push(frame(10, {key: true})); collector.push(frame(10));
  const context = createContext({window: {__neivaEncodedRecording: {
    status: () => ({available: true, ...collector.status()}), stop: why => collector.stop(why),
  }}});
  const page = {evaluate: async (fn, arg) => {
    context.argument = arg; return runInContext(`(${fn.toString()})(argument)`, context);
  }};
  await assert.rejects(startEncodedRecording(page, {timeoutMs: 100}), error => {
    assert.match(error.message, /No keyframe request was accepted/);
    assert.deepEqual(error.recordingStatus.keyframeRequests, []);
    assert.equal(error.recordingStatus.discardedConnectionPreroll.currentForwardAdvances, 0);
    assert.equal(error.recordingStatus.discardedConnectionPreroll.repeatedRtpTimestamps, 1);
    assert.equal(error.recordingStatus.stopReason, 'keyframe-timeout');
    return true;
  });
});

test('IVF validates frame count and truncation; export cannot delete an existing .part file', async () => {
  const c = createVp8Collector(); c.push(frame(0, {key: true})); c.stop();
  const data = Buffer.from(await c.getBlob().arrayBuffer());
  assert.throws(() => parseIvf(data.subarray(0, data.length - 1)));
  data.writeUInt32LE(2, 24); assert.throws(() => parseIvf(data));
  const output = await mkdtemp(join(tmpdir(), 'neiva-encoded-overwrite-'));
  try {
    const path = join(output, 'stream-encoded.ivf.part'); await writeFile(path, 'previous-owned-data');
    const page = {evaluate: async () => ({...c.status(), available: true})};
    await assert.rejects(finishEncodedRecording(page, output), {code: 'EEXIST'});
    assert.equal(await readFile(path, 'utf8'), 'previous-owned-data');
  } finally { await rm(output, {recursive: true, force: true}); }
});

test('real CPU VP8 fixture remux preserves every payload/PTS and still decodes', async t => {
  try { execFileSync('ffmpeg', ['-version'], {stdio: 'ignore'}); execFileSync('ffprobe', ['-version'], {stdio: 'ignore'}); }
  catch { t.skip('Installed FFmpeg/ffprobe are needed for the real remux check'); return; }
  const output = await mkdtemp(join(tmpdir(), 'neiva-encoded-remux-'));
  try {
    const fixture = join(output, 'fixture.ivf');
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=12',
      '-frames:v', '8', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-threads', '1', '-f', 'ivf', fixture]);
    const original = await readFile(fixture), payloads = [];
    let offset = 32;
    while (offset < original.length) {
      const size = original.readUInt32LE(offset), payload = original.subarray(offset + 12, offset + 12 + size);
      payloads.push(payload); offset += 12 + size;
    }
    const timelines = [Array.from({length: 8}, (_, i) => i * 7500),
      [0, 0, 7500, 7500, 15000, 22500, 22500, 30000], Array(8).fill(0)];
    for (const [caseIndex, timeline] of timelines.entries()) {
      const c = createVp8Collector();
      for (const [index, payload] of payloads.entries())
        c.push({data: Uint8Array.from(payload).buffer, timestamp: (0xfffff000 + timeline[index]) % 0x100000000,
          type: (payload[0] & 1) ? 'delta' : 'key', mimeType: 'video/VP8', sourceId: 'fixture'});
      c.stop(); const ivf = join(output, `recorded-${caseIndex}.ivf`), webm = join(output, `recorded-${caseIndex}.webm`);
      await writeFile(ivf, Buffer.from(await c.getBlob().arrayBuffer()));
      const receipt = await remuxIvf(ivf, webm);
      assert.equal(receipt.frames, 8); assert.equal(receipt.payloadHashesVerified, true);
      assert.equal(receipt.rtpSpanTicks, timeline.at(-1));
      assert.equal(receipt.repeatedTimestampsPreserved, c.status().repeatedRtpTimestamps);
      const decoded = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries',
        'stream=nb_read_frames', '-of', 'json', webm], {encoding: 'utf8'}));
      assert.equal(Number(decoded.streams[0].nb_read_frames), 8);
      await assert.rejects(remuxIvf(ivf, webm), /overwrite/);
    }
    // An independently decodable new keyframe begins after deliberately bad
    // connection replay; the recording keeps ALL eight real fixture payloads.
    const warm = createVp8Collector({deferStart: true});
    [frame(500, {key: true}), frame(500), frame(450), frame(600), frame(700), frame(800)]
      .forEach(value => warm.push(value));
    warm.arm();
    for (const [index, payload] of payloads.entries())
      warm.push({data: Uint8Array.from(payload).buffer, timestamp: 1000 + index * 7500,
        type: (payload[0] & 1) ? 'delta' : 'key', mimeType: 'video/VP8', sourceId: 'one'});
    warm.stop();
    const ivf = join(output, 'post-warmup.ivf'), webm = join(output, 'post-warmup.webm');
    await writeFile(ivf, Buffer.from(await warm.getBlob().arrayBuffer()));
    const receipt = await remuxIvf(ivf, webm);
    assert.equal(receipt.frames, 8); assert.equal(receipt.payloadHashesVerified, true);
    assert.equal(warm.status().discardedConnectionPreroll.frames, 6);
    const decoded = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries',
      'stream=nb_read_frames', '-of', 'json', webm], {encoding: 'utf8'}));
    assert.equal(Number(decoded.streams[0].nb_read_frames), 8);
  } finally { await rm(output, {recursive: true, force: true}); }
});
