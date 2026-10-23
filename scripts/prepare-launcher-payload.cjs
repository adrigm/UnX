#!/usr/bin/env node
'use strict';

// Build only from the hash-pinned public distribution and the explicitly supplied
// compiled plugin. No installed game, user settings, saves, or mods are read.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const artifactsRoot = path.join(repoRoot, 'artifacts');
const lockPath = path.join(repoRoot, 'launcher', 'payload-manifest.json');

function parseOptions(argv) {
  const result = {};
  const allowed = new Set(['plugin', 'output', 'baseline-archive', 'extract-only']);
  for (let i = 0; i < argv.length; ++i) {
    if (argv[i] === '--help') return { help: true };
    const name = argv[i].startsWith('--') ? argv[i].slice(2) : '';
    if (!allowed.has(name) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw new Error(`Unknown option or missing value: ${argv[i]}`);
    }
    if (result[name]) throw new Error(`Repeated option: --${name}`);
    result[name] = path.resolve(argv[++i]);
  }
  return result;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') ||
      value.includes('\0') || path.posix.isAbsolute(value) ||
      value.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) {
    throw new Error(`Unsafe payload path: ${value}`);
  }
  return value;
}

function inside(root, relative) {
  const target = path.resolve(root, ...safeRelativePath(relative).split('/'));
  if (!target.startsWith(path.resolve(root) + path.sep)) {
    throw new Error(`Path escapes its payload directory: ${relative}`);
  }
  return target;
}

function validateFile(bytes, expected, label) {
  if (bytes.length !== expected.size || sha256(bytes) !== expected.sha256.toLowerCase()) {
    throw new Error(`Size/SHA256 mismatch for ${label}; refusing to package unverified bytes.`);
  }
}

async function downloadBaseline(baseline, destination) {
  const response = await fetch(baseline.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error(`Baseline download returned HTTP ${response.status}.`);
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) !== baseline.size) {
    throw new Error('The upstream archive size changed; update the reviewed lock file explicitly.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > baseline.size) throw new Error('Upstream archive exceeded its pinned size.');
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  validateFile(bytes, baseline, baseline.url);
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${crypto.randomUUID()}.download`;
  try {
    await fsp.writeFile(temporary, bytes, { flag: 'wx' });
    await fsp.rename(temporary, destination);
  } finally {
    await fsp.rm(temporary, { force: true });
  }
}

async function getBaseline(options, baseline) {
  const explicit = options['baseline-archive'];
  const destination = explicit || path.join(artifactsRoot, 'launcher-cache', baseline.filename);
  if (!fs.existsSync(destination)) {
    if (explicit) throw new Error(`Supplied baseline archive does not exist: ${destination}`);
    console.log(`Downloading pinned official UnX ${baseline.version} (${baseline.size} bytes).`);
    await downloadBaseline(baseline, destination);
  }
  validateFile(await fsp.readFile(destination), baseline, destination);
  return destination;
}

async function walkFiles(root, current = root) {
  const files = [];
  for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    safeRelativePath(relative);
    if (entry.isSymbolicLink()) throw new Error(`Links are not allowed in the payload: ${relative}`);
    if (entry.isDirectory()) files.push(...await walkFiles(root, absolute));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`Unsupported archive entry: ${relative}`);
  }
  return files.sort();
}

function validatePlugin(bytes) {
  const fail = () => { throw new Error('The plugin must be a compiled Win32 DLL exporting SKPlugIn_Init.'); };
  if (bytes.length < 64 || bytes.readUInt16LE(0) !== 0x5a4d) fail();
  const pe = bytes.readUInt32LE(0x3c);
  if (pe > bytes.length - 24 || bytes.readUInt32LE(pe) !== 0x4550 ||
      bytes.readUInt16LE(pe + 4) !== 0x14c || !(bytes.readUInt16LE(pe + 22) & 0x2000)) fail();
  const optional = pe + 24;
  const optionalSize = bytes.readUInt16LE(pe + 20);
  const sectionCount = bytes.readUInt16LE(pe + 6);
  if (optionalSize < 0xe0 || optional > bytes.length - optionalSize ||
      bytes.readUInt16LE(optional) !== 0x10b || sectionCount === 0 || sectionCount > 96) fail();
  const sectionTable = optional + optionalSize;
  if (sectionTable > bytes.length - sectionCount * 40) fail();
  const rawOffset = (rva, length) => {
    for (let i = 0; i < sectionCount; ++i) {
      const section = sectionTable + i * 40;
      const start = bytes.readUInt32LE(section + 12);
      const size = bytes.readUInt32LE(section + 16);
      const raw = bytes.readUInt32LE(section + 20);
      if (rva >= start && rva - start < size && length <= size - (rva - start)) {
        const offset = raw + rva - start;
        if (offset <= bytes.length - length) return offset;
      }
    }
    fail();
  };
  const exports = rawOffset(bytes.readUInt32LE(optional + 96), 40);
  const count = bytes.readUInt32LE(exports + 24);
  if (count === 0 || count > 10000) fail();
  const names = rawOffset(bytes.readUInt32LE(exports + 32), count * 4);
  for (let i = 0; i < count; ++i) {
    const start = rawOffset(bytes.readUInt32LE(names + i * 4), 1);
    const end = bytes.indexOf(0, start);
    if (end !== -1 && end - start <= 256 && bytes.toString('ascii', start, end) === 'SKPlugIn_Init') return;
  }
  fail();
}

async function validateExtracted(root, baseline) {
  const actual = await walkFiles(root);
  const expected = baseline.files.map(file => safeRelativePath(file.path)).sort();
  if (new Set(expected).size !== expected.length || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('Official archive file inventory differs from the reviewed payload lock.');
  }
  for (const file of baseline.files) {
    validateFile(await fsp.readFile(inside(root, file.path)), file, `official/${file.path}`);
  }
}

async function cleanStage(stage) {
  const resolved = path.resolve(stage);
  if (path.dirname(resolved) !== artifactsRoot || !path.basename(resolved).startsWith('.payload-stage-')) {
    throw new Error('Refusing to remove a directory outside the script-owned staging area.');
  }
  await fsp.rm(resolved, { recursive: true, force: true });
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log('node scripts/prepare-launcher-payload.cjs [--plugin <unx.dll>] [--output <directory>]');
    console.log('  [--baseline-archive <verified.7z>] [--extract-only <directory>]');
    console.log('Defaults: plugin artifacts/Win32/Release/unx.dll; output launcher/payload.');
    return;
  }
  const lock = JSON.parse(await fsp.readFile(lockPath, 'utf8'));
  if (lock.schemaVersion !== 1 || !/^https:\/\//.test(lock.baseline.url)) {
    throw new Error('Unsupported or invalid payload lock.');
  }
  const launcherRequire = createRequire(path.join(repoRoot, 'launcher', 'package.json'));
  const { path7za } = launcherRequire('7zip-bin');
  const AdmZip = launcherRequire('adm-zip');
  const archive = await getBaseline(options, lock.baseline);
  await fsp.mkdir(artifactsRoot, { recursive: true });
  const stage = await fsp.mkdtemp(path.join(artifactsRoot, '.payload-stage-'));
  try {
    // SHA256 was checked before invoking the extractor. Extract into a fresh,
    // private folder, then compare every file with the locked inventory.
    const extracted = spawnSync(path7za, ['x', '-y', '-bd', `-o${stage}`, '--', archive], {
      stdio: 'pipe', encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    });
    if (extracted.error || extracted.status !== 0) {
      throw new Error(`7-Zip extraction failed: ${extracted.error?.message || extracted.stderr || extracted.stdout}`);
    }
    await validateExtracted(stage, lock.baseline);
    const excluded = new Set(lock.excludeFiles.map(safeRelativePath));
    if ([...excluded].some(file => !lock.baseline.files.some(entry => entry.path === file))) {
      throw new Error('Payload exclusions must name files present in the locked official archive.');
    }
    const selected = lock.baseline.files.filter(file => !excluded.has(file.path))
      .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

    if (options['extract-only']) {
      const output = options['extract-only'];
      for (const file of selected) {
        const destination = inside(output, file.path);
        await fsp.mkdir(path.dirname(destination), { recursive: true });
        await fsp.copyFile(inside(stage, file.path), destination);
      }
      console.log(`Extracted ${selected.length} verified official runtime files to ${output}.`);
      return;
    }

    const pluginPath = options.plugin || path.join(artifactsRoot, 'Win32', 'Release', 'unx.dll');
    const plugin = await fsp.readFile(pluginPath);
    validatePlugin(plugin);
    const pluginHash = sha256(plugin);
    const original = lock.baseline.files.find(file => file.path === 'unx.dll');
    if (!original || pluginHash === original.sha256) {
      throw new Error('Supply the corrected compiled plugin; the original upstream DLL is not a valid replacement.');
    }

    const zip = new AdmZip();
    const files = [];
    for (const file of selected) {
      const bytes = file.path === 'unx.dll' ? plugin : await fsp.readFile(inside(stage, file.path));
      zip.addFile(file.path, bytes);
      const entry = zip.getEntry(file.path);
      // Use identical DOS date fields on each host rather than source mtimes.
      entry.header.time = new Date(2000, 0, 1, 0, 0, 0);
      entry.header.made = 0x0314; // ZIP 2.0, Unix host; avoid platform-dependent metadata.
      entry.attr = (0o100644 << 16) >>> 0;
      files.push({ path: file.path, sha256: sha256(bytes), size: bytes.length });
    }
    const payload = zip.toBuffer();
    const verifiedZip = new AdmZip(payload);
    if (verifiedZip.getEntries().length !== files.length) throw new Error('ZIP inventory validation failed.');
    for (const file of files) validateFile(verifiedZip.readFile(file.path), file, `payload/${file.path}`);

    const source = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
    const manifest = {
      schemaVersion: 1,
      version: lock.version,
      appId: lock.appId,
      archiveSha256: sha256(payload),
      archiveSize: payload.length,
      files,
      provenance: {
        baselineUrl: lock.baseline.url,
        baselineSha256: lock.baseline.sha256,
        pluginSha256: pluginHash,
        sourceRepository: lock.sourceRepository,
        sourceCommit: source.status === 0 ? source.stdout.trim() : null,
      },
    };
    const output = options.output || path.join(repoRoot, 'launcher', 'payload');
    await fsp.mkdir(output, { recursive: true });
    await fsp.writeFile(path.join(output, 'payload.zip'), payload);
    await fsp.writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Prepared ${files.length} files, ${payload.length} compressed bytes in ${output}.`);
    console.log(`Payload SHA256: ${manifest.archiveSha256}`);
    console.log(`Plugin SHA256: ${pluginHash}`);
  } finally {
    await cleanStage(stage);
  }
}

main().catch(error => {
  console.error(`Payload preparation failed: ${error.message}`);
  process.exitCode = 1;
});
