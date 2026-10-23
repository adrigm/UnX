'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { ServiceError, exists, contained } = require('./paths.cjs');
const run = promisify(execFile);
const APP_ID = '359870';
const GAME_NAME = 'FINAL FANTASY FFX&FFX-2 HD Remaster';
const GAME_PROCESS = /^(?:ffx|ffx-2|ffx&x-2_will|ffx&x-2_launcher)\.exe$/i;
const knownLibraries = new Map();
function pathKey(value) { return process.platform === 'win32' ? value.toLowerCase() : value; }

function parseVdf(text) {
  const tokens = [];
  const expression = /"((?:\\.|[^"\\])*)"|([{}])|\/\/[^\n]*/g;
  for (const match of text.matchAll(expression)) {
    if (match[2]) tokens.push(match[2]);
    else if (match[1] !== undefined) tokens.push(match[1].replace(/\\([\\"])/g, '$1'));
  }
  let cursor = 0;
  function object() {
    const result = Object.create(null);
    while (cursor < tokens.length && tokens[cursor] !== '}') {
      const key = tokens[cursor++];
      if (key === '{' || cursor >= tokens.length) throw new Error('Invalid Steam library file.');
      const value = tokens[cursor++];
      if (value === '{') {
        result[key] = object();
        if (tokens[cursor++] !== '}') throw new Error('Invalid Steam library file.');
      } else if (value === '}') throw new Error('Invalid Steam library file.');
      else result[key] = value;
    }
    return result;
  }
  return object();
}

async function steamRoots() {
  const home = os.homedir();
  const roots = [];
  if (process.platform === 'win32') {
    for (const key of ['HKCU\\Software\\Valve\\Steam', 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam']) {
      try {
        const { stdout } = await run('reg.exe', ['query', key], { windowsHide: true, timeout: 8000 });
        const match = /^\s*(?:SteamPath|InstallPath)\s+REG_\w+\s+(.+)$/im.exec(stdout);
        if (match) roots.push(match[1].trim());
      } catch { /* The other registry key/default location can still work. */ }
    }
    if (process.env['ProgramFiles(x86)']) roots.push(path.join(process.env['ProgramFiles(x86)'], 'Steam'));
    if (process.env.ProgramFiles) roots.push(path.join(process.env.ProgramFiles, 'Steam'));
  } else {
    roots.push(path.join(home, '.steam', 'steam'), path.join(home, '.steam', 'root'),
      path.join(home, '.local', 'share', 'Steam'),
      path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'Steam'),
      path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'));
  }
  return roots;
}

async function libraries(roots = undefined) {
  const result = new Map();
  for (const candidate of roots || await steamRoots()) {
    let root;
    try { root = await fs.realpath(candidate); } catch { continue; }
    result.set(pathKey(root), { path: root, steamRoot: root });
    for (const relative of ['steamapps/libraryfolders.vdf', 'config/libraryfolders.vdf']) {
      try {
        const data = parseVdf(await fs.readFile(path.join(root, ...relative.split('/')), 'utf8'));
        const folders = data.libraryfolders || data.LibraryFolders || data;
        for (const [key, value] of Object.entries(folders)) {
          if (!/^\d+$/.test(key)) continue;
          const folder = typeof value === 'string' ? value : value.path;
          if (!folder) continue;
          const actual = await fs.realpath(folder).catch(() => null);
          if (actual) result.set(pathKey(actual), { path: actual, steamRoot: root });
        }
      } catch { /* Missing/broken library lists do not hide the primary library. */ }
    }
  }
  return [...result.values()];
}

async function discoverInstallations(roots = undefined) {
  const result = [];
  const seen = new Set();
  for (const library of await libraries(roots)) {
    try {
      const manifest = parseVdf(await fs.readFile(path.join(library.path, 'steamapps', `appmanifest_${APP_ID}.acf`), 'utf8')).AppState;
      if (!manifest || manifest.appid !== APP_ID || !manifest.installdir || /[\\/]/.test(manifest.installdir)) continue;
      const candidate = path.join(library.path, 'steamapps', 'common', manifest.installdir);
      const actual = await fs.realpath(candidate);
      if (!await exists(path.join(actual, 'FFX.exe')) || !await exists(path.join(actual, 'FFX-2.exe'))) continue;
      knownLibraries.set(pathKey(actual), { steamapps: path.join(library.path, 'steamapps'), installName: manifest.installdir });
      if (seen.has(pathKey(actual))) continue;
      seen.add(pathKey(actual));
      result.push({ path: actual, source: 'steam', label: `${GAME_NAME} (${library.path})` });
    } catch { /* A not-yet-installed library is an ordinary discovery miss. */ }
  }
  return result;
}

async function installationInfo(gameDirectory) {
  if (typeof gameDirectory !== 'string' || !gameDirectory.trim()) throw new ServiceError('INVALID_INSTALLATION', 'Choose the Steam game folder first.');
  let root;
  try { root = await fs.realpath(gameDirectory); } catch { throw new ServiceError('INVALID_INSTALLATION', 'The selected game folder does not exist.'); }
  for (const executable of ['FFX.exe', 'FFX-2.exe']) {
    const file = await contained(root, executable, { allowMissing: false }).catch(() => null);
    if (!file || !(await fs.stat(file)).isFile()) throw new ServiceError('INVALID_INSTALLATION', 'Choose the folder containing both FFX.exe and FFX-2.exe.');
    const handle = await fs.open(file, 'r');
    try {
      const header = Buffer.alloc(64);
      const { bytesRead } = await handle.read(header, 0, 64, 0);
      if (bytesRead < 64 || header.toString('ascii', 0, 2) !== 'MZ') throw new ServiceError('INVALID_EXECUTABLE', `${executable} is not a Windows game executable.`);
      const offset = header.readUInt32LE(0x3c);
      const pe = Buffer.alloc(6);
      if (offset > 0x100000 || (await handle.read(pe, 0, 6, offset)).bytesRead !== 6 ||
          pe.readUInt32LE(0) !== 0x4550 || pe.readUInt16LE(4) !== 0x14c) {
        throw new ServiceError('INVALID_EXECUTABLE', `${executable} must be the Win32 Steam game executable.`);
      }
    } finally { await handle.close(); }
  }
  const selected = path.resolve(gameDirectory);
  const common = path.dirname(selected);
  let steamapps = path.dirname(common);
  let installName = path.basename(selected);
  if ((path.basename(common).toLowerCase() !== 'common' || path.basename(steamapps).toLowerCase() !== 'steamapps') && knownLibraries.has(pathKey(root))) {
    const known = knownLibraries.get(pathKey(root));
    steamapps = known.steamapps;
    installName = known.installName;
  }
  let manifest = null;
  if ((path.basename(common).toLowerCase() === 'common' && path.basename(steamapps).toLowerCase() === 'steamapps') || knownLibraries.has(pathKey(root))) {
    try {
      manifest = parseVdf(await fs.readFile(path.join(steamapps, `appmanifest_${APP_ID}.acf`), 'utf8')).AppState;
      if (manifest && (manifest.appid !== APP_ID || manifest.installdir !== installName)) {
        throw new ServiceError('STEAM_APP_MISMATCH', 'This Steam manifest does not identify Final Fantasy X/X-2 (359870).');
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { path: root, steamapps: manifest ? steamapps : null, appId: APP_ID,
    buildId: manifest?.buildid || null, source: manifest ? 'steam' : 'manual' };
}

async function assertGameStopped(gameDirectory) {
  if (process.platform === 'win32') {
    try {
      const command = "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter \"Name='FFX.exe' OR Name='FFX-2.exe' OR Name='FFX&X-2_Will.exe' OR Name='FFX&X-2_LAUNCHER.exe'\" | Select-Object Name,ExecutablePath) | ConvertTo-Json -Compress";
      const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 12000 });
      const processes = stdout.trim() ? JSON.parse(stdout) : [];
      for (const item of Array.isArray(processes) ? processes : [processes]) {
        if (!item) continue;
        if (!item.ExecutablePath || path.dirname(item.ExecutablePath).toLowerCase() === gameDirectory.toLowerCase()) {
          throw new ServiceError('GAME_RUNNING', 'Close Final Fantasy X/X-2 and its launcher before changing files.');
        }
      }
      return;
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      // No reliable process check means no installation write.
      throw new ServiceError('PROCESS_CHECK_FAILED', 'The running-game check failed. Restart the manager and try again.');
    }
  }
  let processes;
  try { processes = await fs.readdir('/proc'); }
  catch { throw new ServiceError('PROCESS_CHECK_FAILED', 'The running-game check could not read /proc.'); }
  for (const pid of processes.filter(value => /^\d+$/.test(value))) {
    try {
      const args = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
      if (args.some(arg => GAME_PROCESS.test(arg.replace(/\\/g, '/').split('/').pop()))) {
        throw new ServiceError('GAME_RUNNING', 'Close Final Fantasy X/X-2 and its launcher before changing files.');
      }
    } catch (error) { if (error instanceof ServiceError) throw error; }
  }
}

async function protonPrefix(info) {
  if (process.platform === 'win32') return null;
  if (!info.steamapps) return null;
  const candidate = path.join(info.steamapps, 'compatdata', APP_ID, 'pfx');
  const actual = await fs.realpath(candidate).catch(() => null);
  if (!actual) return null;
  const userRegistry = await contained(actual, 'user.reg').catch(() => null);
  return userRegistry && await exists(userRegistry) ? actual : null;
}

module.exports = { APP_ID, parseVdf, steamRoots, libraries, discoverInstallations,
  installationInfo, assertGameStopped, protonPrefix };
