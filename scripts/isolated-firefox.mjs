#!/usr/bin/env node
/** Headless Firefox controlled only through WebDriver BiDi. JSON-lines stdin/stdout.
 * No personal profiles, desktop protocols, OS input, browser attach or global kills.
 * Usage: node scripts/isolated-firefox.mjs [--browser /path/to/firefox]
 */
import puppeteer from 'puppeteer-core';
import {access, lstat, mkdir, mkdtemp, open, realpath, rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ARTIFACTS = join(REPO, 'artifacts');
export const VIEWPORT = Object.freeze({width: 1440, height: 900});
const ACTIONS = new Set(['inspect', 'goto', 'click', 'key', 'move', 'down', 'up', 'drag', 'snapshot', 'quit']);
const KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Tab',
  'Space', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Shift', 'Control',
  'Alt', 'Meta', ...Array.from({length: 12}, (_, i) => `F${i + 1}`)]);
const sensitive = /token|session|(?:^|_)sid$|auth|api.?key|password|credential|signature|^sig$|^code$/i;

export function redactURL(value) {
  try {
    const url = new URL(value);
    url.username = ''; url.password = '';
    for (const key of [...url.searchParams.keys()]) if (sensitive.test(key)) url.searchParams.set(key, '[redacted]');
    if (sensitive.test(url.hash)) url.hash = '[redacted]';
    return url.href;
  } catch { return ''; }
}

function message(error) {
  return String(error?.message || 'Command failed').replace(/https?:\/\/[^\s<>"']+/g, redactURL).slice(0, 1000);
}

export function isolatedEnvironment(source = process.env) {
  const env = {...source, MOZ_HEADLESS: '1', MOZ_ENABLE_WAYLAND: '0'};
  for (const key of ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS',
    'DBUS_STARTER_ADDRESS', 'SESSION_MANAGER', 'DESKTOP_STARTUP_ID']) delete env[key];
  return env;
}

export async function findFirefox(explicit) {
  const candidates = explicit ? [resolve(explicit)] : [
    '/snap/firefox/current/usr/lib/firefox/firefox', '/usr/lib/firefox/firefox',
    '/usr/lib64/firefox/firefox', '/usr/bin/firefox', '/opt/firefox/firefox',
  ];
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return await realpath(candidate); } catch {}
  }
  throw new Error('Firefox executable unavailable; pass --browser /path/to/firefox. Nothing was installed.');
}

function integer(value, low, high, label) {
  if (!Number.isInteger(value) || value < low || value > high) throw new Error(`${label} must be an integer from ${low} to ${high}`);
  return value;
}
function coordinate(value, maximum, label) {
  if (!Number.isFinite(value) || value < 0 || value >= maximum) throw new Error(`${label} is outside the virtual viewport`);
  return value;
}
function point(value) {
  if (!value || typeof value !== 'object') throw new Error('Missing virtual coordinates');
  return {x: coordinate(value.x, VIEWPORT.width, 'x'), y: coordinate(value.y, VIEWPORT.height, 'y')};
}

export function snapshotPath(requested, artifacts = ARTIFACTS) {
  const root = resolve(artifacts);
  const target = requested === undefined
    ? join(root, 'isolated-browser', `capture-${Date.now()}-${randomUUID()}.png`)
    : typeof requested === 'string' && requested.length > 0 && requested.length < 1024
      ? isAbsolute(requested) ? resolve(requested) : resolve(dirname(root), requested)
      : null;
  if (!target || !target.startsWith(root + sep) || !target.toLowerCase().endsWith('.png'))
    throw new Error('Snapshot path must be a .png below artifacts/');
  return target;
}

export function validateCommand(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !ACTIONS.has(raw.action))
    throw new Error('Unknown or missing action');
  if (raw.id !== undefined && !(typeof raw.id === 'string' && raw.id.length <= 120) &&
      !(typeof raw.id === 'number' && Number.isFinite(raw.id))) throw new Error('Invalid command id');
  const command = {action: raw.action, ...(raw.id === undefined ? {} : {id: raw.id})};
  if (raw.action === 'goto') {
    let url;
    try { url = new URL(raw.url); } catch { throw new Error('goto requires a valid HTTP or HTTPS URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('goto accepts HTTP/HTTPS without embedded credentials');
    command.url = url.href;
  }
  if (['click', 'move'].includes(raw.action)) Object.assign(command, point(raw));
  if (raw.action === 'move') command.steps = integer(raw.steps ?? 1, 1, 60, 'steps');
  if (raw.action === 'key') {
    if (typeof raw.key !== 'string' || !(KEYS.has(raw.key) || [...raw.key].length === 1) || /[\r\n\0]/.test(raw.key))
      throw new Error('Unsupported virtual key');
    command.key = raw.key;
    command.durationMs = integer(raw.durationMs ?? 0, 0, 1500, 'durationMs');
  }
  if (raw.action === 'drag') {
    command.from = point(raw.from); command.to = point(raw.to);
    command.steps = integer(raw.steps ?? 12, 1, 60, 'steps');
    command.durationMs = integer(raw.durationMs ?? 300, 0, 1500, 'durationMs');
  }
  if (raw.action === 'snapshot') command.path = snapshotPath(raw.path);
  return command;
}

async function reserveSnapshot(target) {
  // Refuse symlink ancestors before mkdir/open. Exclusive creation also rejects
  // an existing file or final symlink; no previous screenshot can be overwritten.
  const relativePath = relative(ARTIFACTS, target);
  let current = ARTIFACTS;
  for (const component of ['', ...relativePath.split(sep).slice(0, -1)]) {
    if (component) current = join(current, component);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Snapshot ancestors must be real directories');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(current, {mode: 0o700});
    }
  }
  return open(target, 'wx', 0o600);
}

async function deadline(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Owned Firefox did not close in time')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export async function run({executablePath, input = process.stdin, output = process.stdout} = {}) {
  let browser, reader, ownedProfile, mouseDown = false, stopped = false, stopSignal, outputBroken = false;
  const abort = new AbortController();
  const emit = value => { if (!outputBroken) output.write(JSON.stringify(value) + '\n'); };
  const stop = signal => {
    stopped = true; stopSignal = signal; abort.abort(); reader?.close(); input.pause(); input.destroy?.();
  };
  const onInt = () => stop('SIGINT'), onTerm = () => stop('SIGTERM'), onHup = () => stop('SIGHUP');
  const onOutputError = () => { outputBroken = true; stop('output_error'); };
  process.once('SIGINT', onInt); process.once('SIGTERM', onTerm); process.once('SIGHUP', onHup);
  output.on('error', onOutputError);
  try {
    const executable = await findFirefox(executablePath);
    if (stopped) return;
    ownedProfile = await mkdtemp(join(tmpdir(), 'neiva-isolated-firefox-'));
    browser = await puppeteer.launch({browser: 'firefox', protocol: 'webDriverBiDi', executablePath: executable,
      headless: true, userDataDir: ownedProfile, env: isolatedEnvironment(), signal: abort.signal,
      handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
      args: ['--no-remote', '--new-instance'], timeout: 30000,
      extraPrefsFirefox: {'dom.ipc.processCount': 2, 'network.protocol-handler.external-default': false,
        'browser.download.dir': join(ownedProfile, 'downloads'), 'browser.download.folderList': 2,
        'browser.download.useDownloadDir': true}});
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    page.setDefaultTimeout(15000);
    emit({event: 'ready', ready: true, browser: await browser.version(), pid: browser.process()?.pid,
      profile: ownedProfile, headless: true, physicalInput: false, viewport: VIEWPORT});
    reader = createInterface({input, crlfDelay: Infinity});
    for await (const line of reader) {
      if (stopped) break;
      let command, requestId;
      try {
        if (line.length > 65536) throw new Error('Command exceeds 64 KiB');
        let raw;
        try { raw = JSON.parse(line); } catch { throw new Error('Invalid JSON command'); }
        if ((typeof raw?.id === 'string' && raw.id.length <= 120) || (typeof raw?.id === 'number' && Number.isFinite(raw.id))) requestId = raw.id;
        command = validateCommand(raw);
        let result = {};
        switch (command.action) {
          case 'quit': stopped = true; break;
          case 'goto': {
            const response = await page.goto(command.url, {waitUntil: 'domcontentloaded', timeout: 45000});
            result = {status: response?.status() ?? null}; break;
          }
          case 'click': await page.mouse.click(command.x, command.y); break;
          case 'move': await page.mouse.move(command.x, command.y, {steps: command.steps}); break;
          case 'down': await page.mouse.down(); mouseDown = true; break;
          case 'up': await page.mouse.up(); mouseDown = false; break;
          case 'key':
            try {
              await page.keyboard.down(command.key);
              if (command.durationMs) await delay(command.durationMs, undefined, {signal: abort.signal});
            } finally { await page.keyboard.up(command.key); }
            break;
          case 'drag':
            await page.mouse.move(command.from.x, command.from.y);
            try {
              await page.mouse.down(); mouseDown = true;
              for (let step = 1; step <= command.steps; step++) {
                await page.mouse.move(command.from.x + (command.to.x - command.from.x) * step / command.steps,
                  command.from.y + (command.to.y - command.from.y) * step / command.steps);
                if (command.durationMs) await delay(command.durationMs / command.steps, undefined, {signal: abort.signal});
              }
            } finally { await page.mouse.up(); mouseDown = false; }
            break;
          case 'snapshot': {
            const file = await reserveSnapshot(command.path);
            try { await file.writeFile(await page.screenshot({type: 'png'})); }
            finally { await file.close(); }
            result = {path: relative(REPO, command.path)}; break;
          }
          case 'inspect': {
            result = await page.evaluate(() => ({title: document.title, text: document.body?.innerText.slice(0, 5000) ?? '',
              buttons: [...document.querySelectorAll('button')].slice(0, 60).map(button => ({
                text: button.innerText, label: button.getAttribute('aria-label')}))}));
            result.url = redactURL(page.url()); break;
          }
        }
        emit({...requestId === undefined ? {} : {id: requestId}, ok: true, action: command.action, ...result});
        if (stopped) break;
      } catch (error) {
        if (mouseDown) { try { await page.mouse.up(); } catch {} mouseDown = false; }
        emit({...requestId === undefined ? {} : {id: requestId}, ok: false,
          ...(command ? {action: command.action} : {}), error: command?.action === 'key' ? 'Virtual key operation failed' : message(error)});
      }
    }
  } catch (error) {
    if (!stopped) { emit({event: 'error', ok: false, error: message(error)}); process.exitCode = 1; }
  } finally {
    reader?.close(); input.pause(); input.destroy?.();
    let exited = true;
    if (browser) {
      const child = browser.process();
      const alive = () => child && child.exitCode === null && child.signalCode === null;
      const waitExit = () => alive() ? new Promise(done => child.once('exit', done)) : Promise.resolve();
      try { await deadline(browser.close(), 8000); } catch {}
      // Kill only the process launched above. Never match or kill by name.
      if (alive()) {
        child.kill('SIGTERM');
        try { await deadline(waitExit(), 3000); }
        catch { if (alive()) child.kill('SIGKILL'); }
        try { await deadline(waitExit(), 3000); } catch { exited = false; }
      }
      try { await deadline(browser.disconnect(), 2000); } catch {}
    }
    if (ownedProfile && exited) {
      try { await rm(ownedProfile, {recursive: true, force: true}); }
      catch { emit({event: 'error', ok: false, error: 'Could not remove the owned temporary profile'}); process.exitCode = 1; }
    }
    if (!exited) { emit({event: 'error', ok: false, error: 'Owned Firefox still running; its temporary profile was preserved'}); process.exitCode = 1; }
    process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm); process.removeListener('SIGHUP', onHup);
    output.removeListener('error', onOutputError);
    if (stopSignal) process.exitCode = {SIGINT: 130, SIGTERM: 143, SIGHUP: 129, output_error: 1}[stopSignal];
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === '--browser' && args[1])) {
    process.stderr.write('Usage: node scripts/isolated-firefox.mjs [--browser /path/to/firefox]\n');
    process.exitCode = 2;
  } else await run({executablePath: args[1]});
}
