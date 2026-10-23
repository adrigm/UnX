'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { ServiceError, relativePath, sha256 } = require('./paths.cjs');

async function loadPayload(directory = undefined) {
  const root = directory || (process.resourcesPath ? path.join(process.resourcesPath, 'payload') : path.resolve(__dirname, '../../payload'));
  let manifest;
  let archive;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
    archive = await fs.readFile(path.join(root, 'payload.zip'));
  } catch {
    throw new ServiceError('PAYLOAD_MISSING', 'The offline installation package is missing. Reinstall the manager from its release package.');
  }
  if (manifest.schemaVersion !== 1 || Number(manifest.appId) !== 359870 ||
      typeof manifest.version !== 'string' || !Array.isArray(manifest.files) || !manifest.files.length ||
      !/^[a-f0-9]{64}$/i.test(manifest.archiveSha256 || '') ||
      sha256(archive) !== manifest.archiveSha256.toLowerCase() ||
      (manifest.archiveSize !== undefined && archive.length !== manifest.archiveSize)) {
    throw new ServiceError('PAYLOAD_INTEGRITY', 'The offline package failed its integrity check. Download the manager again.');
  }
  const allowed = new Map();
  let total = 0;
  for (const file of manifest.files) {
    const clean = relativePath(file.path);
    const lower = clean.toLowerCase();
    if (lower.startsWith('.unx-manager/') || allowed.has(lower) || !/^[a-f0-9]{64}$/i.test(file.sha256 || '') ||
        !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 128 * 1024 * 1024) {
      throw new ServiceError('PAYLOAD_INTEGRITY', 'The offline package manifest contains an invalid file.');
    }
    total += file.size;
    allowed.set(lower, { ...file, path: clean });
  }
  if (total > 512 * 1024 * 1024 || !allowed.has('unx.dll') || !allowed.has('dxgi.dll')) {
    throw new ServiceError('PAYLOAD_INTEGRITY', 'The offline package is incomplete or too large.');
  }
  const AdmZip = require('adm-zip');
  let entries;
  try { entries = new AdmZip(archive).getEntries(); }
  catch { throw new ServiceError('PAYLOAD_INTEGRITY', 'The offline package ZIP could not be read.'); }
  const files = new Map();
  for (const entry of entries) {
    if (entry.isDirectory) {
      relativePath(entry.entryName.replace(/\/$/, ''));
      continue;
    }
    const name = relativePath(entry.entryName);
    const expected = allowed.get(name.toLowerCase());
    const mode = (entry.attr >>> 16) & 0xf000;
    if (!expected || expected.path !== name || files.has(name.toLowerCase()) || mode === 0xa000 ||
        entry.header.size !== expected.size) {
      throw new ServiceError('PAYLOAD_INTEGRITY', 'The offline ZIP contains an unexpected file or symbolic link.');
    }
    let data;
    try { data = entry.getData(); } catch { throw new ServiceError('PAYLOAD_INTEGRITY', 'The offline ZIP contains a damaged file.'); }
    if (data.length !== expected.size || sha256(data) !== expected.sha256.toLowerCase()) {
      throw new ServiceError('PAYLOAD_INTEGRITY', `The offline file ${name} failed its integrity check.`);
    }
    files.set(name.toLowerCase(), { path: name, data, sha256: expected.sha256.toLowerCase() });
  }
  if (files.size !== allowed.size) throw new ServiceError('PAYLOAD_INTEGRITY', 'The offline ZIP is missing a required file.');
  return { manifest, files };
}

module.exports = { loadPayload };
