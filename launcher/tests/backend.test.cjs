'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const AdmZip = require('adm-zip');
const installer = require('../main/services/installer.cjs');
const ini = require('../main/services/ini.cjs');
const steam = require('../main/services/steam.cjs');
const { loadPayload } = require('../main/services/payload.cjs');
const { contained, sha256 } = require('../main/services/paths.cjs');

const temporary = [];
afterEach(async () => {
  Object.assign(installer._test.hooks, { payloadDirectory: undefined, beforeWrite: undefined,
    stopped: undefined, platform: undefined, prefix: undefined, runtimeLocations: undefined });
  const tempRoot = await fs.realpath(os.tmpdir());
  for (const directory of temporary.splice(0)) {
    const target = await fs.realpath(directory);
    if (path.dirname(target) !== tempRoot || !path.basename(target).startsWith('unx-backend-')) {
      throw new Error('Refusing to remove a fixture outside the test temporary directory.');
    }
    await fs.rm(target, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unx-backend-'));
  temporary.push(root);
  const game = path.join(root, 'game');
  const payload = path.join(root, 'payload');
  await fs.mkdir(game);
  await fs.mkdir(payload);
  const executable = Buffer.alloc(128);
  executable.write('MZ');
  executable.writeUInt32LE(80, 0x3c);
  executable.writeUInt32LE(0x4550, 80);
  executable.writeUInt16LE(0x14c, 84);
  await fs.writeFile(path.join(game, 'FFX.exe'), executable);
  await fs.writeFile(path.join(game, 'FFX-2.exe'), executable);
  const files = new Map([
    ['unx.dll', Buffer.from('synthetic plugin v1')],
    ['dxgi.dll', Buffer.from('synthetic trusted runtime')],
    ['default_dxgi.ini', Buffer.from('; package defaults\n[SpecialK.System]\nLogLevel=0\n')],
    ['UnX_Res/Icons/sample.dds', Buffer.from('synthetic image resource')]
  ]);
  await writePayload(payload, files);
  Object.assign(installer._test.hooks, { payloadDirectory: payload, stopped: async () => {}, platform: 'win32', prefix: null });
  return { root, game, payload, files };
}

async function writePayload(directory, files, extraEntry = null) {
  const zip = new AdmZip();
  for (const [name, data] of files) zip.addFile(name, data);
  if (extraEntry) zip.addFile(extraEntry, Buffer.from('unexpected'));
  const archive = zip.toBuffer();
  await fs.writeFile(path.join(directory, 'payload.zip'), archive);
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 1,
    version: '0.9.2.1', appId: 359870, archiveSha256: sha256(archive), archiveSize: archive.length,
    files: [...files].map(([name, data]) => ({ path: name, sha256: sha256(data), size: data.length })) }));
}

test('INI edits preserve UTF-16 byte order, comments, unknown entries and line endings', () => {
  const original = '; comment\r\n[SpeedHack.FFX]\r\nMaxSpeed = 8  ; keep inline\r\nUnknown=keep\r\n';
  for (const encoding of ['utf16le', 'utf16be']) {
    const bytes = ini.encode({ text: original, encoding, bom: true });
    const edited = ini.edit(bytes, [{ section: 'SpeedHack.FFX', key: 'MaxSpeed', value: '4' }]);
    const decoded = ini.decode(edited);
    assert.equal(decoded.encoding, encoding);
    assert.equal(decoded.text, original.replace('MaxSpeed = 8', 'MaxSpeed = 4'));
    assert.equal(ini.get(ini.parse(edited), 'speedhack.ffx', 'maxspeed'), '4');
  }
});

test('install, save, backup restore and uninstall perform actual file round trips', async () => {
  const { game, files } = await fixture();
  const original = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('; keep me\r\n[SpeedHack.FFX]\r\nMaxSpeed=8\r\nOther=custom\r\n', 'utf16le')]);
  await fs.writeFile(path.join(game, 'UnX_Booster.ini'), original);
  const installed = await installer.installOrUpdate(game, { 'gameplay.maxSpeed': 4, 'gameplay.partyAp': true });
  assert.equal(installed.changed, true);
  assert.equal(await fs.readFile(path.join(game, 'unx.dll'), 'utf8'), files.get('unx.dll').toString());
  const booster = await fs.readFile(path.join(game, 'UnX_Booster.ini'));
  assert.equal(ini.decode(booster).encoding, 'utf16le');
  assert.match(ini.decode(booster).text, /; keep me\r\n/);
  assert.match(ini.decode(booster).text, /Other=custom/);
  assert.equal((await installer.loadSettings(game)).values['gameplay.maxSpeed'], 4);
  const imports = ini.parse(await fs.readFile(path.join(game, 'dxgi.ini')));
  assert.equal(ini.get(imports, 'Import.UnX', 'Filename'), 'unx.dll');
  assert.equal(ini.get(imports, 'Import.UnX', 'Role'), 'PlugIn');
  assert.equal(ini.get(imports, 'Import.UnX', 'Architecture'), 'Win32');
  const saved = await installer.saveSettings(game, { 'gameplay.maxSpeed': 2 });
  assert.equal((await installer.loadSettings(game)).values['gameplay.maxSpeed'], 2);
  await installer.restoreBackup(game, saved.backupId);
  assert.equal((await installer.loadSettings(game)).values['gameplay.maxSpeed'], 4);
  assert.ok((await installer.listBackups(game)).length >= 3);
  await installer.uninstall(game);
  assert.deepEqual(await fs.readFile(path.join(game, 'UnX_Booster.ini')), original);
  await assert.rejects(fs.stat(path.join(game, 'unx.dll')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(game, 'dxgi.dll')), { code: 'ENOENT' });
});

test('an injected write failure rolls back all game files, including overwritten originals', async () => {
  const { game } = await fixture();
  await fs.writeFile(path.join(game, 'unx.dll'), 'previous plugin');
  const originalConfig = Buffer.from('; untouched\n[UnX.Textures]\nInject=false\n');
  await fs.writeFile(path.join(game, 'UnX.ini'), originalConfig);
  installer._test.hooks.beforeWrite = async index => { if (index === 3) throw new Error('simulated disk failure'); };
  await assert.rejects(installer.installOrUpdate(game, {}), { code: 'TRANSACTION_ROLLED_BACK' });
  assert.equal(await fs.readFile(path.join(game, 'unx.dll'), 'utf8'), 'previous plugin');
  assert.deepEqual(await fs.readFile(path.join(game, 'UnX.ini')), originalConfig);
  await assert.rejects(fs.stat(path.join(game, 'dxgi.dll')), { code: 'ENOENT' });
  assert.equal((await installer.listBackups(game))[0].status, 'rolled-back');
});

test('foreign dxgi, running game, invalid settings and changed package files block writes', async () => {
  const { game, payload } = await fixture();
  await fs.writeFile(path.join(game, 'dxgi.dll'), 'foreign ReShade proxy');
  await assert.rejects(installer.installOrUpdate(game), { code: 'INSTALL_CONFLICT' });
  assert.equal(await fs.readFile(path.join(game, 'dxgi.dll'), 'utf8'), 'foreign ReShade proxy');
  await fs.unlink(path.join(game, 'dxgi.dll'));
  installer._test.hooks.stopped = async () => { throw new installer.ServiceError('GAME_RUNNING', 'Close the game.'); };
  await assert.rejects(installer.installOrUpdate(game), { code: 'GAME_RUNNING' });
  installer._test.hooks.stopped = async () => {};
  await assert.rejects(installer.saveSettings(game, { 'input.keyboard.speed': 'A'.repeat(128) }), { code: 'INVALID_SETTING' });
  await assert.rejects(installer.saveSettings(game, { 'input.controller.speed': 'Guide+A' }), { code: 'INVALID_SETTING' });
  await assert.rejects(installer.saveSettings(game, { 'sk.input.slotReassignment': '0,0,1,2' }), { code: 'INVALID_SETTING' });
  await assert.rejects(installer.saveSettings(game, { unknown: true }), { code: 'UNKNOWN_SETTING' });
  await fs.appendFile(path.join(payload, 'payload.zip'), 'corruption');
  await assert.rejects(loadPayload(payload), { code: 'PAYLOAD_INTEGRITY' });
});

test('ZIP extra entries and symlink descendants cannot escape the installation', async t => {
  const { game, root, payload, files } = await fixture();
  await writePayload(payload, files, 'not-allowed.txt');
  await assert.rejects(loadPayload(payload), { code: 'PAYLOAD_INTEGRITY' });
  await assert.rejects(contained(game, '../escape'), { code: 'UNSAFE_PATH' });
  await assert.rejects(contained(game, '/absolute'), { code: 'UNSAFE_PATH' });
  const outside = path.join(root, 'outside');
  await fs.mkdir(outside);
  try { await fs.symlink(outside, path.join(game, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.diagnostic('Symlink privilege unavailable; traversal checks still ran.'); return; } throw error; }
  await assert.rejects(contained(game, 'linked/file.ini'), { code: 'SYMLINK_TARGET' });
});

test('Proton changes only per-game AppDefaults, preserves other registry sections and restores byte-exact backup', async () => {
  const { game, root } = await fixture();
  const prefix = path.join(root, 'prefix');
  await fs.mkdir(prefix);
  const original = Buffer.from('WINE REGISTRY Version 2\n\n[Software\\\\Wine\\\\DllOverrides]\n"other"="builtin"\n\n[Software\\\\Other]\n"setting"="keep"\n');
  await fs.writeFile(path.join(prefix, 'user.reg'), original);
  Object.assign(installer._test.hooks, { platform: 'linux', prefix });
  await installer.installOrUpdate(game, {});
  const registry = await fs.readFile(path.join(prefix, 'user.reg'));
  assert.equal(installer._test.hasProtonOverrides(registry), true);
  assert.match(registry.toString(), /"other"="builtin"/);
  assert.match(registry.toString(), /"setting"="keep"/);
  assert.equal((registry.toString().match(/"dxgi"=/g) || []).length, 3);
  await installer.uninstall(game);
  assert.deepEqual(await fs.readFile(path.join(prefix, 'user.reg')), original);
});

test('Steam discovers multiple libraries from VDF manifests and validates the app ID', async () => {
  const { game, root } = await fixture();
  const steamRoot = path.join(root, 'steam');
  const library = path.join(root, 'second library');
  const gameDir = path.join(library, 'steamapps', 'common', 'FFX test');
  await fs.mkdir(path.join(steamRoot, 'steamapps'), { recursive: true });
  await fs.mkdir(gameDir, { recursive: true });
  await fs.copyFile(path.join(game, 'FFX.exe'), path.join(gameDir, 'FFX.exe'));
  await fs.copyFile(path.join(game, 'FFX-2.exe'), path.join(gameDir, 'FFX-2.exe'));
  const escaped = library.replace(/\\/g, '\\\\');
  await fs.writeFile(path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders" { "1" { "path" "${escaped}" } }`);
  await fs.writeFile(path.join(library, 'steamapps', 'appmanifest_359870.acf'), '"AppState" { "appid" "359870" "installdir" "FFX test" "buildid" "25501027" }');
  const found = await steam.discoverInstallations([steamRoot]);
  assert.equal(found.length, 1);
  assert.equal(found[0].path, await fs.realpath(gameDir));
  assert.equal((await steam.installationInfo(gameDir)).buildId, '25501027');
  await fs.writeFile(path.join(library, 'steamapps', 'appmanifest_359870.acf'), '"AppState" { "appid" "999" "installdir" "FFX test" }');
  await assert.rejects(steam.installationInfo(gameDir), { code: 'STEAM_APP_MISMATCH' });
});

test('applying the displayed default repairs an invalid INI value and preserves custom selections', async () => {
  const { game } = await fixture();
  await fs.writeFile(path.join(game, 'UnX_Booster.ini'), '[SpeedHack.FFX]\nMaxSpeed=not-a-number\n');
  await fs.writeFile(path.join(game, 'UnX_Language.ini'), '[Language.Master]\nVoice=en\n');
  const loaded = await installer.loadSettings(game);
  assert.equal(loaded.values['gameplay.maxSpeed'], 8);
  assert.equal(loaded.values['language.voice'], 'en');
  assert.ok(loaded.warnings.some(item => item.code === 'INVALID_EXISTING_VALUE'));
  await installer.saveSettings(game, { 'gameplay.maxSpeed': 8, 'language.voice': 'en' });
  assert.match(await fs.readFile(path.join(game, 'UnX_Booster.ini'), 'utf8'), /MaxSpeed=8/);
  assert.equal(await fs.readFile(path.join(game, 'UnX_Language.ini'), 'utf8'), '[Language.Master]\nVoice=en\n');
});

test('inspection verifies required files, tolerates customized assets and detects a modified runtime', async () => {
  const { game } = await fixture();
  await installer.installOrUpdate(game);
  assert.equal((await installer.inspectInstallation(game)).upToDate, true);
  await fs.writeFile(path.join(game, 'UnX_Res', 'Icons', 'sample.dds'), 'custom resource');
  let inspected = await installer.inspectInstallation(game);
  assert.equal(inspected.upToDate, true);
  assert.deepEqual(inspected.integrity.modified, ['UnX_Res/Icons/sample.dds']);
  await fs.unlink(path.join(game, 'UnX_Res', 'Icons', 'sample.dds'));
  inspected = await installer.inspectInstallation(game);
  assert.equal(inspected.upToDate, false);
  assert.deepEqual(inspected.integrity.missing, ['UnX_Res/Icons/sample.dds']);
  await fs.writeFile(path.join(game, 'unx.dll'), 'changed plugin');
  inspected = await installer.inspectInstallation(game);
  assert.deepEqual(inspected.integrity.criticalModified, ['unx.dll']);
});

test('updates retain the original baseline for existing and newly added package files', async () => {
  const { game, payload, files } = await fixture();
  await fs.writeFile(path.join(game, 'unx.dll'), 'legacy plugin before manager');
  await installer.installOrUpdate(game);
  files.set('unx.dll', Buffer.from('synthetic plugin v2'));
  files.set('UnX_Res/new-resource.bin', Buffer.from('new file only in update'));
  await writePayload(payload, files);
  await installer.installOrUpdate(game);
  assert.equal(await fs.readFile(path.join(game, 'unx.dll'), 'utf8'), 'synthetic plugin v2');
  await installer.uninstall(game);
  assert.equal(await fs.readFile(path.join(game, 'unx.dll'), 'utf8'), 'legacy plugin before manager');
  await assert.rejects(fs.stat(path.join(game, 'UnX_Res', 'new-resource.bin')), { code: 'ENOENT' });
});

test('an interrupted journal is actionable and restoring it clears the interruption status', async () => {
  const { game } = await fixture();
  const result = await installer.installOrUpdate(game);
  const journal = path.join(game, '.unx-manager', 'backups', result.backupId, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(journal, 'utf8'));
  manifest.status = 'prepared';
  await fs.writeFile(journal, JSON.stringify(manifest));
  await fs.writeFile(path.join(game, 'unx.dll'), 'partially written after interrupted update');
  assert.ok((await installer.inspectInstallation(game)).warnings.some(item => item.code === 'UNFINISHED_TRANSACTION'));
  await assert.rejects(installer.installOrUpdate(game), { code: 'UNFINISHED_TRANSACTION' });
  await assert.rejects(installer.saveSettings(game, { 'gameplay.maxSpeed': 2 }), { code: 'UNFINISHED_TRANSACTION' });
  await installer.restoreBackup(game, result.backupId);
  assert.equal(JSON.parse(await fs.readFile(journal, 'utf8')).status, 'restored');
  assert.ok(!(await installer.inspectInstallation(game)).warnings.some(item => item.code === 'UNFINISHED_TRANSACTION'));
  await assert.rejects(fs.stat(path.join(game, 'unx.dll')), { code: 'ENOENT' });
});

test('uninstall preserves externally modified files and rejects the operation before any write', async () => {
  const { game } = await fixture();
  await installer.installOrUpdate(game);
  const config = '; external custom edit\n[SpecialK.System]\nLogLevel=4\n';
  await fs.writeFile(path.join(game, 'dxgi.ini'), config);
  await assert.rejects(installer.uninstall(game), { code: 'MODIFIED_FILE' });
  assert.equal(await fs.readFile(path.join(game, 'dxgi.ini'), 'utf8'), config);
  assert.equal(await fs.readFile(path.join(game, 'unx.dll'), 'utf8'), 'synthetic plugin v1');
});

test('malformed Proton registry blocks installation and normal Wine updates survive uninstall', async () => {
  const { game, root } = await fixture();
  const prefix = path.join(root, 'proton');
  await fs.mkdir(prefix);
  const registry = path.join(prefix, 'user.reg');
  await fs.writeFile(registry, 'not a Wine registry\n');
  Object.assign(installer._test.hooks, { platform: 'linux', prefix });
  await assert.rejects(installer.installOrUpdate(game), { code: 'PROTON_REGISTRY_INVALID' });
  await assert.rejects(fs.stat(path.join(game, 'unx.dll')), { code: 'ENOENT' });
  await fs.writeFile(registry, 'WINE REGISTRY Version 2\n\n[broken section\n');
  await assert.rejects(installer.installOrUpdate(game), { code: 'PROTON_REGISTRY_INVALID' });
  await fs.writeFile(registry, 'WINE REGISTRY Version 2\n\n[Software\\\\Other]\n"setting"="before"\n');
  await installer.installOrUpdate(game);
  const afterPlay = (await fs.readFile(registry, 'utf8')).replace('"setting"="before"', '"setting"="after gameplay"');
  await fs.writeFile(registry, afterPlay);
  await installer.uninstall(game);
  const removed = await fs.readFile(registry, 'utf8');
  assert.match(removed, /"setting"="after gameplay"/);
  assert.doesNotMatch(removed, /"dxgi"=/);
});

test('controller combinations are serialized without spaces that the legacy parser cannot read', async () => {
  const { game } = await fixture();
  await installer.saveSettings(game, { 'input.controller.speed': 'Select + L2 + Cross' });
  const file = ini.parse(await fs.readFile(path.join(game, 'UnX_Gamepad.ini')));
  assert.equal(ini.get(file, 'Gamepad.PC', 'SpeedBoost'), 'Select+L2+Cross');
});

test('restoring an older settings backup preserves ownership of later changes in other files and DLL updates', async () => {
  const { game, payload, files } = await fixture();
  await installer.installOrUpdate(game);
  const first = await installer.saveSettings(game, { 'gameplay.maxSpeed': 4 });
  await installer.saveSettings(game, { 'language.voice': 'us' });
  files.set('unx.dll', Buffer.from('later synthetic DLL version'));
  await writePayload(payload, files);
  await installer.installOrUpdate(game);
  await installer.restoreBackup(game, first.backupId);
  assert.equal((await installer.loadSettings(game)).values['gameplay.maxSpeed'], 8);
  assert.equal((await installer.loadSettings(game)).values['language.voice'], 'us');
  assert.equal(await fs.readFile(path.join(game, 'unx.dll'), 'utf8'), 'later synthetic DLL version');
  await installer.uninstall(game);
  await assert.rejects(fs.stat(path.join(game, 'unx.dll')), { code: 'ENOENT' });
});

test('a saved backup can repair a damaged manager record', async () => {
  const { game } = await fixture();
  await installer.installOrUpdate(game);
  const saved = await installer.saveSettings(game, { 'gameplay.maxSpeed': 4 });
  await fs.writeFile(path.join(game, '.unx-manager', 'state.json'), '{broken');
  assert.ok((await installer.inspectInstallation(game)).warnings.some(item => item.code === 'STATE_DAMAGED'));
  assert.ok((await installer.listBackups(game)).length >= 2);
  await installer.restoreBackup(game, saved.backupId);
  assert.equal((await installer.loadSettings(game)).values['gameplay.maxSpeed'], 8);
  await installer.uninstall(game);
});

test('Win32 prerequisite checks reject DLLs with only an x64 PE header', async () => {
  const { game, root } = await fixture();
  await installer.installOrUpdate(game);
  const runtimeDirectory = path.join(root, 'runtimes');
  await fs.mkdir(runtimeDirectory);
  installer._test.hooks.runtimeLocations = [runtimeDirectory];
  const executable = await fs.readFile(path.join(game, 'FFX.exe'));
  const x64 = Buffer.from(executable);
  x64.writeUInt16LE(0x8664, 84);
  for (const name of ['D3DCompiler_43.dll', 'd3dx9_43.dll', 'MSVCP140.dll', 'CONCRT140.dll', 'VCOMP140.dll', 'VCRUNTIME140.dll']) {
    await fs.writeFile(path.join(runtimeDirectory, name), x64);
  }
  assert.ok((await installer.inspectInstallation(game)).warnings.some(item => item.code === 'RUNTIME_DEPENDENCIES'));
  for (const name of await fs.readdir(runtimeDirectory)) await fs.writeFile(path.join(runtimeDirectory, name), executable);
  assert.ok(!(await installer.inspectInstallation(game)).warnings.some(item => item.code === 'RUNTIME_DEPENDENCIES'));
});

test('Linux case aliases of managed proxy DLLs are rejected before installing duplicate Wine names', async () => {
  const { game } = await fixture();
  installer._test.hooks.platform = 'linux';
  await fs.writeFile(path.join(game, 'DXGI.DLL'), 'foreign upper-case proxy');
  const inspected = await installer.inspectInstallation(game);
  assert.ok(inspected.conflicts.some(conflict => conflict.code === 'CASE_ALIAS' && conflict.path === 'DXGI.DLL'));
  await assert.rejects(installer.installOrUpdate(game), { code: 'INSTALL_CONFLICT' });
  assert.equal(await fs.readFile(path.join(game, 'DXGI.DLL'), 'utf8'), 'foreign upper-case proxy');
  await assert.rejects(fs.stat(path.join(game, 'unx.dll')), { code: 'ENOENT' });
});
