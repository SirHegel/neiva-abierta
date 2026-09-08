import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createVp8Collector, parseIvf, remuxIvf, finishEncodedRecording} from '../scripts/stream-encoded-recording.mjs';

function frame(timestamp, {key = false, width = 160, height = 90, show = true, sourceId = 'one'} = {}) {
  const data = new Uint8Array(key ? 10 : 3);
  data[0] = (key ? 0 : 1) | (show ? 0x10 : 0);
  if (key) { data.set([0x9d, 1, 0x2a], 3); data[6] = width & 255; data[7] = width >> 8; data[8] = height & 255; data[9] = height >> 8; }
  return {data: data.buffer, timestamp, type: key ? 'key' : 'delta', mimeType: 'video/VP8', sourceId};
}

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
  } finally { await rm(output, {recursive: true, force: true}); }
});
