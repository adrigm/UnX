'use strict';

const api = window.unx;
const $ = (id) => document.getElementById(id);
const state = { schema: { categories: [], settings: [] }, values: {}, saved: {}, page: 'setup', search: '', gameDir: '', inspection: null, candidates: [], backups: [], busy: false, platform: '', payloadAvailable: false, settingsWarnings: [] };
const pageIcons = { setup: '◈', gameplay: '⌁', languages: '文', input: '⌘', display: '▣', textures: '▧', advanced: '⚙', maintenance: '↺' };
const categoryNames = { input: 'Controls', display: 'Display & audio' };
let lastWorkspaceState = '';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, className, action, disabled = false) {
  const node = element('button', className, text);
  node.type = 'button'; node.disabled = disabled || state.busy;
  node.addEventListener('click', action);
  return node;
}
function notice(message, type = '') {
  $('notice').textContent = message; $('notice').className = `notice ${type}`; $('notice').hidden = !message;
}
function messageOf(error) { return String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); }
function dirty() { return state.schema.settings.some((setting) => state.values[setting.id] !== state.saved[setting.id]); }
function installed() { return Boolean(state.inspection?.installed); }
function needsInstall() { return !installed() || state.inspection?.upToDate !== true || !state.inspection?.managed || Boolean(state.inspection?.proton && !state.inspection.proton.configured); }
function valid() { return Boolean(state.inspection && state.inspection.valid !== false && state.inspection.installation?.valid !== false); }
function warnings() {
  return [...(state.inspection?.conflicts || []), ...(state.inspection?.warnings || []), ...state.settingsWarnings].map((warning) => typeof warning === 'string' ? warning : warning.message).filter(Boolean);
}
function titleFor(id) { return categoryNames[id] || state.schema.categories.find((category) => category.id === id)?.label || id; }
function settingUnavailable(setting) { return state.platform === 'linux' && setting.id === 'textures.cache'; }
function defaultValue(setting) { return settingUnavailable(setting) ? false : setting.default; }
function controlValue(setting) { return settingUnavailable(setting) ? false : state.values[setting.id] ?? setting.default; }
function defaults() { return Object.fromEntries(state.schema.settings.map((setting) => [setting.id, defaultValue(setting)])); }
function refreshFooter() {
  const changed = dirty();
  $('save-dot').className = `save-dot ${changed ? 'dirty' : installed() ? 'saved' : ''}`;
  $('save-title').textContent = changed ? 'Unapplied changes' : state.inspection?.readyToPlay ? 'Settings saved' : installed() ? 'Installation needs attention' : 'UnX is not installed';
  $('save-note').textContent = state.busy ? 'Please keep the app open until this operation finishes.' : changed ? 'Apply your changes before starting the game.' : installed() && !state.inspection?.readyToPlay ? 'Review the installation notes and finish setup.' : installed() ? 'Close the game before changing its configuration.' : 'Choose your preferences, then install UnX.';
  $('apply-settings').textContent = !installed() ? 'Install & apply settings' : needsInstall() ? 'Update & apply settings' : 'Apply settings';
  $('apply-settings').disabled = state.busy || !valid() || (needsInstall() && !state.payloadAvailable);
  $('play-game').disabled = state.busy || !valid() || !installed() || changed || state.inspection?.readyToPlay === false;
  $('reset-page').disabled = state.busy || ['setup', 'maintenance'].includes(state.page) || Boolean(state.search);
  $('open-folder').disabled = state.busy || !valid();
  for (const id of ['browse-folder', 'detect-folders', 'inspect-folder', 'game-folder']) $(id).disabled = state.busy;
  document.querySelectorAll('[data-setting], #navigation button').forEach((node) => {
    node.disabled = state.busy || (state.platform === 'linux' && node.getAttribute('data-setting') === 'textures.cache');
  });
  const workspaceState = { dirty: changed, busy: state.busy };
  if (JSON.stringify(workspaceState) !== lastWorkspaceState) {
    lastWorkspaceState = JSON.stringify(workspaceState);
    api.setWorkspaceState(workspaceState).catch(() => {});
  }
}
async function run(label, work) {
  if (state.busy) return;
  state.busy = true; $('busy-label').textContent = label; $('busy-progress').hidden = false; refreshFooter();
  try { return await work(); }
  catch (error) { notice(messageOf(error), 'error'); }
  finally { state.busy = false; $('busy-progress').hidden = true; refreshFooter(); }
}
async function confirmAction(title, text, actionLabel) {
  $('confirmation-title').textContent = title; $('confirmation-text').textContent = text; $('confirmation-submit').textContent = actionLabel;
  const dialog = $('confirmation');
  return new Promise((resolve) => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }); dialog.showModal(); });
}
function renderNavigation() {
  const navigation = $('navigation'); navigation.replaceChildren();
  const pages = [{ id: 'setup', label: 'Setup & installation' }, ...state.schema.categories.map((category) => ({ ...category, label: titleFor(category.id) })), { id: 'maintenance', label: 'Backups & tools' }];
  for (const page of pages) {
    if (page.id === 'maintenance') navigation.append(element('div', 'nav-divider'));
    const node = button('', state.page === page.id && !state.search ? 'active' : '', () => selectPage(page.id));
    node.append(element('span', 'nav-icon', pageIcons[page.id] || '◇'), element('span', '', page.label));
    const count = state.schema.settings.filter((setting) => setting.category === page.id).length;
    if (count) node.append(element('span', 'nav-count', String(count)));
    if (state.page === page.id && !state.search) node.setAttribute('aria-current', 'page');
    navigation.append(node);
  }
}
function selectPage(page) {
  state.page = page; state.search = ''; $('search').value = ''; notice(''); renderPage();
  window.scrollTo(0, 0);
  if (page === 'maintenance' && valid()) loadMaintenance();
}
function updateDestination() {
  const info = state.inspection;
  const isValid = valid();
  $('game-folder').value = state.gameDir;
  $('install-status').className = `status ${!info ? 'neutral' : !isValid ? 'bad' : info.readyToPlay ? 'good' : 'warning'}`;
  $('install-status').textContent = !info ? 'Waiting for a folder' : !isValid ? 'Game folder not found' : info.readyToPlay ? 'Ready to play' : installed() ? 'Update / repair needed' : 'Ready to install';
  $('folder-note').textContent = !info ? 'Select a folder or scan your Steam libraries.' : !isValid ? 'Choose the game root folder containing FFX.exe and FFX-2.exe.' : state.platform === 'linux' ? 'Steam / Proton · App 359870' : 'Steam edition · Final Fantasy X/X-2 HD Remaster';
  const choices = $('discovered-folders'); choices.replaceChildren();
  for (const candidate of state.candidates) {
    const option = element('option', '', candidate.label || candidate.path); option.value = candidate.path; option.selected = candidate.path === state.gameDir; choices.append(option);
  }
  choices.hidden = state.candidates.length < 2;
  refreshFooter();
}
async function refreshFolder(gameDir) {
  state.gameDir = gameDir; state.inspection = null; state.settingsWarnings = []; updateDestination();
  state.inspection = await api.inspect(gameDir);
  if (valid()) {
    const loaded = await api.loadSettings(gameDir);
    state.settingsWarnings = loaded.warnings || [];
    state.values = { ...defaults(), ...(loaded.values || loaded) }; state.saved = { ...state.values };
    state.backups = await api.listBackups(gameDir);
  }
  updateDestination(); renderPage();
}
async function chooseFolder(gameDir) {
  if (!gameDir) return;
  if (dirty() && !await confirmAction('Switch game folder?', 'Unapplied changes in this workspace will be discarded.', 'Switch folder')) return;
  await run('Checking game files and loading your configuration…', async () => {
    notice(''); await refreshFolder(gameDir);
    if (!valid()) notice('This folder does not contain a supported Final Fantasy X/X-2 HD Remaster installation.', 'error');
  });
}
function sectionTitle(title, subtitle, right) {
  const wrapper = element('div', 'section-title'); const copy = element('div');
  copy.append(element('h2', '', title)); if (subtitle) copy.append(element('p', '', subtitle)); wrapper.append(copy);
  if (right) wrapper.append(element('span', 'small-label', right));
  return wrapper;
}
function checkList(items) {
  const list = element('ul', 'check-list');
  for (const item of items) {
    const row = element('li'); row.append(element('span', item.warning ? 'warn' : 'check', item.warning ? '!' : '✓'), element('span', '', item.text || item)); list.append(row);
  }
  return list;
}
function summaryLine(label, value) {
  const line = element('div', 'summary-line'); line.append(element('span', '', label), element('strong', '', value)); return line;
}
function renderSetup(content) {
  const grid = element('div', 'setup-grid');
  const installation = element('article', 'panel');
  const game = element('div', 'install-illustration'); const copy = element('div', 'game-description');
  copy.append(element('strong', '', 'Final Fantasy X / X-2 HD Remaster'));
  game.append(element('div', 'game-tile', 'X'), copy); installation.append(game);
  installation.append(element('h2', '', state.inspection?.readyToPlay ? 'UnX is installed' : installed() ? 'Update or repair UnX' : 'Install UnX'));
  installation.append(element('p', '', installed() ? 'Edit settings in the sidebar, then apply your changes.' : 'Select the game folder, configure your settings, then click Install & apply settings.'));
  installation.append(checkList([
    'Complete mod package included — works offline',
    'Automatic backups before changes',
    'Existing texture mods and custom settings preserved'
  ]));
  grid.append(installation);
  const overview = element('article', 'panel'); overview.append(element('h2', '', 'Installation details'));
  overview.append(summaryLine('Platform', state.platform === 'linux' ? 'Linux · Steam / Proton' : 'Windows · Steam'), summaryLine('Mod version', '0.10.0'), summaryLine('Offline package', state.payloadAvailable ? 'Included' : 'Not prepared'), summaryLine('Backup protection', 'Automatic'), summaryLine('Configuration', `${state.schema.settings.length} available settings`));
  const warningItems = warnings();
  if (warningItems.length) { const list = element('ul', 'warning-list'); for (const warning of warningItems) list.append(element('li', '', warning)); overview.append(list); }
  if (!state.payloadAvailable) overview.append(element('p', 'footnote', 'The developer payload has not been prepared. Build the bundled runtime before installing.'));
  grid.append(overview); content.append(grid);
}
function changeSetting(setting, value, card) {
  if (settingUnavailable(setting)) return;
  state.values[setting.id] = value;
  card.classList.toggle('modified', value !== state.saved[setting.id]);
  const marker = card.querySelector('.modified-mark'); if (marker) marker.hidden = value === state.saved[setting.id];
  refreshFooter();
}
function renderSetting(setting) {
  const value = controlValue(setting);
  const card = element('div', `setting-card${value !== state.saved[setting.id] ? ' modified' : ''}`);
  const heading = element('div', 'setting-heading'); const copy = element('div', 'setting-copy'); const label = element('label', 'setting-label', setting.label);
  label.htmlFor = `setting-${setting.id}`;
  if (setting.advanced) label.append(element('span', 'mini-tag', 'Advanced'));
  copy.append(label, element('p', 'setting-help', settingUnavailable(setting)
    ? 'Unavailable under Proton: the legacy texture cache can crash at startup. It stays disabled when settings are applied. Texture injection remains available.'
    : setting.description)); heading.append(copy); card.append(heading);
  let control;
  if (setting.type === 'boolean') {
    const toggle = element('label', 'toggle'); control = element('input'); control.type = 'checkbox'; control.checked = Boolean(value);
    toggle.append(control, element('span', 'toggle-track')); heading.append(toggle);
    control.addEventListener('change', () => changeSetting(setting, control.checked, card));
  } else {
    const wrapper = element('div', 'setting-control');
    if (setting.type === 'select') {
      control = element('select');
      for (const item of setting.options || []) {
        const optionValue = typeof item === 'object' ? item.value : item;
        const option = element('option', '', typeof item === 'object' ? item.label : String(item)); option.value = String(optionValue); control.append(option);
      }
      if (![...control.options].some((option) => option.value === String(value))) {
        const option = element('option', '', `Current value (${String(value) || 'empty'})`); option.value = String(value); control.append(option);
      }
      control.value = String(value);
      control.addEventListener('change', () => {
        const item = (setting.options || []).find((option) => String(typeof option === 'object' ? option.value : option) === control.value);
        changeSetting(setting, typeof item === 'object' ? item.value : control.value, card);
      });
    } else {
      control = element('input'); control.type = setting.type === 'number' ? 'number' : 'text'; control.value = value;
      control.spellcheck = false;
      if (setting.type === 'number') {
        if (setting.min !== undefined) control.min = setting.min;
        if (setting.max !== undefined) control.max = setting.max;
        control.step = setting.step ?? 'any';
      }
      control.addEventListener('input', () => changeSetting(setting, setting.type === 'number' ? Number(control.value) : control.value, card));
    }
    wrapper.append(control); card.append(wrapper);
  }
  control.id = `setting-${setting.id}`; control.setAttribute('data-setting', setting.id); control.disabled = state.busy || settingUnavailable(setting);
  control.setAttribute('aria-describedby', `help-${setting.id}`); copy.querySelector('.setting-help').id = `help-${setting.id}`;
  const meta = element('div', 'setting-meta');
  if (setting.restartRequired) meta.append(element('span', '', 'Applied next time you start the game'));
  const marker = element('span', 'modified-mark', 'MODIFIED'); marker.hidden = value === state.saved[setting.id]; meta.append(marker); card.append(meta);
  return card;
}
function applyPreset(kind) {
  const set = (key, value, section) => {
    for (const setting of state.schema.settings) if (setting.key === key && (!section || setting.section === section)) state.values[setting.id] = value;
  };
  if (kind === 'recommended') {
    set('EntirePartyEarnsAP', false); set('GrantPermanentSensor', false); set('PlayableSeymour', false);
    set('MaxSpeed', 8); set('SpeedStep', 2); set('SkipDialogAtSpeed', 8); set('DisableTimingHacks', false); set('BypassIntel', false);
  } else if (kind === 'party') set('EntirePartyEarnsAP', true);
  else if (kind === 'japanese') set('Voice', 'jp');
  else if (kind === 'english') set('Voice', 'us');
  renderPage(); notice('Preset applied to the workspace. Apply settings to save it to the game.');
}
function renderSettings(content) {
  const search = state.search.trim().toLowerCase();
  const matching = state.schema.settings.filter((setting) => search ? [setting.label, setting.description, setting.section, setting.key].join(' ').toLowerCase().includes(search) : setting.category === state.page);
  if (!search && ['gameplay', 'languages'].includes(state.page)) {
    const presets = element('div', 'presets');
    const items = state.page === 'gameplay' ? [['recommended', '↺ Recommended defaults'], ['party', '+ Full-party AP']] : [['english', 'English voices'], ['japanese', 'Japanese voices']];
    for (const [id, label] of items) presets.append(button(label, 'preset-button', () => applyPreset(id)));
    content.append(presets);
  }
  if (!matching.length) { content.append(element('div', 'empty-state', 'No settings match your search. Try “voice”, “speed”, “controller” or an INI key.')); return; }
  const groups = search ? state.schema.categories.filter((category) => matching.some((setting) => setting.category === category.id)) : [{ id: state.page, label: titleFor(state.page) }];
  for (const group of groups) {
    const fields = matching.filter((setting) => setting.category === group.id);
    if (search) content.append(sectionTitle(titleFor(group.id), `${fields.length} matching settings`));
    const grid = element('div', 'settings-grid'); for (const setting of fields) grid.append(renderSetting(setting)); content.append(grid);
  }
}
async function loadMaintenance() {
  try { state.backups = await api.listBackups(state.gameDir); if (state.page === 'maintenance') renderPage(); }
  catch (error) { notice(messageOf(error), 'error'); }
}
function renderMaintenance(content) {
  const grid = element('div', 'maintenance-grid');
  const repair = element('article', 'panel'); repair.append(element('h2', '', 'Repair installation'), element('p', '', 'Restore the bundled, verified UnX files and keep the configuration you have chosen. A backup is created automatically.'));
  repair.append(button('Repair / reinstall UnX', 'button secondary', () => installOrSave(true), !valid() || !state.payloadAvailable));
  repair.append(button('Verify files', 'button subtle', () => run('Verifying the installation…', async () => { state.inspection = await api.inspect(state.gameDir); updateDestination(); renderPage(); notice(warnings().join('\n') || 'The installation check completed successfully.', warnings().length ? 'warning' : ''); }), !valid())); grid.append(repair);
  const diagnostic = element('article', 'panel'); diagnostic.append(element('h2', '', 'Diagnostics & game'), element('p', '', 'Export a local report to troubleshoot an installation. Reports stay on your computer and are never uploaded.'));
  diagnostic.append(button('Export diagnostics', 'button secondary', () => run('Preparing your diagnostic report…', async () => { const result = await api.exportDiagnostics(state.gameDir); if (!result?.canceled) notice('Diagnostic report exported successfully.'); }), !valid()));
  const launch = element('div', 'play-selector'); const target = element('select'); target.setAttribute('aria-label', 'Game to launch');
  const launchTargets = state.platform === 'linux' ? [['launcher', 'Steam game launcher']] : [['launcher', 'Steam game launcher'], ['ffx', 'Final Fantasy X'], ['ffx2', 'Final Fantasy X-2'], ['will', 'Final Fantasy X / X-2: Will']];
  for (const [value, label] of launchTargets) { const option = element('option', '', label); option.value = value; target.append(option); }
  launch.append(target, button('Play', 'button subtle', () => launchGame(target.value), !valid() || !installed() || dirty() || state.inspection?.readyToPlay !== true)); diagnostic.append(element('p', 'footnote', 'On Linux, games start through Steam and its selected Proton version.'), launch); grid.append(diagnostic); content.append(grid);
  content.append(sectionTitle('Restore points', 'Installations and settings changes create local backups automatically.', 'RECOVERY'));
  const backups = element('article', 'panel');
  const items = Array.isArray(state.backups) ? state.backups : state.backups.backups || [];
  if (!items.length) backups.append(element('p', '', 'No restore points yet. Your first backup is created when you apply a change.'));
  for (const backup of items.slice(0, 12)) {
    const row = element('div', 'backup-row'); const copy = element('div', 'backup-copy');
    const timestamp = backup.createdAt || backup.timestamp || backup.id;
    const date = new Date(timestamp); const label = Number.isNaN(date.valueOf()) ? String(timestamp) : date.toLocaleString('en-GB');
    copy.append(element('strong', '', label), element('small', '', backup.reason || backup.operation || 'UnX restore point'));
    row.append(copy, button('Restore', 'button subtle', async () => {
      if (!await confirmAction('Restore this backup?', 'This replaces the mod files and configuration covered by the selected restore point. Close the game before continuing.', 'Restore backup')) return;
      await run('Restoring the selected backup…', async () => { await api.restoreBackup(state.gameDir, backup.id); await refreshFolder(state.gameDir); notice('The selected backup was restored.'); });
    })); backups.append(row);
  }
  content.append(backups);
  const uninstall = element('article', 'panel'); uninstall.style.marginTop = '18px'; uninstall.append(element('h2', '', 'Remove UnX'), element('p', '', 'Remove files managed by this installer and restore the files they replaced. Game data and save files are kept.'));
  uninstall.append(button('Uninstall UnX', 'button danger', async () => {
    if (!await confirmAction('Uninstall UnX?', 'The installer will remove the mod files it manages and restore the original files from its installation backup. Your game and saves will be kept.', 'Uninstall')) return;
    await run('Removing managed UnX files…', async () => { await api.uninstall(state.gameDir); await refreshFolder(state.gameDir); notice('UnX was removed. Your game files and saves were kept.'); });
  }, !valid() || !installed())); content.append(uninstall);
  api.getLogs().then((logs) => {
    if (state.page !== 'maintenance' || !logs.length || !content.isConnected) return;
    content.append(sectionTitle('Recent activity', 'Operations performed during this app session.'));
    const panel = element('div', 'panel'); for (const item of logs.slice(0, 8)) { const row = element('div', `activity-row${item.ok ? '' : ' bad'}`); row.append(element('time', '', new Date(item.at).toLocaleTimeString('en-GB')), element('span', '', `${item.action.replaceAll('-', ' ')}${item.detail ? ': ' + item.detail : ' · completed'}`)); panel.append(row); } content.append(panel);
  }).catch(() => {});
}
function renderPage() {
  renderNavigation();
  const searching = Boolean(state.search.trim()); const category = state.schema.categories.find((item) => item.id === state.page);
  $('eyebrow').textContent = 'UNX MANAGER';
  $('page-title').textContent = searching ? 'Search settings' : state.page === 'setup' ? 'Setup & installation' : state.page === 'maintenance' ? 'Backups & tools' : titleFor(state.page);
  $('page-description').textContent = searching ? `Search all ${state.schema.settings.length} settings.` : category?.description || (state.page === 'setup' ? 'Install and configure UnX for Final Fantasy X / X-2 HD Remaster.' : 'Repair, restore or remove UnX.');
  $('breadcrumb').replaceChildren(document.createTextNode('Workspace '), element('span', '', '/'), document.createTextNode(searching ? ' Search' : state.page === 'setup' ? ' Setup' : ' ' + titleFor(state.page)));
  const content = $('content'); content.replaceChildren();
  if (searching) renderSettings(content);
  else if (state.page === 'setup') renderSetup(content);
  else if (state.page === 'maintenance') renderMaintenance(content);
  else renderSettings(content);
  refreshFooter();
}
async function installOrSave(forceInstall = false) {
  if (!valid()) return;
  if (!document.querySelector('[data-setting]:invalid')) {
    const install = forceInstall || needsInstall();
    await run(install ? 'Backing up files and installing the verified UnX package…' : 'Backing up and applying your configuration…', async () => {
      notice('');
      const changes = installed() ? Object.fromEntries(state.schema.settings.filter((setting) => state.values[setting.id] !== state.saved[setting.id]).map((setting) => [setting.id, state.values[setting.id]])) : state.values;
      const result = install ? await api.install(state.gameDir, changes) : await api.saveSettings(state.gameDir, changes);
      await refreshFolder(state.gameDir);
      const notes = (result?.warnings || []).map((item) => typeof item === 'string' ? item : item.message).filter(Boolean);
      notice((install ? 'UnX is installed. ' : 'Your settings have been saved. ') + (state.inspection?.readyToPlay === false ? 'Check the installation notes before playing.' : 'You are ready to play.') + (notes.length ? '\n' + notes.join('\n') : ''), notes.length ? 'warning' : '');
    });
  } else {
    const invalid = document.querySelector('[data-setting]:invalid'); invalid.reportValidity(); invalid.focus();
  }
}
async function launchGame(target = 'launcher') {
  if (dirty()) { notice('Apply your pending changes before launching the game.', 'warning'); return; }
  if (state.inspection?.readyToPlay !== true) { notice('Install or repair UnX and resolve the installation notes before playing.', 'warning'); return; }
  await run('Starting the game…', async () => { await api.launchGame(state.gameDir, target); notice('The game is starting.'); });
}
$('browse-folder').addEventListener('click', async () => { try { const folder = await api.chooseFolder(); if (folder) await chooseFolder(folder); } catch (error) { notice(messageOf(error), 'error'); } });
$('inspect-folder').addEventListener('click', () => chooseFolder($('game-folder').value.trim()));
$('game-folder').addEventListener('keydown', (event) => { if (event.key === 'Enter') chooseFolder(event.target.value.trim()); });
$('game-folder').addEventListener('input', () => { state.inspection = null; $('install-status').textContent = 'Check this folder'; $('install-status').className = 'status neutral'; refreshFooter(); });
$('detect-folders').addEventListener('click', async () => {
  if (dirty() && !await confirmAction('Reload the Steam installation?', 'Unapplied settings in this workspace will be discarded when an installation is selected.', 'Scan and reload')) return;
  await run('Searching Steam libraries…', async () => {
  state.candidates = await api.discover(); updateDestination();
  if (!state.candidates.length) notice('No Steam installation was found. Use Browse to select your game folder.', 'warning');
  else { await refreshFolder(state.candidates[0].path); notice(`Found ${state.candidates.length} game installation${state.candidates.length === 1 ? '' : 's'}.`); }
  });
});
$('discovered-folders').addEventListener('change', (event) => chooseFolder(event.target.value));
$('open-folder').addEventListener('click', () => api.openGameFolder(state.gameDir).catch((error) => notice(messageOf(error), 'error')));
$('apply-settings').addEventListener('click', () => installOrSave());
$('play-game').addEventListener('click', () => launchGame());
$('reset-page').addEventListener('click', () => { for (const setting of state.schema.settings.filter((item) => item.category === state.page)) state.values[setting.id] = defaultValue(setting); renderPage(); notice('This page has been reset to its defaults. Apply settings to save the changes.'); });
$('search').addEventListener('input', (event) => { state.search = event.target.value; renderPage(); });
document.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('search').focus(); } });
window.addEventListener('beforeunload', (event) => { if (state.busy) { event.preventDefault(); event.returnValue = false; } });

(async () => {
  try {
    const data = await api.bootstrap(); state.schema = data.schema; state.platform = data.platform; state.payloadAvailable = data.payloadAvailable; state.candidates = data.candidates || [];
    state.values = defaults(); state.saved = { ...state.values };
    $('app-version').textContent = data.appVersion; $('platform-label').textContent = data.platform === 'linux' ? 'Linux · Steam / Proton' : 'Windows · Steam';
    renderPage(); updateDestination();
    const folder = data.lastGameDir || state.candidates[0]?.path;
    if (folder) await run('Checking your Steam installation…', () => refreshFolder(folder));
    else notice('Welcome! Select your game folder to install or configure UnX.');
    const renderedControls = state.schema.settings.map(renderSetting).filter((card) => card.querySelector('[data-setting]')).length;
    await api.reportReady({ settings: state.schema.settings.length, categories: state.schema.categories.length, renderedControls, payloadAvailable: state.payloadAvailable });
  } catch (error) { $('content').replaceChildren(element('div', 'empty-state', 'The workspace could not be loaded.')); notice(messageOf(error), 'error'); api.reportReady({ error: messageOf(error) }).catch(() => {}); }
})();
