'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const ini = require('./ini.cjs');
const steam = require('./steam.cjs');
const transaction = require('./transactions.cjs');
const { loadPayload } = require('./payload.cjs');
const { ServiceError, contained, relativePath, readOptional, sha256, atomicWrite, exists } = require('./paths.cjs');

const STATE_PATH = '.unx-manager/state.json';
const IMPORT = { Architecture: 'Win32', Filename: 'unx.dll', Role: 'PlugIn', When: 'PlugIn' };
const PROTON_APPS = ['FFX.exe', 'FFX-2.exe', 'FFX&X-2_Will.exe'];
const RUNTIMES = ['D3DCompiler_43.dll', 'd3dx9_43.dll', 'MSVCP140.dll', 'CONCRT140.dll', 'VCOMP140.dll', 'VCRUNTIME140.dll'];
const testHooks = { payloadDirectory: undefined, beforeWrite: undefined, stopped: undefined, platform: undefined, prefix: undefined, runtimeLocations: undefined };
const configuration = { payloadDirectory: undefined };

function configure(options = {}) {
  if (options.payloadDir !== undefined) {
    if (typeof options.payloadDir !== 'string' || !path.isAbsolute(options.payloadDir)) throw new ServiceError('INVALID_PAYLOAD_PATH', 'The application payload directory must be absolute.');
    configuration.payloadDirectory = options.payloadDir;
  }
}

function platform() { return testHooks.platform || process.platform; }
function schema() { return require('../../shared/settings-schema.json'); }
function warning(code, message) { return { code, message }; }
function identity(file) { return `${file.scope}:${file.path.toLowerCase()}`; }

async function readState(root) {
  const data = await readOptional(await contained(root, STATE_PATH));
  if (!data) return null;
  let state;
  try { state = JSON.parse(data.toString('utf8')); } catch { throw new ServiceError('STATE_DAMAGED', 'The manager installation record is damaged. Restore a saved backup first.'); }
  if (state.schemaVersion !== 1 || !Array.isArray(state.files) || typeof state.version !== 'string') {
    throw new ServiceError('STATE_DAMAGED', 'The manager installation record is invalid.');
  }
  const seen = new Set();
  for (const file of state.files) {
    if (!file || !['game', 'proton'].includes(file.scope) || typeof file.path !== 'string' ||
        (file.sha256 !== null && !/^[a-f0-9]{64}$/.test(file.sha256 || '')) ||
        !/^\d{8}T\d{9}Z-[a-f0-9]{8}$/.test(file.originalBackupId || '')) {
      throw new ServiceError('STATE_DAMAGED', 'The manager installation record contains an invalid file.');
    }
    relativePath(file.path);
    if (file.scope === 'proton' && file.path !== 'user.reg') throw new ServiceError('STATE_DAMAGED', 'The installation record contains an invalid Proton file.');
    if (seen.has(identity(file))) throw new ServiceError('STATE_DAMAGED', 'The installation record contains duplicate files.');
    seen.add(identity(file));
  }
  return state;
}

async function assertNoUnfinished(root) {
  if ((await transaction.listBackups(root)).some(backup => ['prepared', 'rollback-failed'].includes(backup.status))) {
    throw new ServiceError('UNFINISHED_TRANSACTION', 'Restore the interrupted operation from Backups before making another change.');
  }
}

async function context(gameDirectory, write = false, readManagedState = true) {
  const info = await steam.installationInfo(gameDirectory);
  if (write) {
    if (testHooks.stopped) await testHooks.stopped(info.path);
    else await steam.assertGameStopped(info.path);
  }
  const proton = testHooks.prefix === undefined ? await steam.protonPrefix(info) : testHooks.prefix;
  return { info, roots: { game: info.path, proton }, state: readManagedState ? await readState(info.path) : null };
}

function coerceRead(setting, value, warnings, validity) {
  if (value === undefined) { validity.valid = false; return setting.default; }
  if (setting.type === 'boolean') {
    if (/^(true|1|yes|on)$/i.test(value)) return true;
    if (/^(false|0|no|off)$/i.test(value)) return false;
  } else if (setting.type === 'number') {
    const number = Number(value);
    if (value !== '' && Number.isFinite(number)) {
      try { validateValue(setting, number); return number; } catch { /* Show a safe editable default. */ }
    }
  } else if (setting.type === 'select') {
    const match = setting.options?.find(option => String(option.value ?? option) === value);
    if (match !== undefined) return match.value ?? match;
    warnings.push(warning('PRESERVED_VALUE', `${setting.label} has an existing custom value; it will be kept unless changed.`));
    if (value.length <= 127) return value;
  } else {
    try { validateValue(setting, value); return value; } catch { /* Show a safe editable default. */ }
  }
  validity.valid = false;
  warnings.push(warning('INVALID_EXISTING_VALUE', `${setting.label} has an invalid existing value; the editor shows its default.`));
  return setting.default;
}

async function readSettings(root) {
  const documents = new Map();
  const warnings = [];
  const values = {};
  const validValues = {};
  for (const setting of schema().settings) {
    if (!documents.has(setting.file)) {
      const file = await contained(root, setting.file);
      const bytes = await readOptional(file);
      documents.set(setting.file, { bytes, parsed: ini.parse(bytes) });
    }
    const validity = { valid: true };
    values[setting.id] = coerceRead(setting, ini.get(documents.get(setting.file).parsed, setting.section, setting.key), warnings, validity);
    validValues[setting.id] = validity.valid;
  }
  return { documents, values, warnings, validValues };
}

async function loadSettings(gameDirectory) {
  const { info } = await context(gameDirectory, false, false);
  const { values, warnings } = await readSettings(info.path);
  return { values, warnings };
}

function validateValue(setting, value) {
  function invalid(message = 'has an invalid value') { throw new ServiceError('INVALID_SETTING', `${setting.label} ${message}.`, { settingId: setting.id }); }
  if (setting.type === 'boolean') {
    if (typeof value !== 'boolean') invalid('must be true or false');
    return value ? 'true' : 'false';
  }
  if (setting.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) ||
        (setting.min !== undefined && value < setting.min) || (setting.max !== undefined && value > setting.max) ||
        (setting.integer && !Number.isInteger(value))) invalid('is outside its allowed range');
    return String(value);
  }
  if (setting.type === 'select') {
    if (!setting.options?.some(option => (option.value ?? option) === value)) invalid('must use one of the available options');
    return String(value);
  }
  if (typeof value !== 'string' || value.length > Math.min(setting.maxLength || 127, 127) || /[\r\n\0]/.test(value)) invalid('must be a single line of at most 127 characters');
  if (setting.id.startsWith('input.keyboard.') && value.length > 120) invalid('must contain at most 120 characters');
  if (setting.id.startsWith('input.controller.') && value) {
    const allowed = new Set(['a', 'b', 'x', 'y', 'cross', 'circle', 'square', 'triangle', 'start', 'back', 'select',
      'lb', 'l1', 'rb', 'r1', 'lt', 'l2', 'rt', 'r2', 'ls', 'l3', 'rs', 'r3', 'up', 'down', 'left', 'right']);
    if (value.split('+').some(token => !allowed.has(token.trim().toLowerCase()))) invalid('contains an unsupported controller button');
    return value.split('+').map(token => token.trim()).join('+');
  }
  if (setting.id === 'sk.input.slotReassignment') {
    const slots = value.split(',').map(token => token.trim());
    if (slots.length !== 4 || slots.some(token => !/^[0-3]$/.test(token)) || new Set(slots).size !== 4) invalid('must be a permutation of 0,1,2,3');
  }
  return value;
}

async function settingsChanges(root, values = {}, payload = null) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new ServiceError('INVALID_SETTINGS', 'The settings request must be an object.');
  const loaded = await readSettings(root);
  const settings = new Map(schema().settings.map(setting => [setting.id, setting]));
  const byFile = new Map();
  for (const [id, value] of Object.entries(values)) {
    const setting = settings.get(id);
    if (!setting) throw new ServiceError('UNKNOWN_SETTING', `Unknown configuration setting: ${id}.`);
    // Existing custom selections such as language "en" retain their exact bytes.
    if (Object.is(value, loaded.values[id]) && loaded.validValues[id] && loaded.documents.get(setting.file).bytes !== null) continue;
    const serialized = validateValue(setting, value);
    if (!byFile.has(setting.file)) byFile.set(setting.file, []);
    byFile.get(setting.file).push({ section: setting.section, key: setting.key, value: serialized });
  }
  if (payload) for (const setting of settings.values()) {
    if (!loaded.documents.get(setting.file).bytes && !byFile.has(setting.file)) byFile.set(setting.file, []);
  }
  if (!byFile.has('dxgi.ini')) byFile.set('dxgi.ini', []);
  byFile.get('dxgi.ini').push(...Object.entries(IMPORT).map(([key, value]) => ({ section: 'Import.UnX', key, value })));
  const changes = [];
  for (const [file, edits] of byFile) {
    let before = loaded.documents.get(file)?.bytes;
    if (before === undefined) before = await readOptional(await contained(root, file));
    if (!before && payload) before = payload.files.get(`default_${file}`.toLowerCase())?.data || null;
    if (!before) {
      for (const setting of settings.values()) {
        if (setting.file === file && !edits.some(edit => edit.section === setting.section && edit.key === setting.key)) {
          edits.push({ section: setting.section, key: setting.key, value: validateValue(setting, setting.default) });
        }
      }
    }
    changes.push({ scope: 'game', path: file, data: ini.edit(before, edits) });
  }
  return { changes, warnings: loaded.warnings };
}

function protonSection(executable) { return String.raw`Software\\Wine\\AppDefaults\\${executable}\\DllOverrides`; }
function patchProtonRegistry(buffer) {
  const text = ini.decode(buffer).text;
  if (!/^WINE REGISTRY Version [12](?:\r?\n|$)/.test(text) || text.includes('\0') ||
      text.split(/\r?\n/).some(line => /^\s*\[/.test(line) && !/^\s*\[[^\r\n]+\](?:\s+\d+)?\s*$/.test(line))) {
    throw new ServiceError('PROTON_REGISTRY_INVALID', 'The Proton user.reg file is malformed. Repair or recreate this game\'s Steam Proton prefix before installing.');
  }
  return ini.edit(buffer, PROTON_APPS.map(executable => ({ section: protonSection(executable), key: '"dxgi"', value: '"native,builtin"' })));
}
function hasProtonOverrides(buffer) {
  if (!buffer) return false;
  const document = ini.parse(buffer);
  return PROTON_APPS.every(executable => ini.get(document, protonSection(executable), '"dxgi"')?.replace(/\s/g, '').toLowerCase() === '"native,builtin"');
}

async function payloadAndConflicts(root, state) {
  const payload = await loadPayload(testHooks.payloadDirectory || configuration.payloadDirectory);
  const conflicts = [];
  if (platform() !== 'win32') {
    const entries = await fs.readdir(root);
    const dlls = [...payload.files.values()].filter(file => !file.path.includes('/') && /\.dll$/i.test(file.path));
    for (const file of dlls) for (const name of entries) {
      if (name !== file.path && name.toLowerCase() === file.path.toLowerCase()) {
        conflicts.push({ code: 'CASE_ALIAS', path: name,
          message: `The existing ${name} uses a different filename case from ${file.path}. Move or rename that DLL before installing; Wine resolves DLL names without case sensitivity.` });
      }
    }
  }
  const dxgi = await readOptional(await contained(root, 'dxgi.dll'));
  if (dxgi) {
    const hash = sha256(dxgi);
    const owned = state?.files.find(file => file.scope === 'game' && file.path.toLowerCase() === 'dxgi.dll');
    if (hash !== payload.files.get('dxgi.dll').sha256 && hash !== owned?.sha256) {
      conflicts.push({ code: 'FOREIGN_DXGI', path: 'dxgi.dll',
        message: 'An existing dxgi.dll belongs to another or unrecognized injector. Move it to a safe location before installing UnX; the manager will not overwrite it.' });
    }
  }
  return { payload, conflicts };
}

async function prerequisiteWarnings(info, roots) {
  const warnings = [];
  let locations = [info.path];
  if (platform() === 'win32') {
    const windows = process.env.SystemRoot || 'C:\\Windows';
    locations.push(path.join(windows, 'SysWOW64'), path.join(windows, 'System32'));
  } else if (roots.proton) {
    locations.push(path.join(roots.proton, 'drive_c', 'windows', 'syswow64'), path.join(roots.proton, 'drive_c', 'windows', 'system32'));
  }
  if (testHooks.runtimeLocations) locations = testHooks.runtimeLocations;
  const missing = [];
  for (const runtime of RUNTIMES) {
    let found = false;
    for (const location of locations) {
      const candidates = [path.join(location, runtime)];
      if (platform() !== 'win32') candidates.push(path.join(location, runtime.toLowerCase()));
      for (const file of candidates) {
        let handle;
        try {
          handle = await fs.open(file, 'r');
          const header = Buffer.alloc(64);
          if ((await handle.read(header, 0, 64, 0)).bytesRead !== 64 || header.toString('ascii', 0, 2) !== 'MZ') continue;
          const offset = header.readUInt32LE(0x3c);
          if (offset > 0x100000) continue;
          const pe = Buffer.alloc(6);
          if ((await handle.read(pe, 0, 6, offset)).bytesRead === 6 && pe.readUInt32LE(0) === 0x4550 && pe.readUInt16LE(4) === 0x14c) found = true;
        } catch { /* The next location may contain the required Win32 runtime. */ }
        finally { if (handle) await handle.close(); }
        if (found) break;
      }
      if (found) break;
    }
    if (!found) missing.push(runtime);
  }
  if (missing.length) warnings.push(warning('RUNTIME_DEPENDENCIES',
    `Required Win32 runtime files were not found: ${missing.join(', ')}. Install the game's Steam prerequisites (DirectX June 2010 and Microsoft Visual C++ x86) before playing.`));
  return warnings;
}

async function inspectInstallation(gameDirectory) {
  const { info, roots } = await context(gameDirectory, false, false);
  const warnings = [];
  let state = null;
  try { state = await readState(info.path); }
  catch (error) { warnings.push(warning(error.code || 'STATE_DAMAGED', error.message)); }
  let payload;
  let conflicts = [];
  try { ({ payload, conflicts } = await payloadAndConflicts(info.path, state)); }
  catch (error) { warnings.push(warning(error.code || 'PAYLOAD_MISSING', error.message)); }
  const plugin = await readOptional(await contained(info.path, 'unx.dll'));
  const dxgi = await readOptional(await contained(info.path, 'dxgi.dll'));
  const current = Boolean(plugin && payload && sha256(plugin) === payload.files.get('unx.dll').sha256);
  const integrity = { checkedFiles: 0, missing: [], modified: [], criticalModified: [] };
  if (payload) for (const file of payload.files.values()) {
    const data = await readOptional(await contained(info.path, file.path));
    integrity.checkedFiles++;
    if (!data) integrity.missing.push(file.path);
    else if (sha256(data) !== file.sha256) {
      integrity.modified.push(file.path);
      if (/\.dll$/i.test(file.path)) integrity.criticalModified.push(file.path);
    }
  }
  if (integrity.missing.length) warnings.push(warning('PACKAGE_FILES_MISSING', `${integrity.missing.length} packaged files are missing. Install or update to restore the complete package.`));
  if (integrity.criticalModified.length) warnings.push(warning('RUNTIME_FILES_MODIFIED', 'One or more installed plugin/runtime DLLs differ from the offline package. Install or update before playing.'));
  if (integrity.modified.length > integrity.criticalModified.length) warnings.push(warning('CUSTOM_ASSETS', 'Some packaged resources/default templates were customized. Installation updates replace packaged resources and keep a backup.'));
  const dxgiIni = await readOptional(await contained(info.path, 'dxgi.ini'));
  const imported = Object.entries(IMPORT).every(([key, value]) => ini.get(ini.parse(dxgiIni), 'Import.UnX', key) === value);
  let proton = null;
  if (platform() !== 'win32') {
    const registry = roots.proton ? await readOptional(await contained(roots.proton, 'user.reg')) : null;
    proton = { prefix: roots.proton, configured: hasProtonOverrides(registry), override: 'dxgi=n,b',
      applications: [...PROTON_APPS], launchOptions: 'WINEDLLOVERRIDES="dxgi=n,b" %command%' };
    if (!roots.proton) warnings.push(warning('PROTON_PREFIX_MISSING', 'Run this game once through Steam with Proton, close it, then install again to configure its per-game DLL overrides.'));
    else if (!proton.configured) warnings.push(warning('PROTON_OVERRIDE_MISSING', 'Install or update UnX to enable dxgi for this game inside its existing Proton prefix.'));
    warnings.push(warning('PROTON_NOT_RUNTIME_TESTED', 'Linux/Proton support has not been verified by an interactive gameplay test on this machine.'));
  }
  warnings.push(...await prerequisiteWarnings(info, roots));
  const backups = await transaction.listBackups(info.path);
  if (backups.some(backup => ['prepared', 'rollback-failed'].includes(backup.status))) warnings.push(warning('UNFINISHED_TRANSACTION', 'An interrupted operation has a saved backup. Restore that backup before playing.'));
  const blockers = warnings.filter(item => ['PAYLOAD_MISSING', 'PAYLOAD_INTEGRITY', 'PROTON_PREFIX_MISSING', 'PROTON_OVERRIDE_MISSING', 'RUNTIME_DEPENDENCIES', 'UNFINISHED_TRANSACTION', 'STATE_DAMAGED'].includes(item.code));
  return { ...info, installation: info, installed: Boolean(plugin && dxgi), managed: Boolean(state),
    version: state?.version || null, availableVersion: payload?.manifest.version || null,
    upToDate: Boolean(current && !integrity.missing.length && !integrity.criticalModified.length),
    readyToPlay: Boolean(current && imported && !conflicts.length && !blockers.length && !integrity.missing.length && !integrity.criticalModified.length),
    conflicts, warnings, integrity, proton, backupCount: backups.length };
}

function withState(changes, state, version) {
  const managed = new Map((state?.files || []).map(file => [identity(file), { ...file }]));
  for (const change of changes) {
    const key = identity(change);
    if (!managed.has(key)) change.capture = true;
    managed.set(key, { scope: change.scope, path: change.path, sha256: change.data === null ? null : sha256(change.data),
      originalBackupId: managed.get(key)?.originalBackupId || null });
  }
  changes.push({ scope: 'game', path: STATE_PATH, data: backupId => Buffer.from(JSON.stringify({
    schemaVersion: 1, version, updatedAt: new Date().toISOString(),
    files: [...managed.values()].map(file => ({ ...file, originalBackupId: file.originalBackupId || backupId }))
  }, null, 2)) });
  return changes;
}

async function installOrUpdate(gameDirectory, values = {}, options = {}) {
  const { info, roots, state } = await context(gameDirectory, true);
  await assertNoUnfinished(info.path);
  const { payload, conflicts } = await payloadAndConflicts(info.path, state);
  if (conflicts.length) throw new ServiceError('INSTALL_CONFLICT', conflicts[0].message, { conflicts });
  const settings = await settingsChanges(info.path, values, payload);
  const changes = [...payload.files.values()].map(file => ({ scope: 'game', path: file.path, data: file.data, mode: 0o644 }));
  const activeConfigNames = new Set(settings.changes.map(file => file.path.toLowerCase()));
  for (let index = changes.length - 1; index >= 0; index--) if (activeConfigNames.has(changes[index].path.toLowerCase())) changes.splice(index, 1);
  changes.push(...settings.changes);
  const warnings = [...settings.warnings];
  if (platform() !== 'win32') {
    if (roots.proton && options.configureProton !== false) {
      const registry = await fs.readFile(await contained(roots.proton, 'user.reg', { allowMissing: false }));
      changes.push({ scope: 'proton', path: 'user.reg', data: patchProtonRegistry(registry) });
    } else if (!roots.proton) warnings.push(warning('PROTON_PREFIX_MISSING', 'Run the game once in Steam with Proton, close it, then install again to configure dxgi automatically.'));
    else warnings.push(warning('PROTON_OVERRIDE_MISSING', 'Automatic Proton configuration was disabled. Configure dxgi=n,b for this game in Steam before playing.'));
  }
  withState(changes, state, payload.manifest.version);
  const result = await transaction.runTransaction(roots, changes, state ? 'update' : 'install', testHooks.beforeWrite);
  const inspection = await inspectInstallation(info.path);
  return { ...result, version: payload.manifest.version, warnings: [...warnings, ...inspection.warnings], readyToPlay: inspection.readyToPlay, inspection };
}

async function saveSettings(gameDirectory, values) {
  const { info, roots, state } = await context(gameDirectory, true);
  await assertNoUnfinished(info.path);
  const settings = await settingsChanges(info.path, values);
  if (state) withState(settings.changes, state, state.version);
  const result = await transaction.runTransaction(roots, settings.changes, 'settings', testHooks.beforeWrite);
  return { ...result, warnings: settings.warnings, restartRequired: result.changed };
}

async function listBackups(gameDirectory) {
  const { info } = await context(gameDirectory, false, false);
  return transaction.listBackups(info.path);
}

async function restoreBackup(gameDirectory, backupId) {
  const { info, roots } = await context(gameDirectory, true, false);
  const backup = await transaction.readBackup(info.path, backupId);
  let currentState = null;
  try { currentState = await readState(info.path); } catch { /* The chosen backup can repair a damaged record. */ }
  const stateEntry = backup.files.find(file => file.scope === 'game' && file.path === STATE_PATH);
  let previousState = null;
  if (stateEntry?.data) {
    try {
      previousState = JSON.parse(stateEntry.data.toString('utf8'));
      if (previousState.schemaVersion !== 1 || !Array.isArray(previousState.files)) throw new Error('Invalid state.');
    } catch { throw new ServiceError('INVALID_BACKUP', 'The backup contains an invalid installation record.'); }
  }
  const changes = backup.files.filter(file => !(file.scope === 'game' && file.path === STATE_PATH));
  if (currentState || previousState || stateEntry) {
    const managed = new Map((currentState?.files || previousState?.files || []).map(file => [identity(file), { ...file }]));
    const earlier = new Map((previousState?.files || []).map(file => [identity(file), file]));
    for (const file of changes) {
      const key = identity(file);
      const existing = managed.get(key);
      const before = earlier.get(key);
      if (before) managed.set(key, { ...before, sha256: file.data === null ? null : sha256(file.data) });
      else if (existing?.originalBackupId === backupId) managed.delete(key);
      else if (existing) managed.set(key, { ...existing, sha256: file.data === null ? null : sha256(file.data) });
    }
    const pluginRestored = changes.some(file => file.scope === 'game' && file.path.toLowerCase() === 'unx.dll');
    const version = pluginRestored && previousState ? previousState.version : currentState?.version || previousState?.version || 'unknown';
    changes.push({ scope: 'game', path: STATE_PATH, data: managed.size ? Buffer.from(JSON.stringify({
      schemaVersion: 1, version, updatedAt: new Date().toISOString(), files: [...managed.values()]
    }, null, 2)) : null });
  }
  if (['prepared', 'rollback-failed'].includes(backup.manifest.status)) {
    changes.push({ scope: 'game', path: `${transaction.BACKUPS}/${backupId}/manifest.json`,
      data: Buffer.from(JSON.stringify({ ...backup.manifest, status: 'restored', restoredAt: new Date().toISOString() }, null, 2)) });
  }
  return transaction.runTransaction(roots, changes, 'restore', testHooks.beforeWrite);
}

async function uninstall(gameDirectory) {
  const { info, roots, state } = await context(gameDirectory, true);
  await assertNoUnfinished(info.path);
  if (!state) throw new ServiceError('NOT_MANAGED', 'This installation has no manager record. Install it with this manager before using automatic removal.');
  const changes = [];
  const origins = new Map();
  for (const file of state.files) {
    const current = await readOptional(await transaction.resolveTarget(roots, file));
    if (!origins.has(file.originalBackupId)) origins.set(file.originalBackupId, await transaction.readBackup(info.path, file.originalBackupId));
    const original = origins.get(file.originalBackupId).files.find(entry => identity(entry) === identity(file));
    if (!original) throw new ServiceError('INVALID_BACKUP', `The original backup for ${file.path} is missing.`);
    if ((current === null ? null : sha256(current)) === file.sha256) changes.push(original);
    else if (file.scope === 'proton' && file.path === 'user.reg' && current && original.data && hasProtonOverrides(current)) {
      // Wine normally updates user.reg during gameplay. Remove only our three
      // app-specific overrides; preserve all later registry changes.
      const previous = ini.parse(original.data);
      const edits = [];
      const removals = [];
      for (const executable of PROTON_APPS) {
        const section = protonSection(executable);
        const value = ini.get(previous, section, '"dxgi"');
        if (value === undefined) removals.push({ section, key: '"dxgi"' });
        else edits.push({ section, key: '"dxgi"', value });
      }
      changes.push({ ...original, data: ini.edit(ini.remove(current, removals), edits) });
    } else throw new ServiceError('MODIFIED_FILE', `The managed file ${file.path} changed outside the manager. Back it up and restore a manager snapshot before uninstalling.`);
  }
  changes.push({ scope: 'game', path: STATE_PATH, data: null });
  const result = await transaction.runTransaction(roots, changes, 'uninstall', testHooks.beforeWrite);
  return { ...result, restoredPreviousInstallation: true, warnings: [] };
}

async function exportDiagnostics(gameDirectory, destination) {
  const { info } = await context(gameDirectory);
  if (typeof destination !== 'string' || !path.isAbsolute(destination) || !destination.toLowerCase().endsWith('.zip')) throw new ServiceError('INVALID_DESTINATION', 'Choose an absolute ZIP destination.');
  const AdmZip = require('adm-zip');
  const archive = new AdmZip();
  const inspection = await inspectInstallation(info.path);
  archive.addFile('inspection.json', Buffer.from(JSON.stringify({ ...inspection, exportedAt: new Date().toISOString(), platform: process.platform, architecture: process.arch }, null, 2)));
  const names = new Set(schema().settings.map(setting => setting.file));
  names.add('dxgi.ini');
  for (const name of names) {
    const bytes = await readOptional(await contained(info.path, name));
    if (bytes && bytes.length < 4 * 1024 * 1024) archive.addFile(`configuration/${name}`, bytes);
  }
  const logDirectory = await contained(info.path, 'logs');
  for (const entry of await fs.readdir(logDirectory, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !/\.(log|txt)$/i.test(entry.name)) continue;
    const file = await contained(info.path, `logs/${entry.name}`, { allowMissing: false });
    const bytes = await fs.readFile(file);
    if (bytes.length <= 8 * 1024 * 1024) archive.addFile(`logs/${entry.name}`, bytes);
  }
  if (await exists(destination)) throw new ServiceError('DESTINATION_EXISTS', 'Choose a new diagnostics ZIP filename to avoid replacing another file.');
  await atomicWrite(destination, archive.toBuffer());
  return { path: destination, contains: 'Installation status, configuration files and top-level logs. No saves or game executables.' };
}

module.exports = { discoverInstallations: steam.discoverInstallations, inspectInstallation, loadSettings,
  installOrUpdate, saveSettings, listBackups, restoreBackup, uninstall, exportDiagnostics,
  configure, ServiceError, _test: { hooks: testHooks, validateValue, settingsChanges, patchProtonRegistry, hasProtonOverrides, readSettings } };
