'use strict';

const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const { ServiceError, contained, relativePath, atomicWrite, readOptional, sha256 } = require('./paths.cjs');
const PRIVATE = '.unx-manager';
const BACKUPS = `${PRIVATE}/backups`;
const locks = new Set();

async function ensureDirectory(root, relative) {
  const target = await contained(root, relative);
  await fs.mkdir(target, { recursive: true });
  return contained(root, relative, { allowMissing: false });
}

async function resolveTarget(roots, change) {
  if (change.scope !== 'game' && change.scope !== 'proton') throw new ServiceError('INVALID_BACKUP', 'The backup has an invalid target.');
  const root = roots[change.scope];
  if (!root) throw new ServiceError('PREFIX_MISSING', 'The Steam Proton prefix is missing. Run the game once and try again.');
  return contained(root, relativePath(change.path));
}

async function writeTarget(roots, change) {
  let file = await resolveTarget(roots, change);
  if (change.data === null) {
    try { await fs.unlink(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return;
  }
  const parent = path.posix.dirname(change.path);
  if (parent !== '.') await ensureDirectory(roots[change.scope], parent);
  file = await resolveTarget(roots, change);
  await atomicWrite(file, change.data, change.mode || 0o600);
}

async function runTransaction(roots, changes, kind, hook = undefined) {
  const key = roots.game;
  if (locks.has(key)) throw new ServiceError('OPERATION_BUSY', 'Another operation is already changing this installation.');
  locks.add(key);
  let backupDirectory;
  let manifest;
  let journal;
  let writesStarted = false;
  try {
    const id = `${new Date().toISOString().replace(/[-:.]/g, '')}-${crypto.randomBytes(4).toString('hex')}`;
    const seen = new Set();
    const planned = [];
    for (const input of changes) {
      const change = { ...input, data: typeof input.data === 'function' ? input.data(id) : input.data };
      relativePath(change.path);
      const identity = `${change.scope}:${change.path.toLowerCase()}`;
      if (seen.has(identity)) throw new ServiceError('DUPLICATE_TARGET', 'The update contains a duplicate target file.');
      seen.add(identity);
      const file = await resolveTarget(roots, change);
      const before = await readOptional(file);
      if (!change.capture && ((before === null && change.data === null) ||
          (before && change.data && before.equals(change.data)))) continue;
      const stat = before === null ? null : await fs.stat(file);
      if (stat && !stat.isFile()) throw new ServiceError('INVALID_TARGET', 'A managed target is not a regular file.');
      planned.push({ ...change, before, mode: stat ? stat.mode & 0o777 : change.mode || 0o600 });
    }
    if (!planned.length) return { changed: false, backupId: null, files: [] };
    await ensureDirectory(roots.game, BACKUPS);
    backupDirectory = await ensureDirectory(roots.game, `${BACKUPS}/${id}`);
    manifest = { schemaVersion: 1, id, kind, createdAt: new Date().toISOString(), status: 'prepared', files: [] };
    for (let index = 0; index < planned.length; index++) {
      const change = planned[index];
      const backupFile = `${String(index).padStart(5, '0')}.bin`;
      if (change.before !== null) await atomicWrite(path.join(backupDirectory, backupFile), change.before);
      manifest.files.push({ scope: change.scope, path: change.path, existed: change.before !== null,
        sha256: change.before === null ? null : sha256(change.before), mode: change.mode,
        backupFile, afterSha256: change.data === null ? null : sha256(change.data) });
    }
    journal = path.join(backupDirectory, 'manifest.json');
    await atomicWrite(journal, Buffer.from(JSON.stringify(manifest, null, 2)));
    writesStarted = true;
    for (let index = 0; index < planned.length; index++) {
      if (hook) await hook(index, planned[index]);
      await writeTarget(roots, planned[index]);
    }
    manifest.status = 'complete';
    await atomicWrite(journal, Buffer.from(JSON.stringify(manifest, null, 2)));
    return { changed: true, backupId: id, files: planned.map(file => ({ scope: file.scope, path: file.path })) };
  } catch (error) {
    if (!writesStarted) throw error;
    const failures = [];
    for (const file of [...manifest.files].reverse()) {
      try {
        const before = file.existed ? await fs.readFile(path.join(backupDirectory, file.backupFile)) : null;
        if (before && sha256(before) !== file.sha256) throw new Error('Backup checksum mismatch.');
        await writeTarget(roots, { scope: file.scope, path: file.path, data: before, mode: file.mode });
      } catch { failures.push(file.path); }
    }
    manifest.status = failures.length ? 'rollback-failed' : 'rolled-back';
    await atomicWrite(journal, Buffer.from(JSON.stringify(manifest, null, 2))).catch(() => {});
    throw new ServiceError(failures.length ? 'ROLLBACK_FAILED' : 'TRANSACTION_ROLLED_BACK',
      failures.length ? 'The update failed and some files could not be restored. Use the saved backup before playing.' :
        'The update failed. All affected files were restored from the backup.',
      { backupId: manifest.id, cause: error.code || error.message, failedFiles: failures });
  } finally { locks.delete(key); }
}

function validBackupId(id) {
  return typeof id === 'string' && /^\d{8}T\d{9}Z-[a-f0-9]{8}$/.test(id);
}

async function readBackup(gameRoot, id) {
  if (!validBackupId(id)) throw new ServiceError('INVALID_BACKUP', 'Choose a valid backup from the list.');
  const directory = await contained(gameRoot, `${BACKUPS}/${id}`, { allowMissing: false });
  const file = await contained(gameRoot, `${BACKUPS}/${id}/manifest.json`, { allowMissing: false });
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.id !== id || !Array.isArray(manifest.files)) {
    throw new ServiceError('INVALID_BACKUP', 'The saved backup manifest is invalid.');
  }
  const seen = new Set();
  const files = [];
  for (const entry of manifest.files) {
    relativePath(entry.path);
    if (!['game', 'proton'].includes(entry.scope) || !/^\d{5}\.bin$/.test(entry.backupFile) ||
        typeof entry.existed !== 'boolean' || !Number.isInteger(entry.mode)) {
      throw new ServiceError('INVALID_BACKUP', 'The saved backup contains an invalid file entry.');
    }
    const identity = `${entry.scope}:${entry.path.toLowerCase()}`;
    if (seen.has(identity)) throw new ServiceError('INVALID_BACKUP', 'The saved backup contains duplicate paths.');
    seen.add(identity);
    let data = null;
    if (entry.existed) {
      const source = await contained(gameRoot, `${BACKUPS}/${id}/${entry.backupFile}`, { allowMissing: false });
      data = await fs.readFile(source);
      if (sha256(data) !== entry.sha256) throw new ServiceError('BACKUP_INTEGRITY', 'A saved backup file failed its checksum.');
    }
    files.push({ scope: entry.scope, path: entry.path, data, mode: entry.mode });
  }
  return { directory, manifest, files };
}

async function listBackups(gameRoot) {
  const parent = await contained(gameRoot, BACKUPS);
  const directories = await fs.readdir(parent, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []; throw error;
  });
  const result = [];
  for (const entry of directories) {
    if (!entry.isDirectory() || !validBackupId(entry.name)) continue;
    try {
      const file = await contained(gameRoot, `${BACKUPS}/${entry.name}/manifest.json`, { allowMissing: false });
      const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
      result.push({ id: entry.name, kind: manifest.kind, createdAt: manifest.createdAt,
        status: manifest.status, fileCount: manifest.files?.length || 0 });
    } catch { result.push({ id: entry.name, status: 'damaged', fileCount: 0 }); }
  }
  return result.sort((first, second) => second.id.localeCompare(first.id));
}

module.exports = { PRIVATE, BACKUPS, runTransaction, readBackup, listBackups, writeTarget, ensureDirectory, resolveTarget };
