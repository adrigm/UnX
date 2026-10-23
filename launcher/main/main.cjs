const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const smokeTest = process.argv.includes('--smoke-test');
if (smokeTest) app.setPath('userData', path.join(require('node:os').tmpdir(), `unx-manager-smoke-${process.pid}`));

protocol.registerSchemesAsPrivileged([{ scheme: 'unx', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const services = require('./services/installer.cjs');
const schema = require('../shared/settings-schema.json');
const rendererRoot = path.resolve(__dirname, '../renderer');
const payloadDir = app.isPackaged ? path.join(process.resourcesPath, 'payload') : path.resolve(__dirname, '../payload');
services.configure({ payloadDir });
let mainWindow;
let operationActive = false;
let workspaceState = { dirty: false, busy: false };
let allowClose = false;
const activity = [];

function record(action, ok, detail = '') {
  activity.unshift({ at: new Date().toISOString(), action, ok, detail });
  activity.splice(60);
}
function handle(channel, fn, mutation = false) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== mainWindow?.webContents || !event.senderFrame?.url.startsWith('unx://app/')) {
      throw new Error('This request did not come from UnX Manager.');
    }
    if (mutation && operationActive) throw new Error('Another operation is in progress. Please wait.');
    if (mutation) operationActive = true;
    try {
      const result = await fn(...args);
      if (mutation) record(channel.replace('unx:', ''), true);
      return result;
    } catch (error) {
      record(channel.replace('unx:', ''), false, String(error.message || error));
      throw new Error(String(error.message || 'The operation could not be completed.').replace(/^Error invoking remote method '[^']+': Error: /, ''));
    } finally {
      if (mutation) operationActive = false;
    }
  });
}
async function rememberedFolder() {
  try { return JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'preferences.json'), 'utf8')).gameDir || ''; }
  catch { return ''; }
}
async function rememberFolder(gameDir) {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(path.join(app.getPath('userData'), 'preferences.json'), JSON.stringify({ gameDir }, null, 2));
}
async function inspect(gameDir) {
  if (typeof gameDir !== 'string' || !gameDir.trim()) throw new Error('Choose the folder that contains FFX.exe.');
  const result = await services.inspectInstallation(gameDir, { payloadDir });
  if (result.valid !== false) await rememberFolder(gameDir);
  return result;
}
function setupIpc() {
  handle('unx:bootstrap', async () => ({
    schema, appVersion: app.getVersion(), platform: process.platform,
    lastGameDir: await rememberedFolder(), candidates: await services.discoverInstallations(),
    payloadAvailable: await fs.access(path.join(payloadDir, 'manifest.json')).then(() => true, () => false)
  }));
  handle('unx:discover', () => services.discoverInstallations());
  handle('unx:choose-folder', async () => {
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: 'Select the Final Fantasy X/X-2 HD Remaster folder',
      buttonLabel: 'Select game folder', properties: ['openDirectory'],
      defaultPath: await rememberedFolder() || undefined
    });
    return selection.canceled ? null : selection.filePaths[0];
  });
  handle('unx:inspect', inspect);
  handle('unx:load-settings', (gameDir) => services.loadSettings(gameDir));
  handle('unx:install', async (gameDir, values) => {
    const result = await services.installOrUpdate(gameDir, values, { payloadDir });
    await rememberFolder(gameDir);
    return result;
  }, true);
  handle('unx:save-settings', (gameDir, values) => services.saveSettings(gameDir, values), true);
  handle('unx:list-backups', (gameDir) => services.listBackups(gameDir));
  handle('unx:restore-backup', (gameDir, id) => services.restoreBackup(gameDir, id), true);
  handle('unx:uninstall', (gameDir) => services.uninstall(gameDir), true);
  handle('unx:export-diagnostics', async (gameDir) => {
    const selection = await dialog.showSaveDialog(mainWindow, {
      title: 'Export installation diagnostics', buttonLabel: 'Export report',
      defaultPath: 'UnX-diagnostics.zip', filters: [{ name: 'Diagnostic archive', extensions: ['zip'] }]
    });
    if (selection.canceled) return { canceled: true };
    return services.exportDiagnostics(gameDir, selection.filePath);
  });
  handle('unx:open-game-folder', async (gameDir) => {
    const result = await inspect(gameDir);
    if (result.valid === false) throw new Error('Select a valid game folder first.');
    const error = await shell.openPath(path.resolve(gameDir));
    if (error) throw new Error(error);
    return true;
  });
  handle('unx:launch-game', async (gameDir, target = 'launcher') => {
    const info = await inspect(gameDir);
    if (info.valid === false) throw new Error('Select a valid game folder first.');
    if (info.readyToPlay !== true) throw new Error('Install or repair UnX and resolve the installation notes before playing.');
    const targets = { launcher: 'FFX&X-2_LAUNCHER.exe', ffx: 'FFX.exe', ffx2: 'FFX-2.exe', will: 'FFX&X-2_Will.exe' };
    if (!Object.hasOwn(targets, target)) throw new Error('Choose a supported game.');
    if (process.platform === 'linux' || target === 'launcher') {
      await shell.openExternal('steam://rungameid/359870');
    } else {
      const executable = path.join(path.resolve(gameDir), targets[target]);
      await fs.access(executable);
      await new Promise((resolve, reject) => {
        const child = spawn(executable, [], { cwd: path.resolve(gameDir), detached: true, stdio: 'ignore', env: { ...process.env, SteamAppId: '359870', SteamGameId: '359870' } });
        child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
      });
    }
    return { launched: true };
  });
  handle('unx:get-logs', () => activity);
  handle('unx:workspace-state', (value) => { workspaceState = { dirty: value?.dirty === true, busy: value?.busy === true }; });
  handle('unx:report-ready', async (report) => {
    if (!smokeTest) return;
    const success = !report?.error && report?.settings === schema.settings.length && report?.categories === schema.categories.length && report?.renderedControls === schema.settings.length;
    const result = { success, platform: process.platform, packaged: app.isPackaged, appVersion: app.getVersion(), ...report };
    console.log('UNX_MANAGER_SMOKE', JSON.stringify(result));
    if (process.env.UNX_SMOKE_REPORT) await fs.writeFile(process.env.UNX_SMOKE_REPORT, JSON.stringify(result, null, 2));
    setTimeout(() => app.exit(success ? 0 : 1), 100);
  });
}
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240, height: 880, minWidth: 1000, minHeight: 700, backgroundColor: '#0c1420',
    title: 'UnX Manager', autoHideMenuBar: true, show: true,
    icon: app.isPackaged ? path.join(process.resourcesPath, 'unx.png') : path.join(__dirname, '../assets/unx.png'),
    webPreferences: { preload: path.join(__dirname, '../preload/preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('unx://app/')) event.preventDefault(); });
  mainWindow.on('close', async (event) => {
    if (allowClose) return;
    if (operationActive || workspaceState.busy) {
      event.preventDefault();
      await dialog.showMessageBox(mainWindow, { type: 'info', title: 'An operation is in progress', message: 'Please wait until the current operation finishes before closing UnX Manager.', buttons: ['Keep open'] });
    } else if (workspaceState.dirty) {
      event.preventDefault();
      const choice = await dialog.showMessageBox(mainWindow, { type: 'question', title: 'Unapplied changes', message: 'Close without applying your settings?', detail: 'Changes in this workspace will be discarded.', buttons: ['Keep editing', 'Discard & close'], defaultId: 0, cancelId: 0 });
      if (choice.response === 1) { allowClose = true; mainWindow.close(); }
    }
  });
  await mainWindow.loadURL('unx://app/index.html');
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(async () => {
    if (smokeTest) setTimeout(() => { console.error('The GUI smoke test timed out.'); app.exit(1); }, 30000).unref();
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    const allowed = new Set(['index.html', 'styles.css', 'app.js', 'logo.svg']);
    protocol.handle('unx', async (request) => {
      const url = new URL(request.url);
      const name = url.pathname.replace(/^\//, '') || 'index.html';
      if (url.hostname !== 'app' || !allowed.has(name)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(path.join(rendererRoot, name)).toString());
    });
    setupIpc(); await createWindow();
  }).catch((error) => { dialog.showErrorBox('UnX Manager could not start', String(error.message)); app.quit(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}
