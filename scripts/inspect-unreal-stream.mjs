#!/usr/bin/env node
// Observe Epic's local player in an owned headless browser. Never attaches to a
// personal browser or sends desktop input. Video evidence is not city fidelity.
import puppeteer from 'puppeteer-core';
import {mkdir, mkdtemp, writeFile, rm, open, rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {findFirefox, isolatedEnvironment} from './isolated-firefox.mjs';
import {decodedBetween, inputReadiness} from './stream-progress.mjs';
import {nativeControlsPlan, validateInteractionModes} from './stream-controls.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const {values} = parseArgs({options: {
  url: {type: 'string', default: 'http://127.0.0.1:8080/'},
  seconds: {type: 'string', default: '10'},
  timeout: {type: 'string', default: '90'},
  exercise: {type: 'boolean', default: false},
  drive: {type: 'boolean', default: false},
  controls: {type: 'boolean', default: false},
  fixture: {type: 'boolean', default: false},
  record: {type: 'boolean', default: false},
  browser: {type: 'string', default: 'firefox'},
  'native-state': {type: 'boolean', default: false},
}});
if (!['firefox', 'chrome'].includes(values.browser)) throw Error('browser must be firefox or chrome.');
if (values['native-state'] && values.fixture) throw Error('--native-state requires the native game, not a fixture.');
const address = new URL(values.url);
if (address.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname)
    || address.username || address.password)
  throw Error('Use the local HTTP player without credentials.');
const seconds = Number(values.seconds), timeout = Number(values.timeout);
if (!Number.isInteger(seconds) || seconds < 3 || seconds > 60 ||
    !Number.isInteger(timeout) || timeout < 5 || timeout > 300)
  throw Error('seconds must be 3–60; timeout must be 5–300.');
validateInteractionModes({...values, seconds});
for (const flag of ['AutoConnect', 'AutoPlayVideo', 'StartVideoMuted']) address.searchParams.set(flag, 'true');
// Epic's locked mouse mode needs a click to acquire pointer lock. This explicit
// route audits free mouse movement with no button held using its hovering mode.
if (values.controls) address.searchParams.set('HoveringMouse', 'true');
for (const [key, value] of Object.entries({WaitForStreamer: 'true',
  MaxReconnectAttempts: String(timeout), StreamerAutoJoinInterval: '1000'}))
  if (!address.searchParams.has(key)) address.searchParams.set(key, value);
const artifacts = join(repo, 'artifacts/unreal-native/stream-observations');
await mkdir(artifacts, {recursive: true});
const output = await mkdtemp(join(artifacts, 'observation-'));
const profile = await mkdtemp(join(tmpdir(), 'neiva-stream-observer-'));
const abort = new AbortController();
const launchAbort = new AbortController();
let browser, page, recordingStarted = false;
const heldKeys = new Set();
const browserMessages = [];
const recordingLimitBytes = 32 * 1024 * 1024;
const stop = () => { abort.abort(); if (!browser) launchAbort.abort(); };
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, stop);
const report = {schema: 1, observedAtUtc: new Date().toISOString(), videoVerified: false,
  physicalInput: false, headless: true, engineIdentityVerified: false,
  evidenceKind: values.fixture ? 'local-webrtc-fixture' : 'local-webrtc-observation',
  note: values.fixture ? 'LOCAL FIXTURE VIDEO ONLY. This is not Unreal Engine or native gameplay evidence.' :
    'This observes decoded WebRTC video. Native process identity and gameplay outcomes require separate verification.',
  samples: [], inputSent: [], inputEvents: [], gameplayVerified: false,
  ...(values.controls ? {controlsVerified: false,
    controlsAssumption: 'Operator-selected fresh native game at mapped spawn, control yaw 20 degrees and console closed; not verified by this observer.',
    controlsMouseModeRequested: 'HoveringMouse'} : {}),
  ...(values.drive ? {driveAssumption: 'Operator-selected fresh game at mapped spawn and control yaw 20 degrees; not verified by this observer.'} : {})};

async function keyDown(key) {
  abort.signal.throwIfAborted();
  heldKeys.add(key); // retain it for cleanup even if the transport rejects after delivery
  await page.keyboard.down(key);
  report.inputEvents.push({type: 'keydown', key, atUtc: new Date().toISOString()});
}

async function keyUp(key) {
  await page.keyboard.up(key);
  heldKeys.delete(key);
  report.inputEvents.push({type: 'keyup', key, atUtc: new Date().toISOString()});
}

async function holdKeys(keys, milliseconds, label) {
  try {
    for (const key of keys) await keyDown(key);
    await delay(milliseconds, undefined, {signal: abort.signal});
  } finally {
    let failure;
    for (const key of [...keys].reverse()) {
      if (!heldKeys.has(key)) continue;
      try { await keyUp(key); } catch (error) { failure ||= error; }
    }
    if (failure) throw failure;
  }
  report.inputSent.push(label);
}

async function queryNativeState(name) {
  // The operator must start with the UE console closed. Its single-line mode
  // closes after this one command; never type a second command into gameplay.
  const query = {name, requestedAtUtc: new Date().toISOString(), commandSent: false,
    nativeStateVerified: false, screenshot: `${name}.png`};
  (report.nativeStateQueries ||= []).push(query);
  await holdKeys(['Backquote'], 60, 'Console:open');
  await delay(250, undefined, {signal: abort.signal});
  for (const key of 'NeivaState') await holdKeys([key], 45, `Console:key:${key}`);
  await holdKeys(['Enter'], 60, 'Console:execute-NeivaState');
  query.commandSent = true;
  query.executedAtUtc = new Date().toISOString();
  await delay(300, undefined, {signal: abort.signal});
  report.nativeStateCommandSent = true;
  report.nativeStateVerified = false; // correlate each query with the native log
  await page.screenshot({path: join(output, query.screenshot)});
}

async function deadline(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Owned browser operation timed out.')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function captureFailureDiagnostics() {
  // Save only our local player's state. Candidate addresses stay in a private
  // artifact; never copy SDP credentials, cookies, URLs or browser profiles.
  if (!page || page.isClosed() || new URL(page.url()).origin !== address.origin) return;
  try {
    const state = await deadline(page.evaluate(async () => {
      const controller = window.pixelStreaming?.webRtcController;
      const peer = controller?.peerConnectionController?.peerConnection;
      const video = document.querySelector('video');
      const fields = ['id', 'type', 'state', 'nominated', 'writable', 'priority',
        'address', 'ip', 'port', 'protocol', 'candidateType', 'networkType',
        'localCandidateId', 'remoteCandidateId', 'selectedCandidatePairId',
        'bytesSent', 'bytesReceived', 'packetsSent', 'packetsReceived',
        'requestsSent', 'requestsReceived', 'responsesSent', 'responsesReceived',
        'currentRoundTripTime', 'totalRoundTripTime', 'dtlsState', 'iceRole',
        'kind', 'mediaType', 'framesDecoded', 'framesDropped', 'packetsLost',
        'codecId', 'mimeType', 'payloadType'];
      const types = ['local-candidate', 'remote-candidate', 'candidate-pair',
        'transport', 'inbound-rtp', 'codec'];
      const stats = peer ? [...(await peer.getStats()).values()]
        .filter(stat => types.includes(stat.type)).slice(0, 200)
        .map(stat => Object.fromEntries(fields.filter(key => stat[key] !== undefined)
          .map(key => [key, stat[key]]))) : [];
      const candidates = description => (description?.sdp || '').split(/\r?\n/)
        .filter(line => line.startsWith('a=candidate:')).slice(0, 80)
        .map(line => line.replace(/\sufrag\s+\S+/gi, ' ufrag [redacted]'));
      return {
        playerPresent: Boolean(window.pixelStreaming),
        websocketReadyState: controller?.transport?.webSocket?.readyState ?? null,
        subscribed: Boolean(controller?.subscribedStream),
        reconnectAttempt: controller?.reconnectAttempt ?? null,
        isReconnecting: controller?.isReconnecting ?? null,
        videoCapabilities: RTCRtpReceiver.getCapabilities('video'),
        peer: peer ? {connectionState: peer.connectionState,
          iceConnectionState: peer.iceConnectionState, iceGatheringState: peer.iceGatheringState,
          signalingState: peer.signalingState,
          localCandidates: candidates(peer.localDescription),
          remoteCandidates: candidates(peer.remoteDescription)} : null,
        video: video ? {width: video.videoWidth, height: video.videoHeight,
          readyState: video.readyState, paused: video.paused, time: video.currentTime,
          hasSrcObject: Boolean(video.srcObject), tracks: video.srcObject instanceof MediaStream
            ? video.srcObject.getTracks().map(track => ({kind: track.kind,
              readyState: track.readyState, muted: track.muted, enabled: track.enabled})) : []} : null,
        stats,
      };
    }), 5000);
    const target = join(output, 'failure-state.json');
    await writeFile(target, JSON.stringify({observedAtUtc: new Date().toISOString(),
      evidenceKind: report.evidenceKind, browserMessages, ...state}, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    report.failureDiagnostics = {path: target, playerPresent: state.playerPresent,
      websocketReadyState: state.websocketReadyState,
      connectionState: state.peer?.connectionState ?? null,
      iceConnectionState: state.peer?.iceConnectionState ?? null};
  } catch { report.failureDiagnosticsError = 'Could not read local player state before cleanup.'; }
  try {
    const target = join(output, 'failure.png');
    await deadline(page.screenshot({path: target}), 5000);
    report.failureScreenshot = target;
  } catch { report.failureScreenshotError = 'Could not capture the local player before cleanup.'; }
}

async function finishRecording() {
  const completed = await deadline(page.evaluate(async () => {
    const state = window.__neivaStreamObserverRecording;
    if (!state) throw Error('Recording state unavailable.');
    if (state.recorder.state !== 'inactive') {
      state.reason ||= 'observation-ended';
      state.recorder.stop();
    }
    await state.done; // stop follows the final dataavailable event
    if (state.error) throw Error(state.error);
    if (!state.stopped || !state.blob?.size) throw Error('Recording did not complete with video data.');
    return {mime: state.blob.type, bytes: state.blob.size, durationMs: state.durationMs,
      stopReason: state.reason || 'stream-ended'};
  }), 10000);
  if (!completed.mime.startsWith('video/webm') || completed.bytes <= 0 || completed.bytes > recordingLimitBytes ||
      !Number.isFinite(completed.durationMs) || completed.durationMs <= 0 || completed.durationMs > 60000)
    throw Error('Completed recording exceeds its WebM format/size/duration contract.');
  const target = join(output, 'stream.webm'), temporary = target + '.part';
  let file;
  try {
    file = await open(temporary, 'wx', 0o600);
    const hash = createHash('sha256');
    let written = 0;
    for (let start = 0; start < completed.bytes; start += 256 * 1024) {
      const data = await deadline(page.evaluate(async (offset, length) => {
        const blob = window.__neivaStreamObserverRecording.blob.slice(offset, offset + length);
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
          reader.onerror = () => reject(Error('Could not read completed recording.'));
          reader.readAsDataURL(blob);
        });
      }, start, 256 * 1024), 10000);
      const chunk = Buffer.from(data, 'base64');
      if (chunk.length !== Math.min(256 * 1024, completed.bytes - start))
        throw Error('Incomplete recording fragment.');
      await file.writeFile(chunk); hash.update(chunk); written += chunk.length;
    }
    await file.close(); file = null;
    if (written !== completed.bytes) throw Error('Incomplete recording file.');
    await rename(temporary, target);
    report.recording = {...completed, path: target, sha256: hash.digest('hex'),
      source: 'HTMLVideoElement.srcObject MediaStream; not desktop capture',
      evidenceKind: report.evidenceKind, completedStop: true,
      coveredObservation: !report.error && completed.stopReason === 'observation-ended'};
    if (!report.error && !report.recording.coveredObservation)
      throw Error('Recording stopped before the complete observation interval.');
  } finally {
    if (file) await file.close();
    await rm(temporary, {force: true});
  }
}
try {
  const firefox = values.browser === 'firefox';
  browser = await puppeteer.launch({browser: values.browser, protocol: firefox ? 'webDriverBiDi' : 'cdp',
    executablePath: firefox ? await findFirefox() : '/opt/google/chrome/chrome', headless: true, userDataDir: profile,
    // An observation abort must leave transport alive long enough to release keys.
    env: isolatedEnvironment(), signal: launchAbort.signal, handleSIGINT: false,
    handleSIGTERM: false, handleSIGHUP: false,
    args: firefox ? ['--no-remote', '--new-instance'] : ['--no-first-run', '--no-default-browser-check'],
    ...(firefox ? {extraPrefsFirefox: {'dom.ipc.processCount': 2, 'media.autoplay.default': 0,
      'network.protocol-handler.external-default': false}} : {}), timeout: 30000});
  report.browser = await browser.version();
  page = await browser.newPage();
  const noteBrowserMessage = (type, message) => {
    if (browserMessages.length >= 80) return;
    let text = String(message);
    // Do not retain an SDP or arbitrary serialized credential object in logs.
    if (/(?:a=ice-|ice-pwd|password|credential|authorization|token)/i.test(text))
      text = '[message with credential/session-description fields omitted]';
    else text = text.replace(/(?:https?|wss?):\/\/[^\s"']+/g, '[URL]')
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP]').split(/\r?\n/)[0].slice(0, 700);
    browserMessages.push({type, text, atUtc: new Date().toISOString()});
  };
  page.on('console', message => noteBrowserMessage(message.type(), message.text()));
  page.on('pageerror', error => noteBrowserMessage('pageerror', error.message));
  await page.setViewport({width: 1280, height: 720});
  await page.goto(address.href, {waitUntil: 'domcontentloaded', timeout: 30000});
  if (new URL(page.url()).origin !== address.origin)
    throw Error('The local player redirected to another origin; observation refused.');
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    const peer = window.pixelStreaming?.webRtcController?.peerConnectionController?.peerConnection;
    return video?.videoWidth > 0 && video.readyState >= 2 && peer?.connectionState === 'connected';
  }, {timeout: timeout * 1000, polling: 500, signal: abort.signal});
  const sample = () => page.evaluate(async () => {
    const video = document.querySelector('video');
    const peer = window.pixelStreaming?.webRtcController?.peerConnectionController?.peerConnection;
    const stats = await peer.getStats();
    const incoming = [...stats.values()].filter(s => s.type === 'inbound-rtp' &&
      (s.kind === 'video' || s.mediaType === 'video')).map(s => ({
        id: s.id, bytesReceived: s.bytesReceived, framesDecoded: s.framesDecoded,
        framesDropped: s.framesDropped, packetsLost: s.packetsLost,
        framesPerSecond: s.framesPerSecond, totalDecodeTime: s.totalDecodeTime,
      }));
    const quality = video.getVideoPlaybackQuality();
    return {timeMs: performance.now(), width: video.videoWidth, height: video.videoHeight,
      videoTime: video.currentTime, playbackTotalFrames: quality.totalVideoFrames,
      presentedFrames: quality.totalVideoFrames - quality.droppedVideoFrames,
      droppedFrames: quality.droppedVideoFrames, connection: peer.connectionState, incoming};
  });
  report.samples.push(await sample());
  if (values.drive || values.exercise || values.controls) {
    const baseline = report.samples[0], started = performance.now();
    const maxWaitMs = 8000;
    report.warmup = {passed: false, maxWaitMs, requiredNewFrames: 3,
      initialCounters: baseline.incoming, samples: []};
    try {
      while (performance.now() - started < maxWaitMs) {
        await delay(Math.min(200, maxWaitMs - (performance.now() - started)),
          undefined, {signal: abort.signal});
        const remaining = maxWaitMs - (performance.now() - started);
        if (remaining <= 0) break;
        const current = await deadline(sample(), remaining);
        const progress = inputReadiness(baseline, current);
        report.warmup.samples.push({elapsedMs: Math.round(performance.now() - started), ...progress});
        if (progress.ready) {
          report.warmup.passed = true;
          report.samples[0] = current; // observation/recording begin after warmup
          break;
        }
      }
    } finally { report.warmup.elapsedMs = Math.round(performance.now() - started); }
    if (!report.warmup.passed)
      throw Error('No advancing video before input: required 3 new decoded frames and new bytes within 8 seconds. No input sent.');
  }
  if (values.controls) {
    report.controlsMouseMode = await page.evaluate(() => ({
      hoveringMouse: window.pixelStreaming?.config?.isFlagEnabled('HoveringMouse') ?? null,
      pointerLocked: Boolean(document.pointerLockElement),
    }));
    if (report.controlsMouseMode.hoveringMouse !== true)
      throw Error('Native controls require Epic HoveringMouse mode. No input sent.');
  }
  if (values.record) {
    await page.evaluate((maxBytes) => {
      const stream = document.querySelector('video')?.srcObject;
      if (!(stream instanceof MediaStream) || !stream.getVideoTracks().some(track => track.readyState === 'live'))
        throw Error('The player has no live MediaStream video to record.');
      if (typeof MediaRecorder !== 'function') throw Error('MediaRecorder unavailable.');
      const codecs = stream.getAudioTracks().length ? 'vp8,opus' : 'vp8';
      const mimeType = `video/webm;codecs=${codecs}`;
      if (!MediaRecorder.isTypeSupported(mimeType)) throw Error('WebM recording unsupported.');
      const recorder = new MediaRecorder(stream, {mimeType, videoBitsPerSecond: 2000000, audioBitsPerSecond: 96000});
      const state = {recorder, chunks: [], bytes: 0, startedAt: performance.now(), stopped: false};
      window.__neivaStreamObserverRecording = state;
      state.done = new Promise(resolve => {
        recorder.onstop = () => {
          clearTimeout(state.timer); state.stopped = true;
          state.durationMs = performance.now() - state.startedAt;
          if (!state.error) state.blob = new Blob(state.chunks, {type: recorder.mimeType});
          state.chunks = []; resolve();
        };
      });
      const stop = reason => {
        state.reason ||= reason;
        if (recorder.state !== 'inactive') recorder.stop();
      };
      recorder.onerror = event => { state.error = event.error?.message || 'MediaRecorder failed.'; stop('error'); };
      recorder.ondataavailable = event => {
        if (!event.data.size || state.error) return;
        if (state.bytes + event.data.size > maxBytes) {
          state.error = 'Recording exceeded the 32 MiB limit.'; state.chunks = []; stop('size-limit'); return;
        }
        state.chunks.push(event.data); state.bytes += event.data.size;
      };
      recorder.start(500);
      // Reserve one second for the final encoder flush within the 60 s budget.
      state.timer = setTimeout(() => stop('duration-limit'), 59000);
    }, recordingLimitBytes);
    recordingStarted = true;
    report.recordingRequested = true;
  }
  await page.screenshot({path: join(output, 'before.png')});
  if (values.exercise) {
    await page.mouse.click(640, 360);
    for (const sprint of [false, true]) {
      await holdKeys(sprint ? ['Shift', 'w'] : ['w'], 1000, sprint ? 'Shift+W:1000ms' : 'W:1000ms');
    }
    await page.mouse.move(840, 390, {steps: 20});
    report.inputSent.push('mouse:200x30px');
    await holdKeys(['c'], 0, 'C');
  }
  if (values.drive) {
    // Focus an existing player focus target without moving the virtual mouse;
    // moving it first could invalidate the initial yaw used by this route.
    await page.evaluate(() => document.querySelector('video')?.closest('[tabindex]')?.focus({preventScroll: true}));
    await holdKeys(['w'], 3000, 'W:3000ms');
    await holdKeys(['e'], 0, 'E');
    await delay(600, undefined, {signal: abort.signal});
    await page.screenshot({path: join(output, 'car-enter.png')});
    await holdKeys(['w'], 1000, 'W:1000ms');
    await holdKeys([' '], 1000, 'Space:1000ms');
    await delay(400, undefined, {signal: abort.signal});
    await page.screenshot({path: join(output, 'car-drive.png')});
    await holdKeys(['e'], 0, 'E');
    await delay(600, undefined, {signal: abort.signal});
    await page.screenshot({path: join(output, 'car-exit.png')});
    await holdKeys(['c'], 0, 'C');
    await holdKeys(['v'], 0, 'V');
    await holdKeys(['Shift', 'w'], 1000, 'Shift+W:1000ms');
    report.driveSequenceSent = true; // input delivery is not gameplay validation
  }
  if (values.controls) {
    await page.evaluate(() => document.querySelector('video')?.closest('[tabindex]')?.focus({preventScroll: true}));
    report.controlsPlan = nativeControlsPlan();
    for (const step of report.controlsPlan) {
      abort.signal.throwIfAborted();
      if (step.type === 'key') await holdKeys([step.key], step.milliseconds, step.label);
      else if (step.type === 'wait') await delay(step.milliseconds, undefined, {signal: abort.signal});
      else if (step.type === 'native-state') await queryNativeState(step.name);
      else if (step.type === 'mouse') {
        // No mouse.down/click call occurs anywhere in this route.
        await page.mouse.move(step.x, step.y, {steps: 10});
        report.inputEvents.push({type: 'mousemove', x: step.x, y: step.y,
          buttons: 0, name: step.name, atUtc: new Date().toISOString()});
        report.inputSent.push(`mouse:${step.name}:${step.x},${step.y}:buttons=0`);
      }
    }
    report.controlsSequenceSent = true; // screenshots/native telemetry still need review
  }
  for (let i = 0; i < seconds; ++i) {
    await delay(1000, undefined, {signal: abort.signal});
    report.samples.push(await sample());
  }
  await page.screenshot({path: join(output, 'after.png')});
  const first = report.samples[0], last = report.samples.at(-1);
  const duration = (last.timeMs - first.timeMs) / 1000;
  // Firefox can report zero VideoPlaybackQuality frames for a live MediaStream
  // while inbound-rtp framesDecoded and the captured video advance normally.
  // Use verified RTP counter deltas; do not call this Unreal render FPS.
  const decodedStreams = decodedBetween(first, last);
  report.intervals = report.samples.slice(1).map((current, index) => {
    const earlier = report.samples[index], streams = decodedBetween(earlier, current);
    return {seconds: (current.timeMs - earlier.timeMs) / 1000,
      decodedFrames: streams.reduce((sum, stream) => sum + stream.frames, 0)};
  });
  report.liveAtEnd = report.intervals.at(-1).decodedFrames > 0;
  report.receivedFrames = decodedStreams.reduce((sum, stream) => sum + stream.frames, 0);
  report.decodedFps = report.receivedFrames / duration;
  report.observedFps = report.decodedFps;
  report.fpsBasis = 'inbound-rtp framesDecoded delta / elapsed time; not native render FPS';
  report.decodedStreams = decodedStreams;
  report.playbackPresentedFrames = last.presentedFrames - first.presentedFrames;
  report.observedSeconds = duration;
  report.videoVerified = last.connection === 'connected' && last.width > 0 && last.height > 0 &&
    Number.isFinite(duration) && duration > 0 && report.receivedFrames > 0 && report.liveAtEnd;
  if (!report.videoVerified) throw Error('No currently advancing decoded WebRTC video was verified.');
  if (values['native-state']) await queryNativeState('after-native-state');
} catch (error) {
  report.error = abort.signal.aborted ? 'Observation interrupted.' :
    String(error.message).replace(/(?:https?|wss?):\/\/[^\s"']+/g, '[player URL]').slice(0, 500);
  process.exitCode = 1;
  if (!abort.signal.aborted) await captureFailureDiagnostics();
} finally {
  for (const key of [...heldKeys].reverse()) {
    try { await deadline(keyUp(key), 2000); }
    catch { (report.inputCleanupErrors ||= []).push(`Could not confirm keyup for ${key}.`); process.exitCode = 1; }
  }
  if (recordingStarted && page) {
    try { await finishRecording(); }
    catch (error) {
      report.recordingError = String(error.message).replace(/https?:\/\/[^\s"']+/g, '[player URL]').slice(0, 500);
      process.exitCode = 1;
    }
  }
  if (browser) {
    try { await deadline(browser.close(), 8000); }
    catch { browser.process()?.kill('SIGTERM'); }
    const child = browser.process();
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      try { await deadline(new Promise(resolve => child.once('exit', resolve)), 5000); } catch {}
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        try { await deadline(new Promise(resolve => child.once('exit', resolve)), 5000); } catch {}
      }
    }
  }
  const child = browser?.process();
  if (!child || child.exitCode !== null || child.signalCode !== null) await rm(profile, {recursive: true, force: true});
  else { report.cleanupError = 'Owned browser has not exited; its temporary profile was preserved.'; process.exitCode = 1; }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({output, videoVerified: report.videoVerified,
    observedFps: report.observedFps, recording: report.recording,
    error: report.error, recordingError: report.recordingError, cleanupError: report.cleanupError}));
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeListener(signal, stop);
}
