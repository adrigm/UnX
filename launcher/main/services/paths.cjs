'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

class ServiceError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function relativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') ||
      value.includes('\0') || value.startsWith('/') || value.endsWith('/')) {
    throw new ServiceError('UNSAFE_PATH', 'The package contains an unsafe file path.');
  }
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[<>"|?*\x00-\x1f]/.test(part) ||
      /[ .]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new ServiceError('UNSAFE_PATH', 'The package contains an unsafe file path.');
  }
  return parts.join('/');
}

async function exists(file) {
  try { await fs.lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function contained(root, relative, { allowMissing = true } = {}) {
  const clean = relativePath(relative);
  const actualRoot = await fs.realpath(root);
  const target = path.resolve(actualRoot, ...clean.split('/'));
  const rel = path.relative(actualRoot, target);
  if (!rel || rel.startsWith(`..${path.sep}`) || rel === '..' || path.isAbsolute(rel)) {
    throw new ServiceError('UNSAFE_PATH', 'The target is outside the selected installation.');
  }
  let cursor = actualRoot;
  for (const part of clean.split('/')) {
    cursor = path.join(cursor, part);
    try {
      const stat = await fs.lstat(cursor);
      if (stat.isSymbolicLink()) {
        throw new ServiceError('SYMLINK_TARGET', 'A managed file or folder is a symbolic link. Move it before continuing.', { path: cursor });
      }
    } catch (error) {
      if (error.code !== 'ENOENT' || !allowMissing) throw error;
      break;
    }
  }
  return target;
}

async function atomicWrite(file, data, mode = 0o600) {
  const temp = path.join(path.dirname(file), `.unx-write-${crypto.randomUUID()}`);
  let handle;
  try {
    handle = await fs.open(temp, 'wx', mode);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temp, file);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
async function readOptional(file) {
  try { return await fs.readFile(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

module.exports = { ServiceError, relativePath, contained, exists, atomicWrite, sha256, readOptional };
