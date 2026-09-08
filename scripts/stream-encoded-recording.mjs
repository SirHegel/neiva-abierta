// Original recorder: MIT. VP8 frames are copied after RTP depacketization,
// before decoding. No MediaRecorder, encoder, desktop capture or rescaling.
// Wire formats: RFC 6386 §9.1, RFC 7741; FFmpeg libavformat/{ivfenc,ivfdec}.c.
import {open, readFile, link, unlink, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const runFile = promisify(execFile);
export const ENCODED_LIMIT_BYTES = 32 * 1024 * 1024;

// Self-contained so the identical collector runs in the page and CPU tests.
export function createVp8Collector({maxBytes = 32 * 1024 * 1024, maxDurationMs = 60000,
  deferStart = false, stableRtpAdvances = 3} = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes < 64 || maxBytes > 32 * 1024 * 1024 ||
      !Number.isInteger(maxDurationMs) || maxDurationMs < 1 || maxDurationMs > 60000 ||
      typeof deferStart !== 'boolean' || !Number.isInteger(stableRtpAdvances) || stableRtpAdvances < 1 || stableRtpAdvances > 120)
    throw Error('Encoded recording requires 64..33554432 bytes and 1..60000 ms.');
  const frames = [];
  let bytes = 32, width = 0, height = 0, firstRtp = null, lastRtp = null, ticks = 0;
  let wraps = 0, source = null, startedAt = null, endedAt = null, reason = null, error = null;
  let ignoredBeforeKey = 0, invisibleFrames = 0, timer = null, blob = null;
  let repeatedRtpTimestamps = 0, backwardsRtpTimestamps = 0;
  let armed = !deferStart, armedAt = null, firstObservedAt = null;
  let prerollFrames = 0, prerollKeys = 0, prerollRepeats = 0, prerollBackwards = 0, prerollWraps = 0;
  let probeRtp = null, probeSource = null, forwardAdvances = 0, rejectedUnstableKeys = 0;
  let lastTimestampDiscontinuity = null;
  const timestampDiagnostics = [];
  const prerollTimestampDiagnostics = [];
  function noteTimestamp(kind, previous, current, delta) {
    const preroll = firstRtp === null && deferStart;
    const entry = {kind, frameIndex: preroll ? prerollFrames : frames.length, previous, current, delta};
    const entries = preroll ? prerollTimestampDiagnostics : timestampDiagnostics;
    if (kind !== 'repeated') lastTimestampDiscontinuity = {...entry, stage: preroll ? 'preroll' : 'recording'};
    if (entries.length < 8) entries.push(entry);
    else if (kind !== 'repeated') {
      // A burst of repeated timestamps must not hide the actual discontinuity.
      const repeatedIndex = entries.findIndex(item => item.kind === 'repeated');
      entries.splice(repeatedIndex < 0 ? 0 : repeatedIndex, 1); entries.push(entry);
    }
  }
  function arm() {
    if (!reason && !armed) { armed = true; armedAt = performance.now(); }
    return status();
  }
  function stop(why = 'observation-ended') {
    if (!reason) { reason = why; endedAt = performance.now(); clearTimeout(timer); }
    return status();
  }
  function fail(message) { error ||= message; stop('error'); }
  function status() {
    return {codec: 'VP8', width, height, frames: frames.length, invisibleFrames,
      bytes, maxBytes, maxDurationMs, firstRtpTimestamp: firstRtp, lastRtpTimestamp: lastRtp,
      rtpClockRate: 90000, rtpWraps: wraps, rtpSpanTicks: ticks, rtpSpanMs: ticks / 90,
      rateFromRtpSpan: ticks > 0 ? (frames.length - 1) * 90000 / ticks : null,
      repeatedRtpTimestamps, backwardsRtpTimestamps, timestampDiagnostics,
      lastTimestampDiscontinuity, deferredStart: deferStart, armed,
      waitingForKeyframe: armed && firstRtp === null && !reason,
      startAfterWarmup: deferStart, firstFramePerformanceMs: startedAt, armedPerformanceMs: armedAt,
      discardedConnectionPreroll: {frames: prerollFrames, keyframes: prerollKeys,
        repeatedRtpTimestamps: prerollRepeats, backwardsRtpTimestamps: prerollBackwards,
        rtpWraps: prerollWraps,
        timestampDiagnostics: prerollTimestampDiagnostics, rejectedUnstableKeys,
        requiredForwardAdvances: stableRtpAdvances, currentForwardAdvances: forwardAdvances,
        durationMs: firstObservedAt === null ? 0 : (startedAt ?? endedAt ?? performance.now()) - firstObservedAt},
      distinctRtpTimestamps: frames.length - repeatedRtpTimestamps,
      distinctTimestampRateFromRtpSpan: ticks > 0 ? (frames.length - repeatedRtpTimestamps - 1) * 90000 / ticks : null,
      observedWallMs: startedAt === null ? 0 : (endedAt ?? performance.now()) - startedAt,
      ignoredBeforeKey, stopped: reason !== null, stopReason: reason, error};
  }
  function push({data, timestamp, sourceId, mimeType, type}) {
    if (reason) return;
    if (mimeType?.toLowerCase() !== 'video/vp8') return fail('Incoming encoded video is not verified VP8.');
    if (!(data instanceof ArrayBuffer) || data.byteLength < 3) return fail('Incomplete VP8 frame.');
    const view = new Uint8Array(data), key = (view[0] & 1) === 0;
    if (type && type !== (key ? 'key' : 'delta')) return fail('VP8 frame type disagrees with its payload.');
    if (!Number.isInteger(timestamp) || timestamp < 0 || timestamp > 0xffffffff)
      return fail('Missing unsigned 32-bit RTP timestamp; metadata.timestamp is not RTP time.');
    let keyWidth = width, keyHeight = height;
    if (key) {
      if (view.length < 10 || view[3] !== 0x9d || view[4] !== 1 || view[5] !== 0x2a)
        return fail('Invalid VP8 keyframe start code.');
      keyWidth = (view[6] | (view[7] << 8)) & 0x3fff;
      keyHeight = (view[8] | (view[9] << 8)) & 0x3fff;
      if (!keyWidth || !keyHeight) return fail('Invalid VP8 frame dimensions.');
    }
    if (firstRtp === null && deferStart) {
      firstObservedAt ??= performance.now();
      if (probeSource !== sourceId) { probeRtp = null; forwardAdvances = 0; probeSource = sourceId; }
      if (probeRtp !== null) {
        const delta = (timestamp - probeRtp + 0x100000000) % 0x100000000;
        if (delta >= 0x80000000) {
          prerollBackwards++; forwardAdvances = 0;
          noteTimestamp('backwards', probeRtp, timestamp, delta - 0x100000000);
        } else if (delta === 0) {
          prerollRepeats++; noteTimestamp('repeated', probeRtp, timestamp, 0);
        } else { forwardAdvances++; prerollWraps += Number(timestamp < probeRtp); }
      }
      probeRtp = timestamp;
      // The caller arms only after decoded-video warmup. A subsequent keyframe
      // starts an independent recording; discarded connection replay is counted
      // explicitly and is never presented as part of the captured observation.
      if (!armed || !key || forwardAdvances < stableRtpAdvances) {
        prerollFrames++; prerollKeys += Number(key);
        if (armed && key && forwardAdvances < stableRtpAdvances) rejectedUnstableKeys++;
        if (armed && !key) ignoredBeforeKey++;
        return;
      }
    }
    if (firstRtp === null && !key) { ignoredBeforeKey++; return; }
    if (firstRtp !== null && sourceId !== source) return stop('stream-changed');
    if (firstRtp !== null && key && (keyWidth !== width || keyHeight !== height))
      return stop('resolution-changed');
    let nextTicks = 0, didWrap = false, repeated = false;
    if (lastRtp !== null) {
      // Modulo subtraction handles a random initial RTP offset crossing 2^32.
      // VP8 decode order is retained. Never sort, duplicate or invent timestamps.
      const delta = (timestamp - lastRtp + 0x100000000) % 0x100000000;
      if (delta >= 0x80000000) {
        backwardsRtpTimestamps++;
        noteTimestamp('backwards', lastRtp, timestamp, delta - 0x100000000);
        return fail('Backwards RTP timestamp.');
      }
      // A repeated sampling instant is not a backwards clock. Keep every
      // received payload at that SAME instant, including invisible references.
      // Matroska/WebM accepts nondecreasing PTS; verify that remux preserves it.
      repeated = delta === 0;
      nextTicks = ticks + delta; didWrap = timestamp < lastRtp;
      if (nextTicks > maxDurationMs * 90 || performance.now() - startedAt >= maxDurationMs)
        return stop('duration-limit');
    }
    if (bytes + 12 + view.length > maxBytes) return stop('size-limit');
    if (frames.length >= 12000) return stop('frame-limit');
    if (firstRtp === null) {
      firstRtp = timestamp; source = sourceId; width = keyWidth; height = keyHeight;
      startedAt = performance.now(); timer = setTimeout(() => stop('duration-limit'), maxDurationMs);
    }
    if (repeated) {
      repeatedRtpTimestamps++;
      noteTimestamp('repeated', lastRtp, timestamp, 0);
    }
    frames.push({bytes: view.slice(), ticks: nextTicks});
    bytes += 12 + view.length; ticks = nextTicks; lastRtp = timestamp;
    wraps += Number(didWrap); invisibleFrames += Number(!(view[0] & 0x10));
  }
  function getBlob() {
    if (!reason) throw Error('Stop the encoded recorder before exporting it.');
    if (error || !frames.length) throw Error(error || 'No complete VP8 keyframe was captured.');
    if (!blob) {
      const header = new Uint8Array(32), h = new DataView(header.buffer);
      header.set([68, 75, 73, 70]); h.setUint16(6, 32, true); header.set([86, 80, 56, 48], 8);
      h.setUint16(12, width, true); h.setUint16(14, height, true);
      h.setUint32(16, 90000, true); h.setUint32(20, 1, true); h.setUint32(24, frames.length, true);
      const parts = [header];
      for (const frame of frames) {
        const entry = new Uint8Array(12), v = new DataView(entry.buffer);
        v.setUint32(0, frame.bytes.length, true); v.setBigUint64(4, BigInt(frame.ticks), true);
        parts.push(entry, frame.bytes);
      }
      blob = new Blob(parts, {type: 'video/x-ivf'});
    }
    return blob;
  }
  return {push, arm, stop, fail, status, getBlob, isStopped: () => reason !== null};
}

// Inject before the local player's JavaScript creates its first peer. Both
// receiver audio and outgoing senders remain passthrough; recording is video-only.
export function installRecorderInPage(factory, options) {
  const name = '__neivaEncodedRecording';
  if (window[name]) return;
  const collector = factory(options), senders = new WeakSet(), receivers = new WeakSet();
  const NativePeer = window.RTCPeerConnection;
  const available = typeof NativePeer === 'function' && typeof TransformStream === 'function' &&
    typeof window.RTCRtpReceiver?.prototype.createEncodedStreams === 'function' &&
    typeof window.RTCRtpSender?.prototype.createEncodedStreams === 'function';
  let receiverNumber = 0, videoPipes = 0, forwardedFrames = 0;
  window[name] = {
    status: () => ({available, videoPipes, forwardedFrames, ...collector.status()}),
    start: () => { collector.arm(); return window[name].status(); },
    stop: why => { collector.stop(why); return window[name].status(); },
    readChunk: async (offset, length) => {
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 1 || length > 262144)
        throw Error('Invalid bounded encoded-recording read.');
      const chunk = new Uint8Array(await collector.getBlob().slice(offset, offset + length).arrayBuffer());
      let text = '';
      for (let i = 0; i < chunk.length; i += 8192) text += String.fromCharCode(...chunk.subarray(i, i + 8192));
      return btoa(text);
    },
  };
  if (!available) { collector.fail('Chrome createEncodedStreams API unavailable; no re-encode fallback.'); return; }
  function passSender(sender) {
    if (!sender || senders.has(sender)) return;
    senders.add(sender);
    try {
      const streams = sender.createEncodedStreams();
      streams.readable.pipeTo(streams.writable).catch(() => collector.stop('sender-pipe-ended'));
    } catch { collector.fail('Cannot install outgoing media passthrough.'); }
  }
  function receive(receiver) {
    if (!receiver || receivers.has(receiver)) return;
    receivers.add(receiver); const id = ++receiverNumber;
    try {
      const streams = receiver.createEncodedStreams();
      const video = receiver.track?.kind === 'video';
      let payloadType = null, mimeType = null;
      if (video) videoPipes++;
      const transform = new TransformStream({transform(frame, controller) {
        try {
          if (video && !collector.isStopped()) {
            const metadata = frame.getMetadata();
            if (payloadType !== metadata.payloadType || !mimeType) {
              payloadType = metadata.payloadType;
              mimeType = metadata.mimeType ?? receiver.getParameters().codecs?.find(c => c.payloadType === payloadType)?.mimeType;
            }
            collector.push({data: frame.data, type: frame.type,
              // Current metadata.rtpTimestamp and legacy frame.timestamp are
              // RTP ticks; metadata.timestamp is presentation MICROSECONDS.
              timestamp: metadata.rtpTimestamp ?? frame.timestamp,
              sourceId: `${id}/${metadata.synchronizationSource ?? 'one'}`,
              mimeType});
          }
        } catch { collector.fail('Encoded video capture failed; media passthrough remains active.'); }
        finally { if (video) forwardedFrames++; controller.enqueue(frame); }
      }});
      streams.readable.pipeThrough(transform).pipeTo(streams.writable)
        .then(() => { if (video) collector.stop('stream-ended'); })
        .catch(() => { if (video) collector.stop('receiver-pipe-ended'); });
    } catch { collector.fail('Cannot install incoming encoded-media passthrough.'); }
  }
  class RecordingPeer extends NativePeer {
    constructor(configuration, ...rest) {
      super({...configuration, encodedInsertableStreams: true}, ...rest);
      this.addEventListener('track', event => receive(event.receiver));
    }
    addTrack(...args) { const sender = super.addTrack(...args); passSender(sender); return sender; }
    addTransceiver(...args) { const transceiver = super.addTransceiver(...args); passSender(transceiver.sender); return transceiver; }
  }
  window.RTCPeerConnection = RecordingPeer;
  if (window.webkitRTCPeerConnection === NativePeer) window.webkitRTCPeerConnection = RecordingPeer;
}

export async function installEncodedRecording(page, options = {}) {
  const deferred = {deferStart: true, ...options};
  // Validate without keeping a timer or any frame buffers in Node.
  createVp8Collector(deferred);
  return page.evaluateOnNewDocument(`(${installRecorderInPage.toString()})(${createVp8Collector.toString()},${JSON.stringify(deferred)});`);
}

// Call after decoded-video warmup and before any action that must be recorded.
// Epic UE5.5 PixelStreaming.requestIframe() sends IFrameRequest, handled by
// FStreamer::ForceKeyFrame; this is transport control, not game/desktop input.
export async function startEncodedRecording(page, {timeoutMs = 8000} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 15000)
    throw Error('Keyframe wait must be 100..15000 ms.');
  const requestedAtUtc = new Date().toISOString(), started = performance.now(), requests = [];
  let lastRequestMs = -Infinity, status;
  try {
    // Duplicates alone do not demonstrate an advancing RTP clock. Wait for
    // three genuine advances after the last discontinuity before requesting
    // the new keyframe, so a premature request cannot strand the recorder.
    while (performance.now() - started < timeoutMs) {
      const elapsedMs = performance.now() - started;
      const result = await page.evaluate(canRequest => {
        const recorder = window.__neivaEncodedRecording;
        if (!recorder || !recorder.status().available) throw Error('Encoded recorder is not available.');
        const current = recorder.status();
        if (current.frames || current.stopped) return {status: current};
        const stable = current.discardedConnectionPreroll.currentForwardAdvances >=
          current.discardedConnectionPreroll.requiredForwardAdvances;
        if (!canRequest || !stable) return {status: current};
        if (typeof window.pixelStreaming?.requestIframe !== 'function')
          throw Error('This player does not expose the verified Epic keyframe request API.');
        recorder.start();
        return {status: recorder.status(), requestAccepted: window.pixelStreaming.requestIframe() === true};
      }, requests.length < 3 && elapsedMs - lastRequestMs >= 1000);
      status = result.status;
      if ('requestAccepted' in result) {
        lastRequestMs = elapsedMs;
        requests.push({elapsedMs: Math.round(elapsedMs), accepted: result.requestAccepted});
      }
      if (status.error || status.stopped) throw Error(status.error || 'Encoded recording stopped before a stable keyframe.');
      if (status.frames) break;
      // A keyframe can be refused during peer initialization or rejected after
      // a subsequent preroll clock reset. Retry at most twice after RTP becomes
      // stable again; no request alters payload order or recorded timestamps.
      await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(1, timeoutMs - (performance.now() - started)))));
    }
    if (!status?.frames) throw Error(requests.some(request => request.accepted)
      ? 'No stable VP8 keyframe arrived after decoded-video warmup.'
      : 'No keyframe request was accepted with a stable RTP clock after decoded-video warmup.');
  } catch (cause) {
    const stopped = await page.evaluate(() => window.__neivaEncodedRecording?.stop('keyframe-timeout')).catch(() => status);
    const error = Error(cause.message, {cause});
    error.recordingStatus = {...stopped, keyframeRequests: requests}; throw error;
  }
  status = await page.evaluate(() => window.__neivaEncodedRecording.status());
  if (status.error || !status.frames) {
    const error = Error(status.error || 'Encoded recording stopped before a stable keyframe.');
    error.recordingStatus = status; throw error;
  }
  return {...status, keyframeRequested: requests.some(request => request.accepted), keyframeRequests: requests, requestedAtUtc,
    note: 'Capture starts at the first accepted keyframe after warmup; connection preroll is excluded and counted.'};
}

export function parseIvf(data) {
  if (!Buffer.isBuffer(data) || data.length < 32 || data.length > ENCODED_LIMIT_BYTES ||
      data.toString('ascii', 0, 4) !== 'DKIF' || data.readUInt16LE(4) !== 0 ||
      data.readUInt16LE(6) !== 32 || data.toString('ascii', 8, 12) !== 'VP80' ||
      data.readUInt32LE(16) !== 90000 || data.readUInt32LE(20) !== 1)
    throw Error('Expected bounded VP8 IVF with an exact 90 kHz timebase.');
  const width = data.readUInt16LE(12), height = data.readUInt16LE(14), frames = [];
  if (!width || !height) throw Error('Invalid IVF dimensions.');
  let offset = 32, last = -1;
  while (offset < data.length) {
    if (offset + 12 > data.length || frames.length >= 12000) throw Error('Truncated or excessive IVF frames.');
    const size = data.readUInt32LE(offset), pts = Number(data.readBigUInt64LE(offset + 4));
    offset += 12;
    if (size < 3 || offset + size > data.length || !Number.isSafeInteger(pts) ||
        pts < last || pts > 5400000 || (!frames.length && pts !== 0)) throw Error('Invalid IVF frame or timestamp.');
    const payload = data.subarray(offset, offset + size), key = !(payload[0] & 1);
    if ((!frames.length && !key) || (key && (size < 10 || payload[3] !== 0x9d || payload[4] !== 1 ||
        payload[5] !== 0x2a || (payload.readUInt16LE(6) & 0x3fff) !== width ||
        (payload.readUInt16LE(8) & 0x3fff) !== height))) throw Error('Invalid or changed VP8 keyframe.');
    frames.push({size, pts, key, sha256: createHash('sha256').update(payload).digest('hex')});
    offset += size; last = pts;
  }
  if (!frames.length || frames.length !== data.readUInt32LE(24)) throw Error('IVF frame count mismatch.');
  return {width, height, frames, rtpSpanTicks: last,
    repeatedTimestamps: frames.filter((frame, i) => i > 0 && frame.pts === frames[i - 1].pts).length};
}

export async function remuxIvf(ivfPath, webmPath, {ffmpeg = 'ffmpeg', ffprobe = 'ffprobe'} = {}) {
  const parsed = parseIvf(await readFile(ivfPath));
  try { await stat(webmPath); throw Error('Refusing to overwrite an existing recording.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-n', '-i', ivfPath,
    '-map', '0:v:0', '-c:v', 'copy', '-copytb', '1', '-an', '-f', 'webm', webmPath];
  await runFile(ffmpeg, args, {timeout: 60000, maxBuffer: 1024 * 1024});
  const {stdout} = await runFile(ffprobe, ['-v', 'error', '-select_streams', 'v:0',
    '-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'packet=pts_time,size,data_hash',
    '-of', 'json', webmPath], {timeout: 30000, maxBuffer: 8 * 1024 * 1024});
  const packets = JSON.parse(stdout).packets;
  if (!Array.isArray(packets) || packets.length !== parsed.frames.length)
    throw Error('Remux changed the number of encoded frames.');
  for (let i = 0; i < packets.length; i++) {
    const packet = packets[i], frame = parsed.frames[i], pts = Number(packet.pts_time);
    if (Number(packet.size) !== frame.size || packet.data_hash?.toLowerCase() !== `sha256:${frame.sha256}` ||
        !Number.isFinite(pts) || Math.abs(pts - frame.pts / 90000) > .00101)
      throw Error('Remux changed encoded payloads, their order or RTP timing.');
    if (i > 0 && (pts < Number(packets[i - 1].pts_time) ||
        (frame.pts === parsed.frames[i - 1].pts && pts !== Number(packets[i - 1].pts_time))))
      throw Error('Remux changed repeated timestamps or made them go backwards.');
  }
  return {codecCopy: true, frames: parsed.frames.length, payloadHashesVerified: true,
    repeatedTimestampsPreserved: parsed.repeatedTimestamps, nondecreasingTimestampsVerified: true,
    timestampsVerified: true, webmTimestampToleranceMs: 1.01,
    width: parsed.width, height: parsed.height, rtpSpanTicks: parsed.rtpSpanTicks,
    arguments: args, note: 'IVF retains exact RTP ticks; WebM timestamps are quantized to milliseconds.'};
}

export async function finishEncodedRecording(page, outputDirectory, {stem = 'stream-encoded', ...remuxOptions} = {}) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(stem)) throw Error('Invalid recording filename stem.');
  const completed = await page.evaluate(() => {
    if (!window.__neivaEncodedRecording) throw Error('Install the encoded recorder before page.goto.');
    return window.__neivaEncodedRecording.stop('observation-ended');
  });
  if (!completed.available || completed.error || !completed.frames || completed.bytes > ENCODED_LIMIT_BYTES) {
    const error = Error(completed.error || 'No bounded, complete VP8 recording was captured.');
    error.recordingStatus = completed;
    throw error;
  }
  const ivfPath = join(outputDirectory, `${stem}.ivf`), temporary = ivfPath + '.part';
  let file, ownsTemporary = false;
  try {
    file = await open(temporary, 'wx', 0o600);
    ownsTemporary = true;
    for (let offset = 0; offset < completed.bytes; offset += 262144) {
      const size = Math.min(262144, completed.bytes - offset);
      const encoded = await page.evaluate((offset, size) =>
        window.__neivaEncodedRecording.readChunk(offset, size), offset, size);
      const data = Buffer.from(encoded, 'base64');
      if (data.length !== size) throw Error('Incomplete encoded recording fragment.');
      await file.writeFile(data);
    }
    await file.close(); file = null;
    parseIvf(await readFile(temporary));
    // Hard-link publication fails if the final name exists; never overwrite it.
    await link(temporary, ivfPath);
  } finally { if (file) await file.close(); if (ownsTemporary) await unlink(temporary).catch(() => {}); }
  const webmPath = join(outputDirectory, `${stem}.webm`);
  const remux = await remuxIvf(ivfPath, webmPath, remuxOptions);
  const [ivf, webm] = await Promise.all([readFile(ivfPath), readFile(webmPath)]);
  if (webm.length > ENCODED_LIMIT_BYTES) throw Error('WebM recording exceeds the 32 MiB bound.');
  return {...completed, path: webmPath, ivfPath, bytes: webm.length, ivfBytes: ivf.length,
    sha256: createHash('sha256').update(webm).digest('hex'),
    ivfSha256: createHash('sha256').update(ivf).digest('hex'), remux,
    source: 'Incoming VP8 encoded frames after RTP depacketization; video only, no re-encode/rescale/frame duplication.',
    includesConnectionPreroll: !completed.deferredStart,
    coveredObservation: completed.stopReason === 'observation-ended' && completed.frames > 0};
}
