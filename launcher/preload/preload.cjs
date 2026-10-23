const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('unx', Object.freeze({
  bootstrap: call('unx:bootstrap'),
  discover: call('unx:discover'),
  chooseFolder: call('unx:choose-folder'),
  inspect: call('unx:inspect'),
  loadSettings: call('unx:load-settings'),
  install: call('unx:install'),
  saveSettings: call('unx:save-settings'),
  listBackups: call('unx:list-backups'),
  restoreBackup: call('unx:restore-backup'),
  uninstall: call('unx:uninstall'),
  exportDiagnostics: call('unx:export-diagnostics'),
  openGameFolder: call('unx:open-game-folder'),
  launchGame: call('unx:launch-game'),
  getLogs: call('unx:get-logs'),
  setWorkspaceState: call('unx:workspace-state'),
  reportReady: call('unx:report-ready')
}));
